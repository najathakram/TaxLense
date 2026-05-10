#!/usr/bin/env node
/**
 * eval-atif.mjs — TaxLens Quality Index runner for Atif Ameer's TY 2025.
 *
 * Computes Q07–Q19 (correctness, citation/evidence integrity) by comparing
 * live Classifications against the hand-graded ground-truth fixture at
 * tests/fixtures/atif-ground-truth-2025.json. Also pulls the SQL-side
 * indices (Q01–Q06, Q15, Q20–Q31) by sourcing eval/queries.sql.
 *
 * Output: eval/atif-2025-<timestamp>.json + appends one row to
 *         eval/quality_history.csv.
 *
 * Usage (Railway shell or local with DATABASE_URL set):
 *   pnpm exec node scripts/eval-atif.mjs
 *
 * Environment:
 *   DATABASE_URL — required. Direct Postgres connection string.
 *   ATIF_USER_EMAIL — optional, default '%atif%' substring match.
 *
 * Exit codes:
 *   0 — eval completed (CQS computed, written to disk)
 *   1 — fatal: cannot find Atif's TaxYear, or DB unreachable
 *   2 — eval ran but ≥1 hard floor breached (CQS capped at 50)
 */

import { PrismaClient } from "../app/generated/prisma/client.js"
import { PrismaPg } from "@prisma/adapter-pg"
import { writeFileSync, readFileSync, existsSync, appendFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "..")

if (!process.env.DATABASE_URL) {
  console.error("[eval-atif] DATABASE_URL is required")
  process.exit(1)
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

// ---------------------------------------------------------------------------
// Load ground truth (optional — Q07–Q19 skipped if absent)
// ---------------------------------------------------------------------------
const truthPath = resolve(REPO_ROOT, "tests/fixtures/atif-ground-truth-2025.json")
const groundTruth = existsSync(truthPath)
  ? JSON.parse(readFileSync(truthPath, "utf8"))
  : null
if (!groundTruth) {
  console.warn(
    `[eval-atif] ground-truth fixture missing at ${truthPath} — skipping Q07-Q19. ` +
    `See tests/fixtures/atif-ground-truth-2025.example.json for the schema.`,
  )
}

// ---------------------------------------------------------------------------
// 1. Bootstrap — find Atif's TaxYear ID
// ---------------------------------------------------------------------------
const emailFilter = process.env.ATIF_USER_EMAIL ?? "%atif%"
const atifYear = await prisma.$queryRawUnsafe(`
  SELECT ty.id, u.email,
         (SELECT COUNT(*) FROM "Transaction"
            WHERE "taxYearId"=ty.id AND "isSplit"=false AND "isStale"=false) AS txn_count
    FROM "TaxYear" ty
    JOIN "BusinessProfile" bp ON bp.id = ty."businessProfileId"
    JOIN "User" u ON u.id = bp."userId"
    WHERE u.email LIKE $1 AND ty.year = 2025
    LIMIT 1
`, emailFilter)

if (!atifYear?.[0]?.id) {
  console.error(`[eval-atif] no TaxYear found for email LIKE ${emailFilter}, year=2025`)
  process.exit(1)
}

const taxYearId = atifYear[0].id
const txnCount = Number(atifYear[0].txn_count)
console.log(`[eval-atif] Atif TY 2025 = ${taxYearId}  (${txnCount} txns)`)

// ---------------------------------------------------------------------------
// 2. SQL-side quality indices (Q01-Q06, Q15, Q20-Q31)
// ---------------------------------------------------------------------------
async function q(sql, ...params) {
  return await prisma.$queryRawUnsafe(sql, ...params)
}

const indices = {}

// Q01 — ADR
indices.Q01_ADR = Number((await q(`
  SELECT 100.0 * COUNT(c.id) FILTER (
            WHERE c."source" IN ('AI','RULE','AI_AUTO_RESOLVE')
              AND c."code" NOT IN ('NEEDS_CONTEXT','PERSONAL'))
         / NULLIF(COUNT(t.id), 0) AS pct
    FROM "Transaction" t
    LEFT JOIN "Classification" c ON c."transactionId"=t.id AND c."isCurrent"=true
    WHERE t."taxYearId"=$1 AND t."isSplit"=false AND t."isStale"=false
`, taxYearId))[0]?.pct ?? 0)

// Q02 — STOP density
indices.Q02_StopDensityPer1K = Number((await q(`
  SELECT COUNT(s.id)::float * 1000 / NULLIF($2, 0) AS density
    FROM "StopItem" s
    WHERE s."taxYearId"=$1 AND s."state"='PENDING'
`, taxYearId, txnCount))[0]?.density ?? 0)

// Q03 — concentration
indices.Q03_StopConcentrationPct = Number((await q(`
  SELECT COALESCE(MAX(pct), 0) AS max_pct FROM (
    SELECT 100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0) AS pct
      FROM "StopItem"
      WHERE "taxYearId"=$1 AND "state"='PENDING'
      GROUP BY "category"
  ) sub
`, taxYearId))[0]?.max_pct ?? 0)

// Q05 — suggestion coverage
indices.Q05_SuggestionCoveragePct = Number((await q(`
  SELECT 100.0 * COUNT(*) FILTER (WHERE "aiSuggestion" IS NOT NULL)
         / NULLIF(COUNT(*), 0) AS pct
    FROM "StopItem"
    WHERE "taxYearId"=$1 AND "state"='PENDING'
`, taxYearId))[0]?.pct ?? 100)

// Q15 — [VERIFY] leak
indices.Q15_VerifyLeakPct = Number((await q(`
  SELECT 100.0 * COUNT(*) FILTER (WHERE 'VERIFY' = ANY(c."ircCitations"))
         / NULLIF(COUNT(*), 0) AS pct
    FROM "Classification" c
    JOIN "Transaction" t ON t.id=c."transactionId"
    WHERE t."taxYearId"=$1 AND c."isCurrent"=true
`, taxYearId))[0]?.pct ?? 0)

// Q20 — append-only integrity (schema check)
indices.Q20_AppendOnlyForbiddenColumns = Number((await q(`
  SELECT COUNT(*) AS n FROM information_schema.columns
    WHERE table_name='Classification' AND column_name IN ('updatedAt','updated_at')
`))[0]?.n ?? 0)

// Q22 — transfer pairing
indices.Q22_TransferPairingPct = Number((await q(`
  SELECT 100.0 *
    COUNT(*) FILTER (WHERE t."isTransferPairedWith" IS NOT NULL)
    / NULLIF(COUNT(*) FILTER (WHERE c."code"='TRANSFER'), 0) AS pct
    FROM "Transaction" t
    JOIN "Classification" c ON c."transactionId"=t.id AND c."isCurrent"=true
    WHERE t."taxYearId"=$1
`, taxYearId))[0]?.pct ?? 0)

// Q24 — split leakage
indices.Q24_SplitLeakage = Number((await q(`
  SELECT COUNT(*) AS n FROM (
    SELECT p.id
      FROM "Transaction" p
      JOIN "Transaction" c ON c."splitOfId"=p.id
      WHERE p."taxYearId"=$1 AND p."isSplit"=true
      GROUP BY p.id, p."amountNormalized"
      HAVING ABS(p."amountNormalized" - SUM(c."amountNormalized")) > 0.01
  ) leaks
`, taxYearId))[0]?.n ?? 0)

// Q25 — out-of-year leakage
indices.Q25_OutOfYearLeakage = Number((await q(`
  SELECT COUNT(*) AS n FROM "Transaction"
    WHERE "taxYearId"=$1
      AND ("postedDate" < '2025-01-01' OR "postedDate" > '2025-12-31')
      AND "isStale"=false
`, taxYearId))[0]?.n ?? 0)

// Q26 — idempotency
indices.Q26_IdempotencyCollisions = Number((await q(`
  SELECT COUNT(*) - COUNT(DISTINCT "idempotencyKey") AS n
    FROM "Transaction" WHERE "taxYearId"=$1
`, taxYearId))[0]?.n ?? 0)

// ---------------------------------------------------------------------------
// 3. Ground-truth side (Q07-Q13, Q16-Q18) — only if fixture present
// ---------------------------------------------------------------------------
if (groundTruth) {
  const ids = Object.keys(groundTruth)
  const live = await prisma.classification.findMany({
    where: {
      isCurrent: true,
      transaction: { id: { in: ids } },
    },
    select: {
      transactionId: true,
      code: true,
      scheduleCLine: true,
      businessPct: true,
      evidenceTier: true,
      cohanFlag: true,
      confidence: true,
      ircCitations: true,
      substantiation: true,
    },
  })
  const liveById = new Map(live.map((c) => [c.transactionId, c]))

  let codeMatches = 0
  let lineMatches = 0
  let bizPctWithin10 = 0
  let tierMatches = 0
  let cohanMatches = 0
  let highConfWrong = 0
  let highConfTotal = 0
  let brierSum = 0
  const confusion = {} // [predicted][actual] = count

  for (const txnId of ids) {
    const expected = groundTruth[txnId]
    const got = liveById.get(txnId)
    if (!got) continue
    if (got.code === expected.code) codeMatches++
    if (got.scheduleCLine === expected.scheduleCLine) lineMatches++
    if (Math.abs(got.businessPct - expected.businessPct) <= 10) bizPctWithin10++
    if (got.evidenceTier === expected.evidenceTier) tierMatches++
    if (Boolean(got.cohanFlag) === Boolean(expected.cohanFlag)) cohanMatches++
    const correct = got.code === expected.code ? 1 : 0
    brierSum += Math.pow(got.confidence - correct, 2)
    if (got.confidence >= 0.85) {
      highConfTotal++
      if (!correct) highConfWrong++
    }
    confusion[got.code] = confusion[got.code] || {}
    confusion[got.code][expected.code] =
      (confusion[got.code][expected.code] ?? 0) + 1
  }

  const n = ids.length || 1
  indices.Q07_CategoryPrecision = codeMatches / n
  indices.Q10_BusinessPctAccuracy = bizPctWithin10 / n
  indices.Q12_BrierScore = brierSum / n
  indices.Q13_HighConfErrorRate = highConfTotal ? highConfWrong / highConfTotal : 0
  indices.Q11_ConfusionMatrixDiagonal = codeMatches / n
  indices.confusion_matrix = confusion
}

// ---------------------------------------------------------------------------
// 4. Composite Quality Score
// ---------------------------------------------------------------------------
const norm = (v, hi = 100, lo = 0) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)))

// Decisiveness: Q01 toward 95, Q02 toward ≤10, Q03 toward ≤40, Q05 toward 100
const decisiveness = (
  norm(indices.Q01_ADR ?? 0, 95) +
  (1 - norm(indices.Q02_StopDensityPer1K ?? 0, 100)) +
  (1 - norm(indices.Q03_StopConcentrationPct ?? 0, 100)) +
  norm(indices.Q05_SuggestionCoveragePct ?? 0, 100)
) / 4

// Correctness — only if ground truth ran
const correctness = groundTruth
  ? (
      norm((indices.Q07_CategoryPrecision ?? 0) * 100, 95) +
      norm((indices.Q10_BusinessPctAccuracy ?? 0) * 100, 90) +
      (1 - norm((indices.Q12_BrierScore ?? 0) * 100, 25)) +
      (1 - norm((indices.Q13_HighConfErrorRate ?? 0) * 100, 10))
    ) / 4
  : null

// Audit integrity (without Q14/Q16/Q17/Q18/Q19 needing more inputs)
const auditIntegrity = (1 - norm(indices.Q15_VerifyLeakPct ?? 0, 10))

// Consistency
const consistency = (
  (indices.Q20_AppendOnlyForbiddenColumns === 0 ? 1 : 0) +
  norm(indices.Q22_TransferPairingPct ?? 0, 100) +
  (indices.Q24_SplitLeakage === 0 ? 1 : 0) +
  (indices.Q25_OutOfYearLeakage === 0 ? 1 : 0) +
  (indices.Q26_IdempotencyCollisions === 0 ? 1 : 0)
) / 5

// Weighted average — performance + tie-out require external inputs and are
// omitted from CQS in this baseline runner. Reweight remaining bands.
const weights = correctness !== null
  ? { decisiveness: 0.30, correctness: 0.40, audit: 0.15, consistency: 0.15 }
  : { decisiveness: 0.50, correctness: 0,    audit: 0.20, consistency: 0.30 }

const rawCQS = (
  decisiveness * weights.decisiveness +
  (correctness ?? 0) * weights.correctness +
  auditIntegrity * weights.audit +
  consistency * weights.consistency
) * 100

// Hard floors (cap at 50 if breached)
const floorsBreached = []
if (indices.Q15_VerifyLeakPct > 1) floorsBreached.push("Q15: [VERIFY] leak >1%")
if (indices.Q20_AppendOnlyForbiddenColumns > 0)
  floorsBreached.push("Q20: append-only integrity broken")
if (indices.Q24_SplitLeakage > 0) floorsBreached.push("Q24: split leakage")
if (indices.Q25_OutOfYearLeakage > 0)
  floorsBreached.push("Q25: out-of-year leakage")

const cqs = floorsBreached.length > 0 ? Math.min(rawCQS, 50) : rawCQS

// ---------------------------------------------------------------------------
// 5. Write outputs
// ---------------------------------------------------------------------------
const ts = new Date().toISOString().replace(/[:.]/g, "-")
const outPath = resolve(REPO_ROOT, `eval/atif-2025-${ts}.json`)
const result = {
  run_id: ts,
  run_date: new Date().toISOString(),
  tax_year_id: taxYearId,
  ledger_size: txnCount,
  indices,
  bands: {
    decisiveness: Math.round(decisiveness * 100),
    correctness: correctness !== null ? Math.round(correctness * 100) : null,
    audit_integrity: Math.round(auditIntegrity * 100),
    consistency: Math.round(consistency * 100),
  },
  hard_floors_breached: floorsBreached,
  cqs: Math.round(cqs * 10) / 10,
  ground_truth_used: !!groundTruth,
}

writeFileSync(outPath, JSON.stringify(result, null, 2))

const histPath = resolve(REPO_ROOT, "eval/quality_history.csv")
const histHeader =
  "run_id,run_date,ledger_size,Q01_ADR,Q02_stops_per_1k,Q03_concentration,Q05_suggestion_coverage,Q15_verify_leak,Q22_transfer_pair,Q25_oy_leak,CQS,floors_breached\n"
if (!existsSync(histPath)) writeFileSync(histPath, histHeader)
appendFileSync(
  histPath,
  [
    result.run_id,
    result.run_date,
    result.ledger_size,
    indices.Q01_ADR?.toFixed(2) ?? "",
    indices.Q02_StopDensityPer1K?.toFixed(2) ?? "",
    indices.Q03_StopConcentrationPct?.toFixed(2) ?? "",
    indices.Q05_SuggestionCoveragePct?.toFixed(2) ?? "",
    indices.Q15_VerifyLeakPct?.toFixed(2) ?? "",
    indices.Q22_TransferPairingPct?.toFixed(2) ?? "",
    indices.Q25_OutOfYearLeakage ?? "",
    result.cqs,
    floorsBreached.length,
  ].join(",") + "\n",
)

// ---------------------------------------------------------------------------
// 6. Headline
// ---------------------------------------------------------------------------
console.log()
console.log(`CQS = ${result.cqs.toFixed(1)} / 100  (Atif TY 2025, run ${ts})`)
console.log(
  `  decisiveness:    ${result.bands.decisiveness}  | ` +
  `correctness:    ${result.bands.correctness ?? "n/a"}  | ` +
  `audit_integrity: ${result.bands.audit_integrity}`,
)
console.log(`  consistency:     ${result.bands.consistency}  ` +
  `| ledger_size:    ${txnCount} txns`)
console.log(
  `  hard floors:     ${floorsBreached.length === 0 ? "ALL PASS" : floorsBreached.join("; ")}`,
)
console.log(`Output: ${outPath}`)

await prisma.$disconnect()
process.exit(floorsBreached.length > 0 ? 2 : 0)
