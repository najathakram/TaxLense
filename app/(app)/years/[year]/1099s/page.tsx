import { notFound } from "next/navigation"
import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { deriveContractorCandidates } from "@/lib/reports/filings1099"
import { Filings1099Client } from "./filings-1099-client"

interface Props {
  params: Promise<{ year: string }>
}

export default async function Filings1099Page({ params }: Props) {
  const { year: yearParam } = await params
  const userId = await getCurrentUserId()
  const year = parseInt(yearParam, 10)
  if (isNaN(year)) notFound()

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
  })
  if (!taxYear) notFound()

  const [candidates, filings, w9s] = await Promise.all([
    deriveContractorCandidates(taxYear.id),
    prisma.form1099Filing.findMany({ where: { taxYearId: taxYear.id }, orderBy: { recipientName: "asc" } }),
    prisma.w9Submission.findMany({ where: { taxYearId: taxYear.id }, orderBy: { payeeName: "asc" } }),
  ])

  const w9Map = Object.fromEntries(w9s.map((w) => [w.payeeName.toUpperCase(), {
    payeeName: w.payeeName,
    payeeEmail: w.payeeEmail ?? "",
    businessName: w.businessName ?? "",
    taxClassification: w.taxClassification ?? "",
    tin: w.tin ?? "",
    isEntityCorporation: w.isEntityCorporation,
    isExempt: w.isExempt,
    exemptCode: w.exemptCode ?? "",
    addressLine1: w.addressLine1 ?? "",
    addressLine2: w.addressLine2 ?? "",
    city: w.city ?? "",
    stateRegion: w.stateRegion ?? "",
    postalCode: w.postalCode ?? "",
    notes: w.notes ?? "",
    status: w.status,
  }]))

  const filingsForClient = filings.map((f) => ({
    id: f.id,
    recipientName: f.recipientName,
    recipientTin: f.recipientTin ?? "",
    box1NonemployeeComp: f.box1NonemployeeComp ? Number(f.box1NonemployeeComp.toString()) : 0,
    filingPath: f.filingPath,
    filedAt: f.filedAt ? f.filedAt.toISOString().slice(0, 10) : null,
    sourceTransactionIds: f.sourceTransactionIds,
  }))

  // Pull bundle-level skip flag (stored in TaxYear.acceptedRiskOverrides).
  const overrides = (taxYear.acceptedRiskOverrides as Record<string, unknown> | null) ?? {}
  const skipAll = overrides.skip1099s === true
  const skipReason = typeof overrides.skip1099s_reason === "string" ? overrides.skip1099s_reason : ""

  return (
    <Filings1099Client
      year={year}
      isLocked={taxYear.status === "LOCKED"}
      candidates={candidates}
      filings={filingsForClient}
      w9Map={w9Map}
      skipAll={skipAll}
      skipAllReason={skipReason}
    />
  )
}
