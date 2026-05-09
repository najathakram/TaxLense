import { requireAuth, getCurrentUserId } from "@/lib/auth"
import { getClientContext } from "@/lib/cpa/clientContext"
import { getAdminCpaContext } from "@/lib/admin/adminContext"
import { prisma } from "@/lib/db"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Section, Card, Btn, Pill } from "@/components/v2/primitives"
import { statusKey } from "@/components/v2/format"
import { deriveStage, getYearCounts } from "@/lib/taxYear/status"

export default async function DashboardPage() {
  const session = await requireAuth()
  const loggedInUserId = session.user!.id!

  // CPAs land here only when they don't have an active client context — they
  // belong on /workspace. Admins land on /admin. Solo CLIENTs see their own
  // tax-year list below.
  const me = await prisma.user.findUnique({ where: { id: loggedInUserId }, select: { role: true } })
  const adminCpaCtx = await getAdminCpaContext()
  const clientCtx = await getClientContext()
  if (me?.role === "SUPER_ADMIN" && !adminCpaCtx) redirect("/admin")
  if (me?.role === "CPA" && !clientCtx) redirect("/workspace")

  const userId = await getCurrentUserId()

  const taxYearsRaw = await prisma.taxYear.findMany({
    where: { userId },
    orderBy: { year: "desc" },
    include: {
      _count: { select: { financialAccounts: true } },
    },
  })

  // Per-year canonical counts + derived stage (B-02 / B-04). Done in parallel
  // so the dashboard stays fast even with several years.
  const taxYears = await Promise.all(
    taxYearsRaw.map(async (ty) => {
      const counts = await getYearCounts(ty.id)
      const derived = deriveStage(
        { status: ty.status, lockedAt: ty.lockedAt },
        counts,
      )
      return {
        ...ty,
        derivedStatus: derived,
        canonicalCounts: counts,
      }
    }),
  )

  return (
    <Section
      sub="DASHBOARD"
      title="Tax years"
      right={
        <Link href="/onboarding" style={{ textDecoration: "none" }}>
          <Btn kind="primary" icon="+">New tax year</Btn>
        </Link>
      }
    >
      {taxYears.length === 0 ? (
        <Card pad={48} style={{ textAlign: "center" }}>
          <div style={{ fontSize: 14, color: "var(--fg-2)", marginBottom: 16 }}>No tax years yet.</div>
          <Link href="/onboarding" style={{ textDecoration: "none" }}>
            <Btn kind="primary">Start Profile Wizard →</Btn>
          </Link>
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
          {taxYears.map((ty) => (
            <Link key={ty.id} href={`/years/${ty.year}`} style={{ textDecoration: "none", color: "inherit" }}>
              <Card pad={18} hoverable>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div className="num" style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.5 }}>
                    {ty.year}
                  </div>
                  <Pill s={statusKey(ty.derivedStatus)} />
                </div>
                <div style={{ fontSize: 12, color: "var(--fg-2)", marginTop: 12 }}>
                  {ty._count.financialAccounts} account
                  {ty._count.financialAccounts !== 1 ? "s" : ""} · {ty.canonicalCounts.totalTx} transaction
                  {ty.canonicalCounts.totalTx !== 1 ? "s" : ""}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </Section>
  )
}
