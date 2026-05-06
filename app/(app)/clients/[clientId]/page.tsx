import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getCurrentCpaContext, getClientYearStrip } from "@/lib/cpa/clientContext"
import { getAdminCpaContext } from "@/lib/admin/adminContext"
import { Section, Card, Btn, Pill, Avi, Tag, ProgressArc, Risk } from "@/components/v2/primitives"
import { fmtUSD, fmtDate, statusKey } from "@/components/v2/format"
import { EnterClientButton } from "./enter-client-button"

interface Props {
  params: Promise<{ clientId: string }>
}

export default async function ClientHomePage({ params }: Props) {
  const { clientId } = await params
  await requireAuth()
  const cpaCtx = await getCurrentCpaContext()
  const adminCpaCtx = await getAdminCpaContext()
  const effectiveCpaId = adminCpaCtx?.cpaId ?? cpaCtx?.cpaId ?? null
  if (!effectiveCpaId) redirect("/dashboard")

  const rel = await prisma.cpaClient.findFirst({
    where: { cpaUserId: effectiveCpaId, clientUserId: clientId },
    include: {
      client: {
        select: { id: true, name: true, email: true },
      },
    },
  })
  if (!rel) notFound()

  const profile = await prisma.businessProfile.findFirst({
    where: { userId: clientId },
    orderBy: { createdAt: "desc" },
  })

  const yearStrip = await getClientYearStrip(clientId)
  const allYears = [2026, 2025, 2024, 2023]

  const recentEvents = await prisma.auditEvent.findMany({
    where: { userId: clientId },
    orderBy: { occurredAt: "desc" },
    take: 5,
    include: {
      actorCpa: { select: { name: true, email: true } },
      actorAdmin: { select: { name: true, email: true } },
    },
  })

  return (
    <>
      <Section
        sub="CPA · CLIENT"
        title=" "
        right={
          <>
            <EnterClientButton clientId={rel.client.id} />
            <Link href={`/clients/${rel.client.id}/profile`} style={{ textDecoration: "none" }}>
              <Btn>Profile</Btn>
            </Link>
            <Link href={`/clients/${rel.client.id}/documents`} style={{ textDecoration: "none" }}>
              <Btn>Documents</Btn>
            </Link>
          </>
        }
      >
        <Card pad={22}>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 18, alignItems: "center" }}>
            <Avi name={rel.client.name ?? rel.client.email} email={rel.client.email} size={64} />
            <div>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>
                {rel.displayName ?? rel.client.name ?? rel.client.email}
              </h1>
              <div className="mono" style={{ fontSize: 12, color: "var(--fg-2)", marginTop: 4 }}>
                {rel.client.email}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                {profile?.naicsCode && <Tag>NAICS {profile.naicsCode}</Tag>}
                {profile?.businessDescription && <Tag>{profile.businessDescription}</Tag>}
                {profile?.primaryState && <Tag>{profile.primaryState}</Tag>}
                {profile?.entityType && <Tag>{profile.entityType.replace(/_/g, " ")}</Tag>}
                {profile?.accountingMethod && (
                  <Tag color="var(--tl-accent-2)">{profile.accountingMethod}</Tag>
                )}
              </div>
            </div>
          </div>
        </Card>
      </Section>

      <Section sub="YEARS" title="Tax years">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {allYears.map((y) => {
            const d = yearStrip.find((s) => s.year === y)
            const linkHref = d ? `/years/${y}` : "/onboarding"
            return (
              <Link key={y} href={linkHref} style={{ textDecoration: "none", color: "inherit" }}>
                <Card pad={16} hoverable>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div className="num" style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.5 }}>
                      {y}
                    </div>
                    {d && (
                      <ProgressArc
                        pct={
                          d.status === "LOCKED"
                            ? 100
                            : d.status === "REVIEW"
                            ? 70
                            : d.status === "INGESTION"
                            ? 30
                            : 5
                        }
                        size={48}
                      />
                    )}
                  </div>
                  {d ? (
                    <>
                      <div style={{ marginTop: 10 }}>
                        <Pill s={statusKey(d.status)} />
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 10,
                          marginTop: 12,
                          fontSize: 11,
                        }}
                      >
                        {[
                          ["RECEIPTS", fmtUSD(d.grossReceipts)],
                          ["DEDUCT.", fmtUSD(d.totalDeductions)],
                          ["NET", fmtUSD(d.netProfit)],
                          ["RISK", d.riskScore != null ? <Risk score={d.riskScore} /> : "—"],
                        ].map(([k, v], i) => (
                          <div key={i}>
                            <div
                              style={{
                                color: "var(--fg-3)",
                                fontSize: 10,
                                letterSpacing: 1,
                                fontWeight: 600,
                              }}
                            >
                              {k}
                            </div>
                            <div className="num" style={{ fontSize: 13, marginTop: 2 }}>
                              {v}
                            </div>
                          </div>
                        ))}
                      </div>
                      {d.lockedAt && (
                        <div
                          className="mono"
                          style={{
                            marginTop: 12,
                            fontSize: 10,
                            color: "var(--tl-green)",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          ● locked {fmtDate(d.lockedAt)}
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ marginTop: 26, color: "var(--fg-3)", fontSize: 12 }}>+ create tax year</div>
                  )}
                </Card>
              </Link>
            )
          })}
        </div>
      </Section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: "8px 28px 28px" }}>
        <Card pad={0}>
          <div
            style={{
              padding: "14px 18px",
              borderBottom: "1px solid var(--hairline)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700 }}>Recent activity</div>
            <Link href={`/clients/${rel.client.id}/documents`} style={{ textDecoration: "none" }}>
              <Btn size="sm" kind="ghost">view docs →</Btn>
            </Link>
          </div>
          {recentEvents.length === 0 ? (
            <div style={{ padding: 36, textAlign: "center", color: "var(--fg-3)", fontSize: 13 }}>
              No activity yet.
            </div>
          ) : (
            recentEvents.map((e, i) => (
              <div
                key={e.id}
                style={{
                  padding: "10px 18px",
                  borderBottom: i < recentEvents.length - 1 ? "1px solid var(--hairline)" : "none",
                  fontSize: 12,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
                  <Tag color="var(--tl-accent-2)">{e.eventType}</Tag>
                  <span className="mono" style={{ fontSize: 10, color: "var(--fg-3)" }}>
                    {fmtDate(e.occurredAt)}
                  </span>
                </div>
                <div style={{ color: "var(--fg-2)", fontSize: 11.5 }}>
                  {e.actorAdmin
                    ? `Admin ${e.actorAdmin.name ?? e.actorAdmin.email}`
                    : e.actorCpa
                    ? `${e.actorCpa.name ?? e.actorCpa.email}`
                    : e.actorType}
                  {e.entityType && ` · ${e.entityType}`}
                </div>
              </div>
            ))
          )}
        </Card>

        <Card pad={20}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Profile snapshot</div>
          <div style={{ fontSize: 12, color: "var(--fg-2)", lineHeight: 1.7 }}>
            {profile ? (
              <>
                <div>NAICS · {profile.naicsCode ?? "—"}</div>
                <div>Industry · {profile.businessDescription ?? "—"}</div>
                <div>Entity · {profile.entityType ?? "—"}</div>
                <div>State · {profile.primaryState ?? "—"}</div>
                <div>Method · {profile.accountingMethod ?? "—"}</div>
              </>
            ) : (
              <div style={{ color: "var(--fg-3)" }}>
                No profile yet — <Link href="/onboarding" style={{ color: "var(--tl-accent)" }}>start the wizard</Link>.
              </div>
            )}
          </div>
        </Card>
      </div>
    </>
  )
}

