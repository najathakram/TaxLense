import { notFound, redirect } from "next/navigation"
import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { relevantDocSlugsForEntity, getDocStatuses, DOC_REGISTRY } from "@/lib/reports/documentRegistry"
import { DocumentsIndex } from "./documents-index"

interface Props {
  params: Promise<{ year: string }>
  searchParams?: Promise<{ kind?: string }>
}

export default async function DocumentsPage({ params, searchParams }: Props) {
  const { year: yearParam } = await params
  const sp = (await searchParams) ?? {}
  const userId = await getCurrentUserId()
  const year = parseInt(yearParam, 10)
  if (isNaN(year)) notFound()

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    include: { businessProfile: { select: { entityType: true } } },
  })
  if (!taxYear) notFound()

  const entityType = taxYear.businessProfile?.entityType ?? "SOLE_PROP"
  const slugs = relevantDocSlugsForEntity(entityType)
  const statuses = await getDocStatuses(taxYear.id)

  // If no specific kind picked, redirect to the first one in the list.
  if (!sp.kind && slugs.length > 0) {
    redirect(`/years/${year}/documents/${slugs[0]}`)
  }

  // Page actually shouldn't render — every doc redirects. But fallback safe:
  return (
    <DocumentsIndex
      year={year}
      isLocked={taxYear.status === "LOCKED"}
      entityType={entityType}
      slugs={slugs}
      statuses={Array.from(statuses.values())}
      registry={Object.fromEntries(slugs.map((s) => [s, {
        slug: s,
        displayName: DOC_REGISTRY[s].displayName,
        shortName: DOC_REGISTRY[s].shortName,
        group: DOC_REGISTRY[s].group,
        authority: DOC_REGISTRY[s].authority,
        requiresLock: DOC_REGISTRY[s].requiresLock,
      }]))}
    />
  )
}
