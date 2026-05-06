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
import { after } from "next/server"
import { getCurrentUserId } from "@/lib/auth"
import { getClientContext } from "@/lib/cpa/clientContext"
import { prisma } from "@/lib/db"
import { parseStatement, fileHash, transactionKey, partitionByTaxYear } from "@/lib/parsers"
import {
  openOrGetSession,
  chargeApiCall,
  closeSession,
  saveSessionNotes,
  RateLimitError,
} from "@/lib/uploads/session"
import { uploadDir } from "@/lib/uploads/storage"
import { buildContextualPrompts } from "@/lib/uploads/contextualPrompts"
import { writeFile, readFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import type { AccountType, Prisma } from "@/app/generated/prisma/client"

// Module-level lock: prevents two concurrent parses of the same import (e.g.
// auto-resume on page load firing while after() parse is still running).
const _parseInProgress = new Set<string>()

/** Map file extension to fileType string */
function fileTypeFromName(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith(".pdf")) return "pdf"
  if (lower.endsWith(".ofx")) return "ofx"
  if (lower.endsWith(".qfx")) return "qfx"
  return "csv"
}

// ── uploadStatement ──────────────────────────────────────────────────────────
//
// Two-phase upload:
//   Phase 1 (this action) — save file to disk + create PENDING StatementImport.
//     Fast. Synchronous file I/O only. No AI calls.
//   Phase 2 (parseImport)  — read file, run parseStatement (Haiku/Sonnet for
//     PDFs), insert transactions. Slow. Retryable without re-upload.
//
// This split means: a client batch-uploading 12 files sees them land within
// a second or two, then parses each one independently. If Anthropic errors
// on file 7, files 1-6 stay SUCCESS, file 7 stays PENDING with the buffer
// on disk, and the user can retry via the Reparse button.

export type UploadResult =
  | {
      ok: true
      importId: string
      sessionId: string
      apiCallsUsed: number
      apiCallLimit: number
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

  const account = await prisma.financialAccount.findFirst({
    where: { id: accountId, userId },
    include: { taxYear: { select: { id: true, year: true, status: true } } },
  })

  if (!account) return { ok: false, error: "Account not found" }
  if (account.taxYear.year !== year) return { ok: false, error: "Account year mismatch" }
  if (account.taxYear.status === "LOCKED") return { ok: false, error: "Tax year is locked" }

  const taxYearId = account.taxYear.id

  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)
  const hash = fileHash(buffer)

  const existing = await prisma.statementImport.findUnique({
    where: { accountId_sourceHash: { accountId, sourceHash: hash } },
  })
  if (existing) {
    // A FAILED/PENDING row with no transactions is a stale staging artifact — clear it
    // so the file can be re-uploaded cleanly (e.g. after a missing-file redeploy).
    const txCount = await prisma.transaction.count({ where: { statementImportId: existing.id } })
    if (txCount === 0 && (existing.parseStatus === "FAILED" || existing.parseStatus === "PENDING")) {
      await prisma.statementImport.delete({ where: { id: existing.id } })
    } else {
      return { ok: false, error: `This file has already been imported (import ID: ${existing.id})` }
    }
  }

  const dir = await uploadDir(taxYearId)
  const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`
  const filePath = join(dir, safeName)
  await writeFile(filePath, buffer)

  const ctx = await getClientContext()
  const session = await openOrGetSession(taxYearId, ctx?.cpaId ?? null)

  const fileType = fileTypeFromName(file.name)

  const statementImport = await prisma.statementImport.create({
    data: {
      accountId,
      taxYearId,
      sessionId: session.id,
      filePath,
      originalFilename: file.name,
      fileType,
      sourceHash: hash,
      parseStatus: "PENDING",
      parseConfidence: 0,
      totalInflows: 0,
      totalOutflows: 0,
      transactionCount: 0,
    },
  })

  if (account.taxYear.status === "CREATED") {
    await prisma.taxYear.update({
      where: { id: taxYearId },
      data: { status: "INGESTION" },
    })
  }

  const sessionAfter = await prisma.importSession.findUniqueOrThrow({
    where: { id: session.id },
    select: { totalApiCalls: true, apiCallLimit: true },
  })

  // Kick parsing in the background — client polls /api/imports/[id]/status
  const importIdForAfter = statementImport.id
  after(async () => {
    await parseImport(importIdForAfter, year)
  })

  revalidatePath(`/years/${year}/upload`)

  return {
    ok: true,
    importId: statementImport.id,
    sessionId: session.id,
    apiCallsUsed: sessionAfter.totalApiCalls,
    apiCallLimit: sessionAfter.apiCallLimit,
  }
}

// ── parseImport ──────────────────────────────────────────────────────────────
//
// Phase 2: read the persisted file, run the parser (including AI for PDFs),
// update the StatementImport row, and insert transactions. Safe to re-run on
// any PENDING / FAILED / PARTIAL import — it's effectively the same code path
// as reparseImport but with session rate-limiting engaged for PDFs.

export type ParseImportResult =
  | {
      ok: true
      importId: string
      txCount: number
      skipped: number
      /** Rows whose postedDate fell outside the TaxYear and were dropped per A10. */
      outOfYearCount: number
      institution: string | null
      sessionId: string
      apiCallsUsed: number
      apiCallLimit: number
      prompts: Awaited<ReturnType<typeof buildContextualPrompts>>
    }
  | { ok: false; error: string; sessionId?: string }

export async function parseImport(importId: string, year: number): Promise<ParseImportResult> {
  // Prevent concurrent parses of the same import (e.g. after() + auto-resume)
  if (_parseInProgress.has(importId)) return { ok: false, error: "Already parsing" }
  _parseInProgress.add(importId)

  try {
    return await _doParseImport(importId, year)
  } finally {
    _parseInProgress.delete(importId)
  }
}

async function _doParseImport(importId: string, year: number): Promise<ParseImportResult> {
  const userId = await getCurrentUserId()

  const imp = await prisma.statementImport.findFirst({
    where: { id: importId, account: { userId } },
    include: {
      account: { select: { id: true } },
      taxYear: { select: { id: true, year: true, status: true } },
    },
  })

  if (!imp) return { ok: false, error: "Import not found" }
  if (imp.taxYear.status === "LOCKED") return { ok: false, error: "Tax year is locked" }

  let buffer: Buffer
  try {
    buffer = await readFile(imp.filePath)
  } catch {
    // File is gone (pre-volume deploy). Auto-delete the row if no transactions
    // have been extracted — it's an orphaned staging artifact with no audit value.
    const txCount = await prisma.transaction.count({ where: { statementImportId: importId } })
    if (txCount === 0) {
      await prisma.statementImport.delete({ where: { id: importId } })
      revalidatePath(`/years/${year}/upload`)
      return { ok: false, error: "FILE_DELETED" }
    }
    return { ok: false, error: "Original file not found — cannot reparse" }
  }

  const session = imp.sessionId
    ? { id: imp.sessionId }
    : await openOrGetSession(imp.taxYearId, null)

  let parseResult
  try {
    parseResult = await parseStatement(buffer, imp.originalFilename, {
      onAiCall: async () => {
        await chargeApiCall(session.id)
      },
    })
  } catch (err) {
    if (err instanceof RateLimitError) {
      return {
        ok: false,
        error: `Upload session API limit reached (${err.limit} calls). Ask the CPA to raise the limit.`,
        sessionId: session.id,
      }
    }
    const message = err instanceof Error ? err.message : String(err)
    await prisma.statementImport.update({
      where: { id: importId },
      data: {
        parseStatus: "FAILED",
        parseError: message.slice(0, 500),
      },
    })
    return { ok: false, error: `Parse error: ${message}`, sessionId: session.id }
  }

  let parseStatus: "SUCCESS" | "FAILED" | "PARTIAL"
  if (!parseResult.ok || parseResult.transactions.length === 0) {
    parseStatus = "FAILED"
  } else if (parseResult.reconciliation && !parseResult.reconciliation.ok) {
    parseStatus = "PARTIAL"
  } else {
    parseStatus = "SUCCESS"
  }

  const tel = parseResult.extractionTelemetry
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
      extractionPath: parseResult.extractionPath ?? null,
      extractionConfidence: tel?.confidence ?? null,
      aiModel: tel?.model ?? null,
      aiTokensIn: tel?.tokensIn ?? null,
      aiTokensOut: tel?.tokensOut ?? null,
    },
  })

  if (parseStatus === "FAILED") {
    const sessionAfter = await prisma.importSession.findUniqueOrThrow({
      where: { id: session.id },
      select: { totalApiCalls: true, apiCallLimit: true },
    })
    return {
      ok: false,
      error: parseResult.error ?? "Parse failed — check the file format",
      sessionId: session.id,
    } as ParseImportResult
  }

  // Filter out rows that fall outside this TaxYear (assertion A10).
  // Statements that span a year boundary (Dec → Jan PDFs) often contain rows
  // for both years; only the in-year rows belong here. Out-of-year rows are
  // surfaced through `userNotes.out_of_year_warning` and the result type.
  const { inYear, outOfYear } = partitionByTaxYear(parseResult.transactions, imp.taxYear.year)

  let inserted = 0
  let skipped = 0

  for (const tx of inYear) {
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

  if (outOfYear.length > 0) {
    const existingNotes = (imp.userNotes as Record<string, unknown> | null) ?? {}
    const sampleDates = outOfYear.slice(0, 5).map((t) => t.postedDate.toISOString().slice(0, 10))
    await prisma.statementImport.update({
      where: { id: importId },
      data: {
        userNotes: {
          ...existingNotes,
          out_of_year_warning: {
            count: outOfYear.length,
            taxYear: imp.taxYear.year,
            sampleDates,
            message: `${outOfYear.length} transaction${outOfYear.length === 1 ? "" : "s"} outside ${imp.taxYear.year} were dropped (assertion A10). Move them to the correct TaxYear by uploading this statement under that year's account.`,
          },
        } as Prisma.InputJsonValue,
      },
    })
  }

  await prisma.statementImport.update({
    where: { id: importId },
    data: { transactionCount: inserted },
  })

  const priorImports = await prisma.statementImport.findMany({
    where: { accountId: imp.accountId, parseStatus: "SUCCESS", id: { not: imp.id } },
    select: { periodStart: true, periodEnd: true },
  })
  const firstSighting =
    (await prisma.statementImport.count({
      where: { sessionId: session.id, accountId: imp.accountId },
    })) === 1
  const prompts = buildContextualPrompts({
    imp: {
      id: imp.id,
      accountId: imp.accountId,
      parseConfidence: parseResult.parseConfidence,
      institution: parseResult.institution ?? null,
      periodStart: parseResult.periodStart ?? null,
      periodEnd: parseResult.periodEnd ?? null,
    },
    transactions: inYear.map((t) => ({
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
    importId: imp.id,
    txCount: inserted,
    skipped,
    outOfYearCount: outOfYear.length,
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
// Rows with transactions: mark FAILED (append-only — audit trail preserved).
// Rows with 0 transactions: hard-delete — frees the sourceHash slot for re-upload.

export type DeleteImportResult = { ok: true } | { ok: false; error: string }

export async function deleteImport(importId: string, year: number): Promise<DeleteImportResult> {
  const userId = await getCurrentUserId()

  const imp = await prisma.statementImport.findFirst({
    where: { id: importId, account: { userId } },
    select: { id: true, parseStatus: true, taxYearId: true },
  })

  if (!imp) return { ok: false, error: "Import not found" }

  const txCount = await prisma.transaction.count({ where: { statementImportId: importId } })
  if (txCount === 0) {
    await prisma.statementImport.delete({ where: { id: importId } })
  } else {
    await prisma.statementImport.update({
      where: { id: importId },
      data: { parseStatus: "FAILED", parseError: "Cancelled by user" },
    })
  }

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
  | { ok: true; txCount: number; skipped: number; outOfYearCount: number }
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
      userNotes: true,
      taxYear: { select: { year: true } },
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

  // Filter out rows that fall outside this TaxYear (assertion A10).
  const { inYear, outOfYear } = partitionByTaxYear(parseResult.transactions, imp.taxYear.year)

  let inserted = 0
  let skipped = 0

  for (const tx of inYear) {
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

  if (outOfYear.length > 0) {
    const existingNotes = (imp.userNotes as Record<string, unknown> | null) ?? {}
    const sampleDates = outOfYear.slice(0, 5).map((t) => t.postedDate.toISOString().slice(0, 10))
    await prisma.statementImport.update({
      where: { id: importId },
      data: {
        userNotes: {
          ...existingNotes,
          out_of_year_warning: {
            count: outOfYear.length,
            taxYear: imp.taxYear.year,
            sampleDates,
            message: `${outOfYear.length} transaction${outOfYear.length === 1 ? "" : "s"} outside ${imp.taxYear.year} were dropped (assertion A10).`,
          },
        } as Prisma.InputJsonValue,
      },
    })
  }

  await prisma.statementImport.update({
    where: { id: importId },
    data: { transactionCount: inserted },
  })

  revalidatePath(`/years/${year}/upload`)
  revalidatePath(`/years/${year}/coverage`)

  return { ok: true, txCount: inserted, skipped, outOfYearCount: outOfYear.length }
}
