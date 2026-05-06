import { redirect } from "next/navigation"
import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getCurrentCpaContext } from "@/lib/cpa/clientContext"
import { getAdminCpaContext } from "@/lib/admin/adminContext"
import { Section, Card, KPI } from "@/components/v2/primitives"
import { fmtUSD } from "@/components/v2/format"
import { computeDeductibleAmt } from "@/lib/classification/deductible"

export default async function FirmOverviewPage() {
  await requireAuth()
  const cpaCtx = await getCurrentCpaContext()
  const adminCpaCtx = await getAdminCpaContext()
  const effectiveCpaId = adminCpaCtx?.cpaId ?? cpaCtx?.cpaId ?? null
  if (!effectiveCpaId) redirect("/dashboard")

  const clientRels = await prisma.cpaClient.findMany({
    where: { cpaUserId: effectiveCpaId },
    include: {
      client: {
        select: {
          id: true,
          taxYears: { select: { id: true, year: true, status: true } },
        },
      },
    },
  })

  // Aggregate firm-level metrics
  let activeClients = clientRels.length
  let lockedYTD = 0
  let pendingLock = 0
  let totalDeductions = 0
  let totalReceipts = 0

  for (const rel of clientRels) {
    for (const ty of rel.client.taxYears) {
      if (ty.status === "LOCKED") lockedYTD++
      if (ty.status === "REVIEW") pendingLock++

      const txns = await prisma.transaction.findMany({
        where: { taxYearId: ty.id, isSplit: false },
        select: {
          amountNormalized: true,
          classifications: { where: { isCurrent: true }, select: { code: true, businessPct: true }, take: 1 },
        },
      })
      for (const t of txns) {
        const c = t.classifications[0]
        if (!c) continue
        const amt = Number(t.amountNormalized)
        if (c.code === "BIZ_INCOME") totalReceipts += Math.abs(amt)
        totalDeductions += computeDeductibleAmt(amt, c.code, c.businessPct)
      }
    }
  }

  return (
    <Section sub="WORKSPACE · FIRM" title="Firm overview">
      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <KPI label="Active clients" value={activeClients} />
        <KPI label="Locked years" value={lockedYTD} accent="var(--tl-green)" />
        <KPI label="Pending lock" value={pendingLock} accent="var(--tl-accent)" />
        <KPI label="Receipts (all)" value={fmtUSD(totalReceipts)} accent="var(--tl-green)" />
        <KPI label="Deductions (all)" value={fmtUSD(totalDeductions)} />
      </div>
      <Card>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>By client</div>
        <div style={{ display: "grid", gap: 6 }}>
          {clientRels.map((rel) => {
            const locked = rel.client.taxYears.filter((y) => y.status === "LOCKED").length
            const total = rel.client.taxYears.length
            return (
              <div
                key={rel.id}
                style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 14, padding: "8px 0", fontSize: 12 }}
              >
                <span>{rel.displayName ?? "(client)"}</span>
                <span className="num" style={{ color: "var(--fg-2)" }}>
                  {locked}/{total} locked
                </span>
                <span style={{ width: 120, height: 6, borderRadius: 999, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
                  <span
                    style={{
                      display: "block",
                      width: total > 0 ? `${(locked / total) * 100}%` : "0",
                      height: "100%",
                      background: "var(--tl-green)",
                    }}
                  />
                </span>
              </div>
            )
          })}
        </div>
      </Card>
    </Section>
  )
}
