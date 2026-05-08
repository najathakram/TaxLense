import { redirect } from "next/navigation"

interface Props {
  params: Promise<{ year: string }>
}

/**
 * /years/[year]/download now redirects to /finalize#download — Tier 3.9
 * collapsed Risk + Lock + Download into one page. Kept as a route so old
 * deep links / API redirects keep resolving.
 */
export default async function DownloadPageRedirect({ params }: Props) {
  const { year } = await params
  redirect(`/years/${year}/finalize#download`)
}
