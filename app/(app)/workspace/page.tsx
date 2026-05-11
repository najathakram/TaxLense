import { redirect } from "next/navigation"
import Link from "next/link"
import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getCurrentCpaContext } from "@/lib/cpa/clientContext"
import { getAdminCpaContext } from "@/lib/admin/adminContext"
import { Section, Card, KPI, Pill, Avi } from "@/components/v2/primitives"
import { fmtUSD, relTime } from "@/components/v2/format"
import { summarizeLockBlockersBatch } from "@/lib/lock/status"

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

  // Build inbox items grouped by severity.
  //
  // Readiness rule (B-fix-inbox): a year is BLOCKER if it has any blocking
  // assertion failure OR any blocking critical-risk-signal — NOT just by
  // pending-STOP count. The pre-fix logic let years through as READY while
  // Risk dashboard correctly reported them as BLOCKED, eroding trust. We now
  // delegate to lib/lock/status.ts so Inbox, Year cards, Finalize all agree.
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

  // Collect all (taxYearId, pendingStops) pairs eligible for the lock-status
  // check. Only REVIEW years can plausibly be READY — earlier statuses (CREATED
  // / INGESTION / CLASSIFICATION) aren't lock-ready by definition; LOCKED is
  // already done. For non-REVIEW years we still surface PENDING STOP rows.
  const stopCountsByYear = new Map<string, number>()
  for (const rel of clientRels) {
    for (const ty of rel.client.taxYears) {
      stopCountsByYear.set(
        ty.id,
        await prisma.stopItem.count({ where: { taxYearId: ty.id, state: "PENDING" } }),
      )
    }
  }

  const reviewYears = clientRels.flatMap((rel) =>
    rel.client.taxYears
      .filter((ty) => ty.status === "REVIEW")
      .map((ty) => ({ taxYearId: ty.id, pendingStops: stopCountsByYear.get(ty.id) ?? 0 })),
  )
  const lockSummaries = await summarizeLockBlockersBatch(reviewYears)

  for (const rel of clientRels) {
    const c = rel.client
    for (const ty of c.taxYears) {
      const pendingStops = stopCountsByYear.get(ty.id) ?? 0
      const summary = lockSummaries.get(ty.id) // only set for REVIEW years

      // Authoritative blocker = any blocking assertion failure OR critical
      // blocking risk signal. Fallback (non-REVIEW year) = high-priority STOPs.
      const isBlocked = summary
        ? summary.blocked
        : pendingStops > 0 &&
          (await prisma.stopItem.count({
            where: {
              taxYearId: ty.id,
              state: "PENDING",
              category: { in: ["DEPOSIT", "SECTION_274D", "PERIOD_GAP"] },
            },
          })) > 0

      const blockerCount = summary?.blockerCount ?? 0
      if (isBlocked) {
        const reason = summary?.reasons.slice(0, 2).join("; ")
        inbox.push({
          sev: "BLOCKER",
          clientId: c.id,
          clientName: c.name ?? c.email,
          clientEmail: c.email,
          year: ty.year,
          msg: summary
            ? `${blockerCount} blocker${blockerCount > 1 ? "s" : ""} — ${reason}`
            : `${pendingStops} STOP${pendingStops > 1 ? "s" : ""} — resolve before lock`,
          target: summary ? `/years/${ty.year}/risk` : `/years/${ty.year}/stops`,
          age: new Date(),
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
      // READY only when REVIEW AND zero pending STOPs AND lock-status helper
      // confirms no blocking issues. Previously this fired on STOP count alone.
      if (ty.status === "REVIEW" && pendingStops === 0 && summary && !summary.blocked) {
        inbox.push({
          sev: "READY",
          clientId: c.id,
          clientName: c.name ?? c.email,
          clientEmail: c.email,
          year: ty.year,
          msg: "Ready to lock — assertions pass, no blocking risk signals",
          target: `/years/${ty.year}/finalize`,
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
