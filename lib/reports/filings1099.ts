/**
 * 1099-NEC issuance — derive contractor candidates from the locked ledger,
 * persist W-9 / Form1099Filing rows, generate Copy A / B / C PDFs, build
 * IRS-FIRE / IRIS-format CSV for electronic filing.
 *
 * Authority:
 *   - IRC §6041, §6041A; Reg §1.6041-1
 *   - Form 1099-NEC Instructions Rev. January 2025
 *   - T.D. 9972 (e-file threshold lowered to 10 returns starting TY2023)
 *   - Reg §1.6049-4(c)(1)(ii) (corporation exemption — except legal/medical)
 *
 * NEC Box 1 threshold: $600/year per recipient (Reg §1.6041-1).
 */

import { prisma } from "@/lib/db"
import { inYearWindow } from "@/lib/queries/yearWindow"

const NEC_THRESHOLD_DOLLARS = 600
const E_FILE_THRESHOLD_RETURNS = 10

export interface ContractorCandidate {
  /** Aggregated payee name (best-effort from merchant text). */
  payeeName: string
  totalDollars: number
  txCount: number
  txIds: string[]
  /** True if a W-9 is on file for this (TaxYear, payee). */
  hasW9: boolean
  /** True if the W-9 marks the recipient as a corporation (exempt). */
  isCorporationExempt: boolean
  /** True if the W-9 marks legal/medical (corporations still get NEC). */
  isLegalOrMedical: boolean
  /** Existing Form1099Filing if already created. */
  existingFilingId: string | null
}

/**
 * Identify all contractor payees who received ≥ $600 of WRITE_OFF
 * Contract Labor (Schedule C Line 11 / 1120-S Line 8) classifications
 * during the tax year. Aggregates by counterparty using extractCounterparty
 * when possible (clean person names from ACH INDN / Wise / Zelle / Venmo)
 * and falls back to the raw merchant string otherwise.
 */
export async function deriveContractorCandidates(
  taxYearId: string,
): Promise<ContractorCandidate[]> {
  const ty = await prisma.taxYear.findUniqueOrThrow({
    where: { id: taxYearId },
    select: { year: true },
  })
  const yw = inYearWindow(ty.year)

  const txns = await prisma.transaction.findMany({
    where: {
      taxYearId,
      isSplit: false,
      isStale: false,
      ...yw,
      classifications: {
        some: {
          isCurrent: true,
          OR: [
            { scheduleCLine: { contains: "Line 11", mode: "insensitive" } },
            { scheduleCLine: { contains: "Contract Labor", mode: "insensitive" } },
            { scheduleCLine: { contains: "Compensation of officers", mode: "insensitive" } },
            { scheduleCLine: { contains: "Salaries", mode: "insensitive" } },
            { scheduleCLine: { contains: "Guaranteed payments", mode: "insensitive" } },
          ],
        },
      },
    },
    include: { classifications: { where: { isCurrent: true }, take: 1 } },
  })

  // Best-effort counterparty extraction (re-uses lib/pairing/p2pRoundTrip)
  const { extractCounterparty } = await import("@/lib/pairing/p2pRoundTrip")

  const groups = new Map<
    string,
    { totalDollars: number; txCount: number; txIds: string[] }
  >()
  for (const t of txns) {
    const c = t.classifications[0]
    if (!c) continue
    const counterparty = extractCounterparty(t.merchantRaw) ?? t.merchantRaw.slice(0, 80)
    if (!counterparty) continue
    const amt = Math.abs(Number(t.amountNormalized.toString())) * (c.businessPct / 100)
    let g = groups.get(counterparty)
    if (!g) {
      g = { totalDollars: 0, txCount: 0, txIds: [] }
      groups.set(counterparty, g)
    }
    g.totalDollars += amt
    g.txCount++
    g.txIds.push(t.id)
  }

  // Pull existing W-9s + filings to merge state
  const [w9s, filings] = await Promise.all([
    prisma.w9Submission.findMany({ where: { taxYearId } }),
    prisma.form1099Filing.findMany({ where: { taxYearId } }),
  ])
  const w9ByName = new Map(w9s.map((w) => [w.payeeName.toUpperCase(), w]))
  const filingByName = new Map(filings.map((f) => [f.recipientName.toUpperCase(), f]))

  const candidates: ContractorCandidate[] = []
  for (const [name, g] of groups) {
    if (g.totalDollars < NEC_THRESHOLD_DOLLARS) continue
    const w9 = w9ByName.get(name.toUpperCase())
    const filing = filingByName.get(name.toUpperCase())
    candidates.push({
      payeeName: name,
      totalDollars: g.totalDollars,
      txCount: g.txCount,
      txIds: g.txIds,
      hasW9: !!w9 && w9.status === "RECEIVED",
      isCorporationExempt:
        !!w9 &&
        w9.isEntityCorporation &&
        !w9.taxClassification?.toLowerCase().includes("legal") &&
        !w9.taxClassification?.toLowerCase().includes("medical"),
      isLegalOrMedical:
        !!w9 &&
        (w9.taxClassification?.toLowerCase().includes("legal") ||
          w9.taxClassification?.toLowerCase().includes("medical")) ||
        false,
      existingFilingId: filing?.id ?? null,
    })
  }

  candidates.sort((a, b) => b.totalDollars - a.totalDollars)
  return candidates
}

// ─────────────────────────────────────────────────────────────────────────
// IRS FIRE / IRIS CSV format — IRS Pub 1220 spec for Form 1099-NEC.
// FIRE accepts ASCII text; the CSV here is the pre-conversion format
// suitable for upload to IRIS (Information Returns Intake System).
// ─────────────────────────────────────────────────────────────────────────

export interface BuildIris1099CsvOptions {
  payerName: string
  payerEin: string
  payerAddress: { line1: string; city: string; state: string; postal: string }
  taxYear: number
}

export async function buildIris1099Csv(
  taxYearId: string,
  opts: BuildIris1099CsvOptions,
): Promise<Buffer> {
  const filings = await prisma.form1099Filing.findMany({
    where: { taxYearId },
    orderBy: { recipientName: "asc" },
  })

  const lines: string[] = []
  // IRIS template header — the live IRIS CSV template is more elaborate;
  // this matches the public sample at irs.gov/iris (TY2025 layout).
  lines.push(
    [
      "PayerName",
      "PayerEIN",
      "PayerAddressLine1",
      "PayerCity",
      "PayerState",
      "PayerZip",
      "TaxYear",
      "RecipientName",
      "RecipientTIN",
      "RecipientAddressLine1",
      "RecipientCity",
      "RecipientState",
      "RecipientZip",
      "Box1NonemployeeComp",
      "Box4FedTaxWithheld",
    ].join(","),
  )

  for (const f of filings) {
    const addr = (f.recipientAddress as Record<string, string> | null) ?? {}
    lines.push(
      [
        csvEscape(opts.payerName),
        csvEscape(opts.payerEin),
        csvEscape(opts.payerAddress.line1),
        csvEscape(opts.payerAddress.city),
        csvEscape(opts.payerAddress.state),
        csvEscape(opts.payerAddress.postal),
        opts.taxYear,
        csvEscape(f.recipientName),
        csvEscape(f.recipientTin ?? ""),
        csvEscape(addr.line1 ?? ""),
        csvEscape(addr.city ?? ""),
        csvEscape(addr.state ?? ""),
        csvEscape(addr.postal ?? ""),
        f.box1NonemployeeComp?.toString() ?? "0",
        f.box4FederalTaxWithheld?.toString() ?? "0",
      ].join(","),
    )
  }

  return Buffer.from(lines.join("\n"), "utf8")
}

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export const FORM_1099_THRESHOLDS = {
  NEC_DOLLARS: NEC_THRESHOLD_DOLLARS,
  E_FILE_RETURNS: E_FILE_THRESHOLD_RETURNS,
} as const
