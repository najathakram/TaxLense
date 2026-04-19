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
import { buildMasterLedger } from "./masterLedger"
import { buildFinancialStatements } from "./financialStatements"

function bufferToStream(buf: Buffer): Readable {
  const pt = new PassThrough()
  pt.end(buf)
  return pt
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
