"use server"

/**
 * TaxLens — Upload server actions (Prompt 3)
 *
 * uploadStatement  — parse file, write StatementImport + Transactions
 * deleteImport     — soft-cancel a FAILED/PENDING import (no real delete: spec §4 append-only)
 * createAccount    — add a FinancialAccount to a tax year
 * reparseImport    — re-run the parser on an existing import (re-reads the file from disk)
 */

import { revalidatePath } from "next/cache"
import { getCurrentUserId } from "@/lib/auth"
import { getClientContext } from "@/lib/cpa/clientContext"
import { prisma } from "@/lib/db"
import { parseStatement, fileHash, transactionKey } from "@/lib/parsers"
import {
  openOrGetSession,
  chargeApiCall,
  closeSession,
  saveSessionNotes,
  RateLimitError,
} from "@/lib/uploads/session"
import { buildContextualPrompts } from "@/lib/uploads/contextualPrompts"
import { writeFile, mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import type { AccountType, Prisma } from "@/app/generated/prisma/client"

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve upload dir; creates it if missing */
async function uploadDir(taxYearId: string): Promise<string> {
  const dir = join(process.cwd(), "data", "uploads", taxYearId)
  await mkdir(dir, { recursive: true })
  return dir
}

/** Map file extension to fileType string */
function fileTypeFromName(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith(".pdf")) return "pdf"
  if (lower.endsWith(".ofx")) return "ofx"
  if (lower.endsWith(".qfx")) return "qfx"
  return "csv"
}

// ── uploadStatement ──────────────────────────────────────────────────────────

export type UploadResult =
  | {
      ok: true
      importId: string
      txCount: number
      skipped: number
      institution: string | null
      sessionId: string
      apiCallsUsed: number
      apiCallLimit: number
      prompts: Awaited<ReturnType<typeof buildContextualPrompts>>
    }
  | { ok: false; error: string; sessionId?: string }

export async function uploadStatement(formData: FormData): Promise<UploadResult> {
  const userId = await getCurrentUserId()

  const file = formData.get("file") as File | null
  const accountId = formData.get("accountId") as string | null
  const yearParam = formData.get("year") as string | null

  if (!file || !accountId || !yearParam) {
    return { ok: false, error: "Missing required fields: file, accountId, year" }
  }

  const year = parseInt(yearParam, 10)
  if (isNaN(year)) return { ok: false, error: "Invalid year" }

  // Verify the account belongs to this user's tax year
  const account = await prisma.financialAccount.findFirst({
    where: { id: accountId, userId },
    include: { taxYear: { select: { id: true, year: true, status: true } } },
  })

  if (!account) return { ok: false, error: "Account not found" }
  if (account.taxYear.year !== year) return { ok: false, error: "Account year mismatch" }
  if (account.taxYear.status === "LOCKED") return { ok: false, error: "Tax year is locked" }

  const taxYearId = account.taxYear.id

  // Read file bytes
  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)
  const hash = fileHash(buffer)

  // File-level dedup: reject exact duplicates
  const existing = await prisma.statementImport.findUnique({
    where: { accountId_sourceHash: { accountId, sourceHash: hash } },
  })
  if (existing) {
    return { ok: false, error: `This file has already been imported (import ID: ${existing.id})` }
  }

  // Save file to disk
  const dir = await uploadDir(taxYearId)
  const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`
  const filePath = join(dir, safeName)
  await writeFile(filePath, buffer)

  // Open or reuse the current upload session
  const ctx = await getClientContext()
  const session = await openOrGetSession(taxYearId, ctx?.cpaId ?? null)

  // Parse — PDFs may call the AI; charge each call against the session limit.
  let parseResult
  try {
    parseResult = await parseStatement(buffer, file.name, {
      onAiCall: async () => {
        await chargeApiCall(session.id)
      },
    })
  } catch (err) {
    if (err instanceof RateLimitError) {
      return {
        ok: false,
        error: `Upload session API limit reached (${err.limit} calls). Close this session or ask the CPA to raise the limit.`,
        sessionId: session.id,
      }
    }
    throw err
  }

  const fileType = fileTypeFromName(file.name)

  // Determine parse status
  let parseStatus: "SUCCESS" | "FAILED" | "PARTIAL"
  if (!parseResult.ok || parseResult.transactions.length === 0) {
    parseStatus = "FAILED"
  } else if (parseResult.reconciliation && !parseResult.reconciliation.ok) {
    parseStatus = "PARTIAL"
  } else {
    parseStatus = "SUCCESS"
  }

  // Write StatementImport
  const tel = parseResult.extractionTelemetry
  const statementImport = await prisma.statementImport.create({
    data: {
      accountId,
      taxYearId,
      sessionId: session.id,
      filePath,
      originalFilename: file.name,
      fileType,
      institution: parseResult.institution ?? null,
      periodStart: parseResult.periodStart ?? null,
      periodEnd: parseResult.periodEnd ?? null,
      sourceHash: hash,
      parseStatus,
      parseConfidence: parseResult.parseConfidence,
      totalInflows: parseResult.totalInflows,
      totalOutflows: parseResult.totalOutflows,
      transactionCount: parseResult.transactions.length,
      reconciliationOk: parseResult.reconciliation?.ok ?? null,
      reconciliationDelta: parseResult.reconciliation?.delta ?? null,
      parseError: parseResult.error ?? null,
      extractionPath: parseResult.extractionPath ?? null,
      extractionConfidence: tel?.confidence ?? null,
      aiModel: tel?.model ?? null,
      aiTokensIn: tel?.tokensIn ?? null,
      aiTokensOut: tel?.tokensOut ?? null,
    },
  })

  if (parseStatus === "FAILED") {
    return {
      ok: false,
      error: parseResult.error ?? "Parse failed — check the file format",
    }
  }

  // Insert transactions (skip duplicates via idempotencyKey)
  let inserted = 0
  let skipped = 0

  for (const tx of parseResult.transactions) {
    const iKey = transactionKey(accountId, tx.postedDate, tx.amountNormalized, tx.merchantRaw)

    const exists = await prisma.transaction.findUnique({ where: { idempotencyKey: iKey } })
    if (exists) { skipped++; continue }

    await prisma.transaction.create({
      data: {
        statementImportId: statementImport.id,
        accountId,
        taxYearId,
        postedDate: tx.postedDate,
        transactionDate: tx.transactionDate ?? null,
        amountOriginal: tx.amountOriginal,
        amountNormalized: tx.amountNormalized,
        merchantRaw: tx.merchantRaw,
        descriptionRaw: tx.descriptionRaw ?? null,
        idempotencyKey: iKey,
      },
    })
    inserted++
  }

  // Update transactionCount with actual inserted (not skipped dupes)
  await prisma.statementImport.update({
    where: { id: statementImport.id },
    data: { transactionCount: inserted },
  })

  // Bump tax year status to INGESTION if it was CREATED
  if (account.taxYear.status === "CREATED") {
    await prisma.taxYear.update({
      where: { id: taxYearId },
      data: { status: "INGESTION" },
    })
  }

  // Build contextual prompts for the user (institution, account purpose, gaps, unusual deposits)
  const priorImports = await prisma.statementImport.findMany({
    where: { accountId, parseStatus: "SUCCESS", id: { not: statementImport.id } },
    select: { periodStart: true, periodEnd: true },
  })
  const firstSighting =
    (await prisma.statementImport.count({
      where: { sessionId: session.id, accountId },
    })) === 1 // this one we just inserted
  const prompts = buildContextualPrompts({
    imp: statementImport,
    transactions: parseResult.transactions.map((t) => ({
      postedDate: t.postedDate,
      amountNormalized: t.amountNormalized as unknown as import("@/app/generated/prisma/client").Prisma.Decimal,
      merchantRaw: t.merchantRaw,
    })),
    priorImportsForAccount: priorImports,
    firstSightingOfAccount: firstSighting,
  })

  const sessionAfter = await prisma.importSession.findUniqueOrThrow({
    where: { id: session.id },
    select: { totalApiCalls: true, apiCallLimit: true },
  })

  revalidatePath(`/years/${year}/upload`)
  revalidatePath(`/years/${year}/coverage`)
  revalidatePath(`/years/${year}`)

  return {
    ok: true,
    importId: statementImport.id,
    txCount: inserted,
    skipped,
    institution: parseResult.institution ?? null,
    sessionId: session.id,
    apiCallsUsed: sessionAfter.totalApiCalls,
    apiCallLimit: sessionAfter.apiCallLimit,
    prompts,
  }
}

// ── saveImportNotes — persist user answers on contextual prompts ─────────────

const ImportNotesSchema = z.object({
  importId: z.string().min(1),
  year: z.number().int(),
  notes: z.record(z.string(), z.unknown()),
})

export async function saveImportNotes(
  input: z.infer<typeof ImportNotesSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await getCurrentUserId()
  const parsed = ImportNotesSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Invalid input" }

  const imp = await prisma.statementImport.findFirst({
    where: { id: parsed.data.importId, account: { userId } },
    select: { id: true, userNotes: true },
  })
  if (!imp) return { ok: false, error: "Import not found" }

  const prev = (imp.userNotes as Record<string, unknown> | null) ?? {}
  const merged = { ...prev, ...parsed.data.notes } as Prisma.InputJsonValue
  await prisma.statementImport.update({
    where: { id: imp.id },
    data: { userNotes: merged },
  })
  revalidatePath(`/years/${parsed.data.year}/upload`)
  return { ok: true }
}

// ── saveUploadSessionNotes — free-text notes for the whole session ───────────

export async function saveUploadSessionNotes(
  sessionId: string,
  year: number,
  notes: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await getCurrentUserId()
  const sess = await prisma.importSession.findUnique({
    where: { id: sessionId },
    include: { taxYear: { select: { userId: true } } },
  })
  if (!sess) return { ok: false, error: "Session not found" }

  const ctx = await getClientContext()
  const ownerId = ctx?.clientId ?? userId
  if (sess.taxYear.userId !== ownerId) return { ok: false, error: "Forbidden" }

  await saveSessionNotes(sessionId, notes)
  revalidatePath(`/years/${year}/upload`)
  return { ok: true }
}

// ── closeUploadSession ───────────────────────────────────────────────────────

export async function closeUploadSession(
  sessionId: string,
  year: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await getCurrentUserId()
  const sess = await prisma.importSession.findUnique({
    where: { id: sessionId },
    include: { taxYear: { select: { userId: true } } },
  })
  if (!sess) return { ok: false, error: "Session not found" }

  const ctx = await getClientContext()
  const ownerId = ctx?.clientId ?? userId
  if (sess.taxYear.userId !== ownerId) return { ok: false, error: "Forbidden" }

  await closeSession(sessionId, "COMPLETE")
  revalidatePath(`/years/${year}/upload`)
  return { ok: true }
}

// ── deleteImport ─────────────────────────────────────────────────────────────
// Spec §4 append-only: we don't hard-delete. We mark as FAILED with a note.

export type DeleteImportResult = { ok: true } | { ok: false; error: string }

export async function deleteImport(importId: string, year: number): Promise<DeleteImportResult> {
  const userId = await getCurrentUserId()

  const imp = await prisma.statementImport.findFirst({
    where: { id: importId, account: { userId } },
    select: { id: true, parseStatus: true, taxYearId: true },
  })

  if (!imp) return { ok: false, error: "Import not found" }

  await prisma.statementImport.update({
    where: { id: importId },
    data: {
      parseStatus: "FAILED",
      parseError: "Cancelled by user",
    },
  })

  revalidatePath(`/years/${year}/upload`)
  revalidatePath(`/years/${year}/coverage`)

  return { ok: true }
}

// ── createAccount ─────────────────────────────────────────────────────────────

const CreateAccountSchema = z.object({
  year: z.number().int().min(2020).max(2030),
  type: z.enum(["CHECKING", "SAVINGS", "CREDIT_CARD", "BROKERAGE", "PAYMENT_PROCESSOR"]),
  institution: z.string().min(1).max(100),
  nickname: z.string().max(80).optional(),
  mask: z.string().max(4).optional(),
  isPrimaryBusiness: z.boolean().default(false),
})

export type CreateAccountResult =
  | { ok: true; accountId: string }
  | { ok: false; error: string }

export async function createAccount(input: z.infer<typeof CreateAccountSchema>): Promise<CreateAccountResult> {
  const userId = await getCurrentUserId()

  const parsed = CreateAccountSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }

  const { year, type, institution, nickname, mask, isPrimaryBusiness } = parsed.data

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    select: { id: true, status: true },
  })

  if (!taxYear) return { ok: false, error: "Tax year not found" }
  if (taxYear.status === "LOCKED") return { ok: false, error: "Tax year is locked" }

  const account = await prisma.financialAccount.create({
    data: {
      userId,
      taxYearId: taxYear.id,
      type: type as AccountType,
      institution,
      nickname: nickname ?? null,
      mask: mask ?? null,
      isPrimaryBusiness,
    },
  })

  revalidatePath(`/years/${year}/upload`)
  revalidatePath(`/years/${year}`)

  return { ok: true, accountId: account.id }
}

// ── reparseImport ─────────────────────────────────────────────────────────────

export type ReparseResult =
  | { ok: true; txCount: number; skipped: number }
  | { ok: false; error: string }

export async function reparseImport(importId: string, year: number): Promise<ReparseResult> {
  const userId = await getCurrentUserId()

  const imp = await prisma.statementImport.findFirst({
    where: { id: importId, account: { userId } },
    select: {
      id: true,
      filePath: true,
      originalFilename: true,
      accountId: true,
      taxYearId: true,
    },
  })

  if (!imp) return { ok: false, error: "Import not found" }

  let buffer: Buffer
  try {
    buffer = await readFile(imp.filePath)
  } catch {
    return { ok: false, error: "Original file not found on disk — cannot reparse" }
  }

  // Reparse bypasses session rate-limit — this is a CPA-triggered action on
  // an already-stored file, not a client burn on their quota.
  const parseResult = await parseStatement(buffer, imp.originalFilename)

  let parseStatus: "SUCCESS" | "FAILED" | "PARTIAL"
  if (!parseResult.ok || parseResult.transactions.length === 0) {
    parseStatus = "FAILED"
  } else if (parseResult.reconciliation && !parseResult.reconciliation.ok) {
    parseStatus = "PARTIAL"
  } else {
    parseStatus = "SUCCESS"
  }

  await prisma.statementImport.update({
    where: { id: importId },
    data: {
      institution: parseResult.institution ?? null,
      periodStart: parseResult.periodStart ?? null,
      periodEnd: parseResult.periodEnd ?? null,
      parseStatus,
      parseConfidence: parseResult.parseConfidence,
      totalInflows: parseResult.totalInflows,
      totalOutflows: parseResult.totalOutflows,
      reconciliationOk: parseResult.reconciliation?.ok ?? null,
      reconciliationDelta: parseResult.reconciliation?.delta ?? null,
      parseError: parseResult.error ?? null,
    },
  })

  if (parseStatus === "FAILED") {
    return { ok: false, error: parseResult.error ?? "Reparse failed" }
  }

  let inserted = 0
  let skipped = 0

  for (const tx of parseResult.transactions) {
    const iKey = transactionKey(imp.accountId, tx.postedDate, tx.amountNormalized, tx.merchantRaw)
    const exists = await prisma.transaction.findUnique({ where: { idempotencyKey: iKey } })
    if (exists) { skipped++; continue }

    await prisma.transaction.create({
      data: {
        statementImportId: imp.id,
        accountId: imp.accountId,
        taxYearId: imp.taxYearId,
        postedDate: tx.postedDate,
        transactionDate: tx.transactionDate ?? null,
        amountOriginal: tx.amountOriginal,
        amountNormalized: tx.amountNormalized,
        merchantRaw: tx.merchantRaw,
        descriptionRaw: tx.descriptionRaw ?? null,
        idempotencyKey: iKey,
      },
    })
    inserted++
  }

  await prisma.statementImport.update({
    where: { id: importId },
    data: { transactionCount: inserted },
  })

  revalidatePath(`/years/${year}/upload`)
  revalidatePath(`/years/${year}/coverage`)

  return { ok: true, txCount: inserted, skipped }
}
