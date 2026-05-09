import { redirect } from "next/navigation"
import { Section, Card } from "@/components/v2/primitives"
import { getCurrentCpaContext } from "@/lib/cpa/clientContext"
import { getAdminCpaContext } from "@/lib/admin/adminContext"

export default async function CalendarPage() {
  // B-10: CPA-only route. Redirect CLIENT-tier users to their dashboard so
  // they don't land on a "Coming in V2" placeholder that wasn't built for
  // them.
  const [cpaCtx, adminCpaCtx] = await Promise.all([
    getCurrentCpaContext(),
    getAdminCpaContext(),
  ])
  if (!cpaCtx && !adminCpaCtx) redirect("/dashboard")

  return (
    <Section sub="WORKSPACE · CALENDAR" title="Deadlines & milestones">
      <Card pad={48} style={{ textAlign: "center", color: "var(--fg-3)" }}>
        <div style={{ fontSize: 14 }}>Calendar view — coming in V2</div>
        <div style={{ fontSize: 11, marginTop: 8 }}>
          Full IRS deadlines + per-client milestones will populate here.
        </div>
      </Card>
    </Section>
  )
}
