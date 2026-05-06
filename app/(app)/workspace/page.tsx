import { redirect } from "next/navigation"
import Link from "next/link"
import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getCurrentCpaContext } from "@/lib/cpa/clientContext"
import { getAdminCpaContext } from "@/lib/admin/adminContext"
import { Section, Card, KPI, Pill, Avi, fmtUSD, relTime } from "@/components/v2/primitives"

export default async function WorkspacePage() {
  await requireAuth()
  const cpaCtx = await getCurrentCpaContext()
  const adminCpaCtx = await getAdminCpaContext()
  const effectiveCpaId = adminCpaCtx?.cpaId ?? cpaCtx?.cpaId ?? null

  if (!effectiveCpaId) {
    // Solo CLIENT — send them to their own dashboard.
    redirect("/dashboard")
  }

  // Pull CPA's clients, latest tax years, pending stops
  const clientRels = await prisma.cpaClient.findMany({
    where: { cpaUserId: effectiveCpaId },
    include: {
      client: {
        select: {
          id: true,
          name: true,
          email: true,
          taxYears: {
            orderBy: { year: "desc" },
            select: {
              id: true,
              year: true,
              status: true,
              _count: { select: { stopItems: true } },
            },
          },
        },
      },
    },
  })

  // Build inbox items grouped by severity
  type InboxItem = {
    sev: "BLOCKER" | "PENDING" | "READY" | "DEADLINE"
    clientId: string
    clientName: string
    clientEmail: string
    year: number
    msg: string
    target: string
    age: Date
  }
  const inbox: InboxItem[] = []

  for (const rel of clientRels) {
    const c = rel.client
    for (const ty of c.taxYears) {
      const pendingStops = await prisma.stopItem.count({ where: { taxYearId: ty.id, state: "PENDING" } })
      const blockers = await prisma.stopItem.count({
        where: { taxYearId: ty.id, state: "PENDING", category: { in: ["DEPOSIT", "SECTION_274D", "PERIOD_GAP"] } },
      })

      if (blockers > 0) {
        inbox.push({
          sev: "BLOCKER",
          clientId: c.id,
          clientName: c.name ?? c.email,
          clientEmail: c.email,
          year: ty.year,
          msg: `${blockers} blocker${blockers > 1 ? "s" : ""} — resolve before lock`,
          target: `/years/${ty.year}/stops`,
          age: ty.id ? new Date() : new Date(),
        })
      }
      if (pendingStops > 0) {
        inbox.push({
          sev: "PENDING",
          clientId: c.id,
          clientName: c.name ?? c.email,
          clientEmail: c.email,
          year: ty.year,
          msg: `${pendingStops} STOP${pendingStops > 1 ? "s" : ""} awaiting review`,
          target: `/years/${ty.year}/stops`,
          age: new Date(),
        })
      }
      if (ty.status === "REVIEW" && pendingStops === 0) {
        inbox.push({
          sev: "READY",
          clientId: c.id,
          clientName: c.name ?? c.email,
          clientEmail: c.email,
          year: ty.year,
          msg: "Ready to lock — no pending STOPs",
          target: `/years/${ty.year}/lock`,
          age: new Date(),
        })
      }
    }
  }

  const grouped: Record<InboxItem["sev"], InboxItem[]> = { BLOCKER: [], PENDING: [], READY: [], DEADLINE: [] }
  for (const i of inbox) grouped[i.sev].push(i)

  // KPIs
  const lockedYTD = clientRels.flatMap((r) => r.client.taxYears).filter((y) => y.status === "LOCKED").length
  const pendingLock = clientRels.flatMap((r) => r.client.taxYears).filter((y) => y.status === "REVIEW").length

  return (
    <>
      <Section
        sub="WORKSPACE · TRIAGE"
        title="Inbox"
        right={
          <span className="mono" style={{ fontSize: 12, color: "var(--fg-2)" }}>
            {inbox.length} items · {new Set(inbox.map((i) => i.clientId)).size} clients
          </span>
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
          {(["BLOCKER", "PENDING", "READY", "DEADLINE"] as const).map((sev) => (
            <Card key={sev} pad={14} style={{ minHeight: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <Pill s={sev} />
                <span
                  className="num"
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color:
                      sev === "BLOCKER"
                        ? "var(--tl-red)"
                        : sev === "PENDING"
                        ? "var(--tl-amber)"
                        : sev === "READY"
                        ? "var(--tl-green)"
                        : "var(--tl-orange)",
                  }}
                >
                  {grouped[sev].length}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "var(--fg-3)" }}>
                {sev === "BLOCKER" && "must fix before lock"}
                {sev === "PENDING" && "awaiting review"}
                {sev === "READY" && "queue to lock"}
                {sev === "DEADLINE" && "time-sensitive"}
              </div>
            </Card>
          ))}
        </div>

        <Card pad={0}>
          {(["BLOCKER", "PENDING", "READY", "DEADLINE"] as const).map(
            (sev) =>
              grouped[sev].length > 0 && (
                <div key={sev}>
                  <div
                    style={{
                      padding: "10px 18px",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      background: "rgba(255,255,255,0.02)",
                      borderBottom: "1px solid var(--hairline)",
                    }}
                  >
                    <Pill s={sev} />
                    <span className="mono" style={{ fontSize: 11, color: "var(--fg-3)" }}>
                      {grouped[sev].length}
                    </span>
                  </div>
                  {grouped[sev].map((it, i) => (
                    <Link
                      key={`${it.clientId}-${it.year}-${i}`}
                      href={`/clients/${it.clientId}`}
                      className="row-h"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "200px 60px 1fr 80px",
                        gap: 14,
                        padding: "12px 18px",
                        alignItems: "center",
                        textDecoration: "none",
                        color: "inherit",
                        borderBottom: "1px solid var(--hairline)",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                        <Avi name={it.clientName} email={it.clientEmail} size={26} />
                        <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {it.clientName}
                        </span>
                      </span>
                      <span className="num" style={{ color: "var(--fg-2)" }}>{it.year}</span>
                      <span style={{ fontSize: 13 }}>{it.msg}</span>
                      <span className="mono" style={{ fontSize: 10, color: "var(--fg-3)", textAlign: "right" }}>
                        {relTime(it.age)}
                      </span>
                    </Link>
                  ))}
                </div>
              ),
          )}
          {inbox.length === 0 && (
            <div style={{ padding: 36, textAlign: "center", color: "var(--fg-3)", fontSize: 13 }}>
              All quiet — no items needing attention.
            </div>
          )}
        </Card>
      </Section>

      <Section sub="FIRM · KPIs" title="Practice overview">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <KPI label="Active clients" value={clientRels.length} />
          <KPI label="Locked YTD" value={lockedYTD} accent="var(--tl-green)" />
          <KPI label="Pending lock" value={pendingLock} accent="var(--tl-accent)" />
          <KPI label="Pending STOPs" value={inbox.filter((i) => i.sev === "PENDING").length} />
          <KPI label="Blockers" value={inbox.filter((i) => i.sev === "BLOCKER").length} accent="var(--tl-red)" />
        </div>
      </Section>
    </>
  )
}

void fmtUSD
