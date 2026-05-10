import { redirect } from "next/navigation"
import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getCurrentCpaContext } from "@/lib/cpa/clientContext"
import { getAdminCpaContext } from "@/lib/admin/adminContext"
import { Section, Card, KPI } from "@/components/v2/primitives"
import { fmtUSD } from "@/components/v2/format"
import { computeDeductibleAmt } from "@/lib/classification/deductible"
import { deriveStage, getYearCounts } from "@/lib/taxYear/status"
import type { TaxYearStatus } from "@/app/generated/prisma/client"

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
          taxYears: { select: { id: true, year: true, status: true, lockedAt: true } },
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
  // Per-client locked-vs-total counts using the DERIVED stage (B-13).
  // Pre-fix: a year showing "CLASSIFICATION" on every other page registered
  // as "CREATED" here because the persisted column hadn't been recomputed,
  // and a year with 5 lock-blockers showed PENDING LOCK = 0.
  const derivedStatusByYearId = new Map<string, TaxYearStatus>()

  for (const rel of clientRels) {
    for (const ty of rel.client.taxYears) {
      const counts = await getYearCounts(ty.id)
      const stage = deriveStage(
        { status: ty.status, lockedAt: ty.lockedAt },
        counts,
      )
      derivedStatusByYearId.set(ty.id, stage)

      if (stage === "LOCKED") lockedYTD++
      // "Pending lock" = year is actively being prepared (classifying or
      // ready for review) but not yet locked. Excludes CREATED (no work
      // started) and ARCHIVED.
      if (stage === "CLASSIFICATION" || stage === "REVIEW") pendingLock++

      const txns = await prisma.transaction.findMany({
        where: { taxYearId: ty.id, isSplit: false, isStale: false },
        select: {
          amountNormalized: true,
          isTransferPairedWith: true,
          classifications: { where: { isCurrent: true }, select: { code: true, businessPct: true }, take: 1 },
        },
      })
      for (const t of txns) {
        const c = t.classifications[0]
        if (!c) continue
        const amt = Number(t.amountNormalized)
        // Match the canonical Gross Receipts definition (B-05) so the firm
        // KPI agrees with each client's Analytics / Risk page.
        if (c.code === "BIZ_INCOME" && amt < 0 && !t.isTransferPairedWith) {
          totalReceipts += Math.abs(amt)
        }
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
            const locked = rel.client.taxYears.filter(
              (y) => (derivedStatusByYearId.get(y.id) ?? y.status) === "LOCKED",
            ).length
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
