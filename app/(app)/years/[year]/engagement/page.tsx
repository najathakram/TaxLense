import { notFound } from "next/navigation"
import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { EngagementClient } from "./engagement-client"
import { ENGAGEMENT_DEFAULT_BODY } from "@/lib/reports/pdf/engagement"

interface Props {
  params: Promise<{ year: string }>
}

export default async function EngagementPage({ params }: Props) {
  const { year: yearParam } = await params
  const userId = await getCurrentUserId()
  const year = parseInt(yearParam, 10)
  if (isNaN(year)) notFound()

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    include: {
      user: { select: { name: true, email: true } },
      engagementLetter: true,
      form8879: true,
      filingMilestones: { orderBy: { occurredAt: "desc" } },
    },
  })
  if (!taxYear) notFound()

  const clientName = taxYear.user.name ?? taxYear.user.email
  const defaultBody = ENGAGEMENT_DEFAULT_BODY(year, clientName)

  return (
    <EngagementClient
      year={year}
      isLocked={taxYear.status === "LOCKED"}
      defaultBody={defaultBody}
      defaultClientName={clientName}
      defaultClientEmail={taxYear.user.email}
      engagement={
        taxYear.engagementLetter
          ? {
              bodyMarkdown: taxYear.engagementLetter.bodyMarkdown,
              clientName: taxYear.engagementLetter.clientName ?? clientName,
              clientEmail: taxYear.engagementLetter.clientEmail ?? taxYear.user.email,
              signatureStatus: taxYear.engagementLetter.signatureStatus,
              cpaSignedAt: taxYear.engagementLetter.cpaSignedAt?.toISOString() ?? null,
              clientSignedAt: taxYear.engagementLetter.clientSignedAt?.toISOString() ?? null,
              signatureToken: taxYear.engagementLetter.signatureToken ?? null,
            }
          : null
      }
      form8879={
        taxYear.form8879
          ? {
              totalIncomeUsd: Number(taxYear.form8879.totalIncomeUsd.toString()),
              taxableIncomeUsd: Number(taxYear.form8879.taxableIncomeUsd.toString()),
              totalTaxUsd: Number(taxYear.form8879.totalTaxUsd.toString()),
              refundOrAmtDue: Number(taxYear.form8879.refundOrAmtDue.toString()),
              eroPin: taxYear.form8879.eroPin ?? "",
              taxpayerPin: taxYear.form8879.taxpayerPin ?? "",
              signatureStatus: taxYear.form8879.signatureStatus,
              signedAt: taxYear.form8879.signedAt?.toISOString() ?? null,
            }
          : null
      }
      filingMilestones={taxYear.filingMilestones.map((m) => ({
        id: m.id,
        status: m.status,
        occurredAt: m.occurredAt.toISOString(),
        notes: m.notes ?? "",
        externalRef: m.externalRef ?? "",
      }))}
    />
  )
}
