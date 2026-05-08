import { redirect } from "next/navigation"

interface Props {
  params: Promise<{ year: string }>
}

/**
 * /years/[year]/lock now redirects to /finalize#lock — the unified handoff
 * page introduced in Tier 3.9. Kept as a route so deep links / bookmarks /
 * pre-existing redirects from elsewhere in the app keep working.
 */
export default async function LockPageRedirect({ params }: Props) {
  const { year } = await params
  redirect(`/years/${year}/finalize#lock`)
}
