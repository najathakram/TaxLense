import { notFound } from "next/navigation"
import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import {
  DOC_REGISTRY,
  relevantDocSlugsForEntity,
  getDocStatuses,
  type DocKindSlug,
} from "@/lib/reports/documentRegistry"
import { DocumentViewer } from "../document-viewer"

interface Props {
  params: Promise<{ year: string; kind: string }>
}

export default async function DocumentKindPage({ params }: Props) {
  const { year: yearParam, kind } = await params
  const userId = await getCurrentUserId()
  const year = parseInt(yearParam, 10)
  if (isNaN(year)) notFound()

  const spec = DOC_REGISTRY[kind as DocKindSlug]
  if (!spec) notFound()

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    include: { businessProfile: { select: { entityType: true } } },
  })
  if (!taxYear) notFound()

  const entityType = taxYear.businessProfile?.entityType ?? "SOLE_PROP"
  const slugs = relevantDocSlugsForEntity(entityType)
  const statuses = await getDocStatuses(taxYear.id)
  const status = statuses.get(spec.slug)!

  return (
    <DocumentViewer
      year={year}
      isLocked={taxYear.status === "LOCKED"}
      entityType={entityType}
      activeSlug={spec.slug}
      activeSpec={{
        slug: spec.slug,
        displayName: spec.displayName,
        shortName: spec.shortName,
        group: spec.group,
        authority: spec.authority,
        requiresLock: spec.requiresLock,
      }}
      activeStatus={status}
      sidebarSlugs={slugs}
      sidebarStatuses={Array.from(statuses.values())}
      sidebarMeta={Object.fromEntries(
        slugs.map((s) => [s, { displayName: DOC_REGISTRY[s].displayName, shortName: DOC_REGISTRY[s].shortName, group: DOC_REGISTRY[s].group }]),
      )}
    />
  )
}
