import { redirect } from "next/navigation"
import Link from "next/link"
import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getCurrentCpaContext } from "@/lib/cpa/clientContext"
import { getAdminCpaContext } from "@/lib/admin/adminContext"
import { Section, Card, Btn, Pill, Avi, fmtUSD, statusKey } from "@/components/v2/primitives"
import { computeDeductibleAmt } from "@/lib/classification/deductible"

export default async function ClientsPage() {
  await requireAuth()
  const cpaCtx = await getCurrentCpaContext()
  const adminCpaCtx = await getAdminCpaContext()
  const effectiveCpaId = adminCpaCtx?.cpaId ?? cpaCtx?.cpaId ?? null

  if (!effectiveCpaId) {
    // Solo CLIENT — no clients to manage; send to dashboard
    redirect("/dashboard")
  }

  // Pull all clients + their tax years
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
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  // For each TaxYear, compute total deductions (using shared formula).
  // We do this once per year here; for 50 clients × 4 years = 200 small queries.
  const yearTotals = new Map<string, number>()
  for (const rel of clientRels) {
    for (const ty of rel.client.taxYears) {
      const txns = await prisma.transaction.findMany({
        where: { taxYearId: ty.id, isSplit: false },
        select: {
          amountNormalized: true,
          classifications: { where: { isCurrent: true }, select: { code: true, businessPct: true }, take: 1 },
        },
      })
      let total = 0
      for (const t of txns) {
        const c = t.classifications[0]
        if (!c) continue
        total += computeDeductibleAmt(Number(t.amountNormalized), c.code, c.businessPct)
      }
      yearTotals.set(ty.id, total)
    }
  }

  // Per-client pending stops
  const stopCounts = new Map<string, number>()
  for (const rel of clientRels) {
    const count = await prisma.stopItem.count({
      where: { taxYear: { userId: rel.client.id }, state: "PENDING" },
    })
    stopCounts.set(rel.client.id, count)
  }

  const years = [2026, 2025, 2024, 2023]

  return (
    <Section
      sub="CPA · CLIENTS"
      title={`All clients (${clientRels.length})`}
      right={
        <Link href="/clients/new" style={{ textDecoration: "none" }}>
          <Btn kind="primary" icon="+">Add client</Btn>
        </Link>
      }
    >
      <Card pad={0} style={{ overflow: "hidden" }}>
        <div style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.02)" }}>
                <th
                  style={{
                    position: "sticky",
                    left: 0,
                    background: "rgba(28,32,42,0.95)",
                    padding: "12px 18px",
                    textAlign: "left",
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--fg-3)",
                    letterSpacing: 1.2,
                    textTransform: "uppercase",
                    borderBottom: "1px solid var(--hairline)",
                    minWidth: 280,
                    zIndex: 2,
                  }}
                >
                  Client
                </th>
                <th
                  style={{
                    padding: "12px 18px",
                    textAlign: "right",
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--fg-3)",
                    letterSpacing: 1.2,
                    textTransform: "uppercase",
                    borderBottom: "1px solid var(--hairline)",
                  }}
                >
                  Stops
                </th>
                {years.map((y) => (
                  <th
                    key={y}
                    style={{
                      padding: "12px 18px",
                      textAlign: "left",
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--fg-3)",
                      letterSpacing: 1.2,
                      textTransform: "uppercase",
                      borderBottom: "1px solid var(--hairline)",
                      minWidth: 160,
                    }}
                  >
                    {y}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clientRels.length === 0 ? (
                <tr>
                  <td colSpan={years.length + 2} style={{ padding: 36, textAlign: "center", color: "var(--fg-3)" }}>
                    No clients yet. <Link href="/clients/new" style={{ color: "var(--tl-accent)" }}>Add your first →</Link>
                  </td>
                </tr>
              ) : (
                clientRels.map((rel, i) => {
                  const c = rel.client
                  const stops = stopCounts.get(c.id) ?? 0
                  return (
                    <tr
                      key={c.id}
                      className="row-h"
                      style={{ borderBottom: i < clientRels.length - 1 ? "1px solid var(--hairline)" : "none" }}
                    >
                      <td
                        style={{
                          position: "sticky",
                          left: 0,
                          background: "rgba(20,24,32,0.95)",
                          padding: "12px 18px",
                          minWidth: 280,
                          zIndex: 1,
                          borderRight: "1px solid var(--hairline)",
                        }}
                      >
                        <Link href={`/clients/${c.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                            <Avi name={c.name ?? c.email} email={c.email} size={32} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                                {rel.displayName ?? c.name ?? c.email}
                              </div>
                              <div className="mono" style={{ fontSize: 10, color: "var(--fg-3)", marginTop: 1 }}>
                                {c.email}
                              </div>
                            </div>
                          </div>
                        </Link>
                      </td>
                      <td className="num" style={{ padding: "12px 18px", textAlign: "right" }}>
                        {stops > 0 ? (
                          <span style={{ color: "var(--tl-amber)", fontWeight: 600 }}>{stops}</span>
                        ) : (
                          <span style={{ color: "var(--fg-3)" }}>—</span>
                        )}
                      </td>
                      {years.map((y) => {
                        const ty = c.taxYears.find((t) => t.year === y)
                        if (!ty) {
                          return (
                            <td key={y} style={{ padding: 6 }}>
                              <span style={{ padding: "10px 12px", fontSize: 11, color: "var(--fg-3)", fontFamily: "var(--mono)" }}>
                                + add year
                              </span>
                            </td>
                          )
                        }
                        const total = yearTotals.get(ty.id) ?? 0
                        return (
                          <td key={y} style={{ padding: 6 }}>
                            <Link
                              href={`/years/${ty.year}`}
                              className="row-h"
                              style={{
                                display: "block",
                                width: "100%",
                                textDecoration: "none",
                                color: "inherit",
                                padding: "8px 12px",
                                borderRadius: 10,
                                background: "rgba(255,255,255,0.025)",
                                border: "1px solid var(--hairline)",
                              }}
                            >
                              <Pill s={statusKey(ty.status)} />
                              <div className="num" style={{ marginTop: 4, fontSize: 12, color: "var(--fg-1)" }}>
                                {fmtUSD(total)}
                              </div>
                            </Link>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </Section>
  )
}

