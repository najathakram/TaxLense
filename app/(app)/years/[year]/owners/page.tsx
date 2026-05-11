import { notFound } from "next/navigation"
import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { OwnersClient } from "./owners-client"
import { ownershipSummary } from "./actions"

interface Props {
  params: Promise<{ year: string }>
}

export default async function OwnersPage({ params }: Props) {
  const { year: yearParam } = await params
  const userId = await getCurrentUserId()
  const year = parseInt(yearParam, 10)
  if (isNaN(year)) notFound()

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    include: {
      businessProfile: { include: { owners: { orderBy: { name: "asc" } } } },
    },
  })
  if (!taxYear) notFound()

  const profile = taxYear.businessProfile
  const summary = await ownershipSummary(taxYear.id)

  const ownersForClient = (profile?.owners ?? []).map((o) => ({
    id: o.id,
    kind: o.kind,
    name: o.name,
    email: o.email ?? "",
    ssnLast4: o.ssnLast4 ?? "",
    ein: o.ein ?? "",
    ownershipPct: Number(o.ownershipPct.toString()),
    w2Wages: o.w2Wages ? Number(o.w2Wages.toString()) : null,
    guaranteedPayments: o.guaranteedPayments ? Number(o.guaranteedPayments.toString()) : null,
    capitalContribution: o.capitalContribution ? Number(o.capitalContribution.toString()) : null,
    distributions: o.distributions ? Number(o.distributions.toString()) : null,
    stockBasis: o.stockBasis ? Number(o.stockBasis.toString()) : null,
    debtBasis: o.debtBasis ? Number(o.debtBasis.toString()) : null,
    partnerCapitalStart: o.partnerCapitalStart
      ? Number(o.partnerCapitalStart.toString())
      : null,
    bookTaxDelta: o.bookTaxDelta ? Number(o.bookTaxDelta.toString()) : null,
    addressLine1: o.addressLine1 ?? "",
    addressLine2: o.addressLine2 ?? "",
    city: o.city ?? "",
    stateRegion: o.stateRegion ?? "",
    postalCode: o.postalCode ?? "",
    countryCode: o.countryCode,
    notes: o.notes ?? "",
  }))

  return (
    <OwnersClient
      year={year}
      entityType={profile?.entityType ?? "SOLE_PROP"}
      isLocked={taxYear.status === "LOCKED"}
      owners={ownersForClient}
      summary={summary}
    />
  )
}
