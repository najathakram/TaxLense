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
  buildForm1120Pdf,
  buildScheduleK1PdfPerOwner,
  slugifyOwnerName,
} from "./pdf/entityForms"
import {
  buildScheduleSePdf,
  buildForm8995Pdf,
  buildForm1125APdf,
  buildForm4562Pdf,
  buildScheduleM1Pdf,
  buildScheduleM2Pdf,
  buildScheduleLPdf,
} from "./pdf/schedules"
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
    const k1s = await buildScheduleK1PdfPerOwner(taxYearId, "1120-S")
    k1s.forEach((k1, i) => {
      // Name pattern: 08a_k1_<owner-slug>.pdf to keep one prefix while sorting
      // owners alphabetically inside the ZIP.
      const idx = String.fromCharCode(0x61 + i) // a, b, c…
      const slug = slugifyOwnerName(k1.owner.name) || `owner_${i + 1}`
      out.push({ name: `08${idx}_k1_${slug}.pdf`, buffer: k1.buffer })
    })
    // Supplementary schedules — book/tax recon, capital roll-forward, balance sheet
    out.push({ name: "09_schedule_m1_1120s.pdf", buffer: await buildScheduleM1Pdf(taxYearId, "1120-S") })
    out.push({ name: "10_schedule_m2_1120s.pdf", buffer: await buildScheduleM2Pdf(taxYearId, "1120-S") })
    out.push({ name: "11_schedule_l_1120s.pdf",  buffer: await buildScheduleLPdf(taxYearId, "1120-S")  })
  } else if (entityType === "LLC_MULTI" || entityType === "PARTNERSHIP") {
    out.push({ name: "07_form_1065_worksheet.pdf", buffer: await buildForm1065Pdf(taxYearId) })
    const k1s = await buildScheduleK1PdfPerOwner(taxYearId, "1065")
    k1s.forEach((k1, i) => {
      const idx = String.fromCharCode(0x61 + i)
      const slug = slugifyOwnerName(k1.owner.name) || `partner_${i + 1}`
      out.push({ name: `08${idx}_k1_${slug}.pdf`, buffer: k1.buffer })
    })
    out.push({ name: "09_schedule_m1_1065.pdf", buffer: await buildScheduleM1Pdf(taxYearId, "1065") })
    out.push({ name: "10_schedule_m2_1065.pdf", buffer: await buildScheduleM2Pdf(taxYearId, "1065") })
    out.push({ name: "11_schedule_l_1065.pdf",  buffer: await buildScheduleLPdf(taxYearId, "1065")  })
  } else if (entityType === "C_CORP") {
    // No K-1 — C-Corp shareholders receive 1099-DIV (separate filing flow).
    out.push({ name: "07_form_1120_worksheet.pdf", buffer: await buildForm1120Pdf(taxYearId) })
    out.push({ name: "09_schedule_m1_1120.pdf", buffer: await buildScheduleM1Pdf(taxYearId, "1120") })
    out.push({ name: "11_schedule_l_1120.pdf",  buffer: await buildScheduleLPdf(taxYearId, "1120")  })
  }

  // Always-on supplementary schedules (any entity)
  out.push({ name: "12_form_1125a_cogs.pdf", buffer: await buildForm1125APdf(taxYearId) })
  out.push({ name: "13_form_4562_depreciation.pdf", buffer: await buildForm4562Pdf(taxYearId) })

  // Sole-prop only: Schedule SE + Form 8995 (QBI)
  if (entityType === "SOLE_PROP" || entityType === "LLC_SINGLE") {
    out.push({ name: "14_schedule_se.pdf",   buffer: await buildScheduleSePdf(taxYearId) })
    out.push({ name: "15_form_8995_qbi.pdf", buffer: await buildForm8995Pdf(taxYearId)  })
  }

  return out
}

export interface BuildTaxPackageOptions {
  /** Bypass the LOCKED check — used by tests only. */
  allowUnlocked?: boolean
  /**
   * Override the entity type for this build — used by the Final Dump
   * panel when the CPA wants to preview/generate as a different entity
   * without changing the BusinessProfile. AuditEvent records the
   * override so the audit trail shows the deviation.
   */
  entityOverride?: string
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
  const entityType = options.entityOverride ?? profile?.entityType ?? "SOLE_PROP"

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
