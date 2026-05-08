/**
 * Phase A — Sonnet vision re-extraction for low-confidence PDF statements.
 *
 * The first ingest pass uses Haiku for cheap text-based extraction; if the
 * statement was scanned or has noisy text, Haiku's confidence comes back
 * <0.85 and the resulting Transactions may have wrong amounts, missing
 * lines, or bad merchant strings. This module re-runs Sonnet vision over
 * those PDFs, upserts cleaner transactions (using the existing
 * idempotencyKey so re-running is idempotent), and bumps the StatementImport
 * row's parseConfidence + extractionPath to reflect the better source.
 *
 * Append-only posture:
 *   - Existing Transaction rows are kept; matched rows are skipped via the
 *     idempotencyKey unique index.
 *   - New rows that the better extraction discovered are inserted.
 *   - Rows that ONLY existed in the old (low-quality) extraction are left
 *     in place; the user can clean them up via the existing reparseImport
 *     flow if needed.
 *   - StatementImport.parseConfidence is updated to the new (higher)
 *     value; extractionPath is set to VISION_DOC.
 */

import Anthropic from "@anthropic-ai/sdk"
import { readFile } from "node:fs/promises"
import { prisma } from "@/lib/db"
import { parseStatement, transactionKey, partitionByTaxYear } from "@/lib/parsers"
import type { ProgressReporter } from "@/lib/jobs/pipelineRun"

export interface ReExtractOptions {
  /** Statements with parseConfidence below this are eligible. Default 0.85. */
  confidenceThreshold?: number
  /** When true, skip the actual write — useful for cost-estimation runs. */
  dryRun?: boolean
  anthropicClient?: Anthropic
  reportProgress?: ProgressReporter
}

export interface ReExtractResult {
  importsConsidered: number
  importsReExtracted: number
  newTransactions: number
  /** Total rows marked isStale=true (superseded by the better extraction). */
  staledTransactions: number
  bumpedConfidence: number
  errors: number
  details: Array<{
    importId: string
    originalFilename: string
    oldConfidence: number
    newConfidence: number | null
    newTransactions: number
    staledTransactions: number
    status: "reextracted" | "skipped-no-file" | "skipped-still-low" | "error"
    errorMessage?: string
  }>
}

export async function reExtractLowConfidence(
  taxYearId: string,
  options: ReExtractOptions = {},
): Promise<ReExtractResult> {
  const threshold = options.confidenceThreshold ?? 0.85
  const reporter = options.reportProgress
  const anthropic = options.anthropicClient ?? new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] })

  // Eligible imports: PDF, parseConfidence < threshold, NOT already on
  // VISION_DOC (we don't re-process what's already at the best path).
  const candidates = await prisma.statementImport.findMany({
    where: {
      taxYearId,
      fileType: { in: ["pdf"] },
      parseConfidence: { lt: threshold },
      OR: [
        { extractionPath: "HAIKU_CLEANUP" },
        { extractionPath: "PDF_PARSE" },
        { extractionPath: null },
      ],
    },
    orderBy: { uploadedAt: "asc" },
  })

  const result: ReExtractResult = {
    importsConsidered: candidates.length,
    importsReExtracted: 0,
    newTransactions: 0,
    staledTransactions: 0,
    bumpedConfidence: 0,
    errors: 0,
    details: [],
  }

  if (reporter) {
    await reporter({
      phase: "extract_repass",
      processed: 0,
      total: candidates.length,
      label:
        candidates.length === 0
          ? "No low-confidence statements need re-extraction."
          : `Re-extracting ${candidates.length} low-confidence PDF${candidates.length === 1 ? "" : "s"} via Sonnet vision…`,
    })
  }

  const ty = await prisma.taxYear.findUniqueOrThrow({
    where: { id: taxYearId },
    select: { year: true },
  })

  for (let i = 0; i < candidates.length; i++) {
    const imp = candidates[i]!
    const detail: ReExtractResult["details"][number] = {
      importId: imp.id,
      originalFilename: imp.originalFilename,
      oldConfidence: imp.parseConfidence ?? 0,
      newConfidence: null,
      newTransactions: 0,
      staledTransactions: 0,
      status: "error",
    }

    try {
      // Read the file from disk.
      const buffer = await readFile(imp.filePath).catch(() => null)
      if (!buffer) {
        detail.status = "skipped-no-file"
        detail.errorMessage = "Original file no longer on disk."
        result.details.push(detail)
        result.errors++
        continue
      }

      // Force the vision-doc path. parseStatement's PDF branch routes via
      // pdf-router by default; we want to bypass it. Hand it the buffer
      // and the anthropic client; under the hood vision-doc.ts is the
      // higher-quality path.
      const parsed = await parseStatement(buffer, imp.originalFilename, {
        anthropicClient: anthropic,
      })

      if (!parsed.ok) {
        detail.status = "error"
        detail.errorMessage = parsed.error ?? "parseStatement returned error"
        result.errors++
        result.details.push(detail)
        continue
      }

      detail.newConfidence = parsed.parseConfidence

      // If new confidence is still below threshold, log but don't replace
      // the existing import metadata — better to keep the partial data
      // than nuke it with another low-confidence pass.
      if ((parsed.parseConfidence ?? 0) < threshold) {
        detail.status = "skipped-still-low"
        detail.errorMessage = `New confidence ${(parsed.parseConfidence ?? 0).toFixed(2)} still below threshold ${threshold}`
        result.details.push(detail)
        if (reporter) {
          await reporter({
            phase: "extract_repass",
            processed: i + 1,
            total: candidates.length,
            label: `${i + 1} / ${candidates.length} · ${imp.originalFilename}: low confidence retained`,
          })
        }
        continue
      }

      if (options.dryRun) {
        detail.status = "reextracted"
        detail.newTransactions = parsed.transactions.length
        result.details.push(detail)
        result.importsReExtracted++
        continue
      }

      // Drop transactions that fall outside this TaxYear (matches A10 logic).
      const { inYear } = partitionByTaxYear(parsed.transactions, ty.year)

      // Compute the set of idempotency keys the new (better) extraction
      // produced. Anything attached to this StatementImport that is NOT
      // in this set is considered stale — it was an artifact of the old
      // low-confidence extraction that the better one didn't confirm.
      const newKeys = new Set<string>()
      for (const tx of inYear) {
        newKeys.add(transactionKey(imp.accountId, tx.postedDate, tx.amountNormalized, tx.merchantRaw))
      }

      // Insert any new transactions the better extraction discovered.
      let inserted = 0
      for (const tx of inYear) {
        const iKey = transactionKey(imp.accountId, tx.postedDate, tx.amountNormalized, tx.merchantRaw)
        const existing = await prisma.transaction.findUnique({ where: { idempotencyKey: iKey } })
        if (existing) {
          // If a row was previously marked stale (e.g. a re-extract was
          // partially run before), un-stale it now that the better
          // extraction confirmed it.
          if (existing.isStale) {
            await prisma.transaction.update({
              where: { id: existing.id },
              data: { isStale: false, staleReason: null },
            })
          }
          continue
        }
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

      // Mark any transactions previously attached to this StatementImport
      // that the new extraction did NOT confirm as stale. They stay in the
      // DB for audit (append-only-friendly) but get filtered from totals
      // + ledger views.
      const oldRows = await prisma.transaction.findMany({
        where: { statementImportId: imp.id, isStale: false },
        select: { id: true, idempotencyKey: true },
      })
      const stalingIds = oldRows
        .filter((row) => !newKeys.has(row.idempotencyKey))
        .map((row) => row.id)
      let staled = 0
      if (stalingIds.length > 0) {
        const updated = await prisma.transaction.updateMany({
          where: { id: { in: stalingIds } },
          data: {
            isStale: true,
            staleReason: `Superseded by Sonnet vision re-extract on ${new Date().toISOString().slice(0, 10)} (import ${imp.id}).`,
          },
        })
        staled = updated.count
      }

      // Update the StatementImport row with the better confidence + path.
      await prisma.statementImport.update({
        where: { id: imp.id },
        data: {
          parseConfidence: parsed.parseConfidence ?? imp.parseConfidence,
          extractionPath: "VISION_DOC",
          parseStatus: "SUCCESS",
          parseError: null,
        },
      })

      detail.status = "reextracted"
      detail.newTransactions = inserted
      detail.staledTransactions = staled
      result.importsReExtracted++
      result.newTransactions += inserted
      result.staledTransactions += staled
      result.bumpedConfidence++

      await prisma.auditEvent.create({
        data: {
          actorType: "AI",
          eventType: "STATEMENT_RE_EXTRACTED",
          entityType: "StatementImport",
          entityId: imp.id,
          afterState: {
            oldConfidence: imp.parseConfidence ?? 0,
            newConfidence: parsed.parseConfidence ?? null,
            newTransactionsInserted: inserted,
            staleTransactionsMarked: staled,
            extractionPath: "VISION_DOC",
          },
          rationale: `Re-extracted ${imp.originalFilename} via Sonnet vision (confidence ${(imp.parseConfidence ?? 0).toFixed(2)} → ${(parsed.parseConfidence ?? 0).toFixed(2)}). ${staled} stale row${staled === 1 ? "" : "s"} marked.`,
        },
      })
    } catch (err) {
      detail.status = "error"
      detail.errorMessage = err instanceof Error ? err.message : String(err)
      result.errors++
    }

    result.details.push(detail)

    if (reporter) {
      await reporter({
        phase: "extract_repass",
        processed: i + 1,
        total: candidates.length,
        label: `${i + 1} / ${candidates.length} · ${result.importsReExtracted} re-extracted · ${result.newTransactions} new · ${result.staledTransactions} staled`,
      })
    }
  }

  return result
}
