/**
 * Tax Package ZIP — Session 9 §C.
 *
 * Produces a ZIP with:
 *  01_client_summary.pdf
 *  02_schedule_c_worksheet.pdf
 *  03_form_8829.pdf
 *  04_depreciation.pdf
 *  05_1099_nec_recipients.csv
 *  06_cpa_handoff.pdf
 *  financial_statements.xlsx   (reused)
 *  master_ledger.xlsx          (reused)
 *  README.md
 *
 * Only generatable when TaxYear.status === "LOCKED".
 */

import archiver from "archiver"
import { PassThrough, Readable } from "node:stream"
import { prisma } from "@/lib/db"
import {
  buildClientSummaryPdf,
  buildScheduleCWorksheetPdf,
  buildForm8829Pdf,
  buildDepreciationSchedulePdf,
  buildCpaHandoffPdf,
  build1099NecCsv,
} from "./pdf/documents"
import {
  buildForm1120SPdf,
  buildForm1065Pdf,
  buildScheduleK1Pdf,
} from "./pdf/entityForms"
import { buildMasterLedger } from "./masterLedger"
import { buildFinancialStatements } from "./financialStatements"

function bufferToStream(buf: Buffer): Readable {
  const pt = new PassThrough()
  pt.end(buf)
  return pt
}

interface EntityFormFile {
  name: string
  buffer: Buffer
}

/**
 * Phase 3 — entity-specific tax-form PDFs. Phases 1/2 ship Schedule C as
 * the only output; this branches on entityType:
 *   S_CORP → Form 1120-S worksheet + Schedule K-1 (single-owner default)
 *   LLC_MULTI / PARTNERSHIP → Form 1065 worksheet + Schedule K-1
 *   SOLE_PROP / LLC_SINGLE / C_CORP → empty (sole prop already covered;
 *                                            C_CORP scheduled for Phase 4).
 */
async function loadEntityForms(taxYearId: string, entityType: string): Promise<EntityFormFile[]> {
  const out: EntityFormFile[] = []
  if (entityType === "S_CORP") {
    out.push({ name: "07_form_1120s_worksheet.pdf", buffer: await buildForm1120SPdf(taxYearId) })
    out.push({ name: "08_schedule_k1_1120s.pdf", buffer: await buildScheduleK1Pdf(taxYearId, { sourceForm: "1120-S" }) })
  } else if (entityType === "LLC_MULTI" || entityType === "PARTNERSHIP") {
    out.push({ name: "07_form_1065_worksheet.pdf", buffer: await buildForm1065Pdf(taxYearId) })
    out.push({ name: "08_schedule_k1_1065.pdf", buffer: await buildScheduleK1Pdf(taxYearId, { sourceForm: "1065" }) })
  }
  // C_CORP form 1120 deferred to Phase 4.
  return out
}

export interface BuildTaxPackageOptions {
  /** Bypass the LOCKED check — used by tests only. */
  allowUnlocked?: boolean
}

export async function buildTaxPackage(
  taxYearId: string,
  options: BuildTaxPackageOptions = {},
): Promise<Buffer> {
  const ty = await prisma.taxYear.findUniqueOrThrow({
    where: { id: taxYearId },
    select: { id: true, year: true, status: true, lockedSnapshotHash: true },
  })

  if (!options.allowUnlocked && ty.status !== "LOCKED") {
    throw new Error("Tax year must be LOCKED before generating a tax package")
  }

  // Branch on entity type — Schedule C package vs 1120-S/K-1 vs 1065/K-1.
  const profile = await prisma.businessProfile.findUnique({
    where: { taxYearId },
    select: { entityType: true },
  })
  const entityType = profile?.entityType ?? "SOLE_PROP"

  const [
    clientSummary,
    schedCWorksheet,
    form8829,
    depreciation,
    handoff,
    necCsv,
    masterLedgerXlsx,
    financialsXlsx,
  ] = await Promise.all([
    buildClientSummaryPdf(taxYearId),
    buildScheduleCWorksheetPdf(taxYearId),
    buildForm8829Pdf(taxYearId),
    buildDepreciationSchedulePdf(taxYearId),
    buildCpaHandoffPdf(taxYearId),
    build1099NecCsv(taxYearId),
    buildMasterLedger(taxYearId),
    buildFinancialStatements(taxYearId),
  ])

  const entityForms = await loadEntityForms(taxYearId, entityType)

  return new Promise<Buffer>((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } })
    const passthrough = new PassThrough()
    const chunks: Buffer[] = []

    passthrough.on("data", (chunk: Buffer) => chunks.push(chunk))
    passthrough.on("end", () => resolve(Buffer.concat(chunks)))
    passthrough.on("error", reject)
    archive.on("error", reject)
    archive.pipe(passthrough)

    archive.append(bufferToStream(clientSummary),  { name: "01_client_summary.pdf" })
    archive.append(bufferToStream(schedCWorksheet), { name: "02_schedule_c_worksheet.pdf" })
    archive.append(bufferToStream(form8829),        { name: "03_form_8829.pdf" })
    archive.append(bufferToStream(depreciation),    { name: "04_depreciation.pdf" })
    archive.append(necCsv,                          { name: "05_1099_nec_recipients.csv" })
    archive.append(bufferToStream(handoff),         { name: "06_cpa_handoff.pdf" })

    // Entity-specific forms ride alongside the Schedule C package — the CPA
    // can pick whichever one matches the taxpayer's entity. For an S-Corp
    // client these are the primary deliverables; for a sole prop they're
    // omitted entirely.
    for (const f of entityForms) {
      archive.append(bufferToStream(f.buffer), { name: f.name })
    }

    archive.append(bufferToStream(masterLedgerXlsx), { name: "master_ledger.xlsx" })
    archive.append(bufferToStream(financialsXlsx),  { name: "financial_statements.xlsx" })

    const readme = `# TaxLens — Tax Package (Year ${ty.year})

Generated: ${new Date().toISOString()}
Ledger hash: ${ty.lockedSnapshotHash ?? "[unlocked]"}

## Contents

  01_client_summary.pdf          Bottom-line figures
  02_schedule_c_worksheet.pdf    Part I / II line totals
  03_form_8829.pdf               Home office (if applicable)
  04_depreciation.pdf            Line 13 summary — §168(k) / §179 / §280F
  05_1099_nec_recipients.csv     Contractors paid ≥ $600
  06_cpa_handoff.pdf             Handoff letter with decision points
  financial_statements.xlsx       5-sheet workbook (reused)
  master_ledger.xlsx              Full ledger + merchant rules + STOP resolutions (reused)

The CPA signs the return, not TaxLens. Gray-zone positions live in the
audit packet (04_position_memos/). Any [VERIFY] placeholder means TaxLens
did not have evidence for that field and it must be confirmed manually.
`
    archive.append(readme, { name: "README.md" })
    archive.finalize()
  })
}
