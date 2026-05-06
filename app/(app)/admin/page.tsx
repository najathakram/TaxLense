import { redirect } from "next/navigation"
import { prisma } from "@/lib/db"
import { getCurrentAdminContext } from "@/lib/admin/adminContext"
import { Section, KPI, Card, Btn, fmtUSD, relTime } from "@/components/v2/primitives"
import Link from "next/link"

export default async function AdminHomePage() {
  const admin = await getCurrentAdminContext()
  if (!admin) redirect("/workspace")

  const [
    activeCpas,
    totalClients,
    lockedYTD,
    deductionsAgg,
    recentEvents,
  ] = await Promise.all([
    prisma.user.count({ where: { role: "CPA", isActive: true } }),
    prisma.user.count({ where: { role: "CLIENT" } }),
    prisma.taxYear.count({ where: { status: "LOCKED" } }),
    prisma.classification.aggregate({
      where: { isCurrent: true, code: { in: ["WRITE_OFF", "WRITE_OFF_TRAVEL", "WRITE_OFF_COGS", "MEALS_50", "MEALS_100", "GRAY"] } },
      _count: true,
    }),
    prisma.auditEvent.findMany({
      where: { actorAdminUserId: { not: null } },
      orderBy: { occurredAt: "desc" },
      take: 12,
      include: { actorAdmin: { select: { name: true, email: true } } },
    }),
  ])
  void deductionsAgg

  // Simple "alerts" derived from observable data
  type Alert = { sev: "warn" | "info" | "mute"; title: string; detail: string; href: string }
  const alerts: Alert[] = []
  const recentParseFails = await prisma.statementImport.count({
    where: { parseStatus: "FAILED", uploadedAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
  })
  if (recentParseFails > 0) {
    alerts.push({ sev: "warn", title: "PARSE_FAIL spike", detail: `${recentParseFails} imports failed in the last 24h`, href: "/admin/audit" })
  }
  const newCpas = await prisma.user.findMany({
    where: { role: "CPA", createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
    select: { id: true, name: true, email: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 3,
  })
  for (const c of newCpas) {
    alerts.push({
      sev: "info",
      title: "NEW_CPA onboarded",
      detail: `${c.name ?? c.email} signed up ${relTime(c.createdAt)}`,
      href: "/admin/cpas",
    })
  }
  const inactiveCpas = await prisma.user.count({
    where: {
      role: "CPA",
      sessions: { none: { expires: { gte: new Date(Date.now() - 90 * 86400 * 1000) } } },
    },
  })
  if (inactiveCpas > 0) {
    alerts.push({ sev: "mute", title: "LOGIN_INACTIVE", detail: `${inactiveCpas} CPAs not logged in for 90+ days`, href: "/admin/cpas" })
  }
  if (alerts.length === 0) {
    alerts.push({ sev: "info", title: "All clear", detail: "No alerts in the last 24 hours", href: "/admin/audit" })
  }

  return (
    <>
      <Section
        sub="ADMIN · DASHBOARD"
        title="Platform overview"
        right={
          <>
            <Btn>Export</Btn>
            <Link href="/admin/cpas/new" style={{ textDecoration: "none" }}>
              <Btn kind="primary" icon="+">Add CPA</Btn>
            </Link>
          </>
        }
      >
        <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
          <KPI label="Active CPAs" value={activeCpas} accent="var(--tl-accent)" />
          <KPI label="Total clients" value={totalClients} />
          <KPI label="Locked YTD" value={lockedYTD} accent="var(--tl-green)" />
          <KPI label="Deductions YTD" value={fmtUSD(0)} sub="claimed across firm" />
          <KPI label="Errors (24h)" value={recentParseFails} accent={recentParseFails > 0 ? "var(--tl-red)" : "var(--fg)"} />
        </div>
      </Section>

      <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 16, padding: "0 28px 28px" }}>
        <Card pad={0}>
          <div
            style={{
              padding: "16px 18px 12px",
              borderBottom: "1px solid var(--hairline)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--fg-3)",
                  letterSpacing: 1.4,
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                ALERTS
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>Needs attention</div>
            </div>
            <span className="mono" style={{ fontSize: 11, color: "var(--fg-3)" }}>{alerts.length} items</span>
          </div>
          {alerts.map((a, i) => (
            <div
              key={i}
              className="row-h"
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: 14,
                padding: "12px 18px",
                borderBottom: i < alerts.length - 1 ? "1px solid var(--hairline)" : "none",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 999,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background:
                    a.sev === "warn"
                      ? "rgba(255,154,87,0.14)"
                      : a.sev === "info"
                      ? "rgba(122,166,255,0.14)"
                      : "rgba(91,98,113,0.14)",
                  color: a.sev === "warn" ? "var(--tl-orange)" : a.sev === "info" ? "var(--tl-accent)" : "var(--fg-3)",
                  fontSize: 14,
                }}
              >
                {a.sev === "warn" ? "!" : a.sev === "info" ? "i" : "·"}
              </span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{a.title}</div>
                <div style={{ fontSize: 12, color: "var(--fg-2)", marginTop: 1 }}>{a.detail}</div>
              </div>
              <Link href={a.href} style={{ textDecoration: "none" }}>
                <Btn size="sm">open →</Btn>
              </Link>
            </div>
          ))}
        </Card>

        <Card pad={0}>
          <div
            style={{
              padding: "16px 18px 12px",
              borderBottom: "1px solid var(--hairline)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--fg-3)",
                  letterSpacing: 1.4,
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                ACTIVITY
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>Recent admin events</div>
            </div>
            <Link href="/admin/audit" style={{ textDecoration: "none" }}>
              <Btn size="sm" kind="ghost">full log →</Btn>
            </Link>
          </div>
          {recentEvents.length === 0 ? (
            <div style={{ padding: 36, textAlign: "center", color: "var(--fg-3)", fontSize: 13 }}>
              No admin actions logged yet.
            </div>
          ) : (
            recentEvents.map((e, i) => (
              <div
                key={e.id}
                className="row-h"
                style={{
                  display: "grid",
                  gridTemplateColumns: "70px 1fr auto",
                  gap: 14,
                  alignItems: "center",
                  padding: "10px 18px",
                  borderBottom: i < recentEvents.length - 1 ? "1px solid var(--hairline)" : "none",
                  fontSize: 12,
                }}
              >
                <span className="mono" style={{ color: "var(--fg-3)", fontSize: 11 }}>{relTime(e.occurredAt)}</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 12.5 }}>{e.actorAdmin?.name ?? e.actorAdmin?.email ?? "—"}</div>
                  <div className="mono" style={{ fontSize: 10, color: "var(--tl-accent-2)", marginTop: 1 }}>
                    {e.eventType} · {e.entityType}
                  </div>
                </div>
              </div>
            ))
          )}
        </Card>
      </div>
    </>
  )
}
