import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import { prisma } from "@/lib/db"
import { getCurrentAdminContext } from "@/lib/admin/adminContext"
import { Section, Card, Btn, Pill, Avi } from "@/components/v2/primitives"
import { fmtDate, relTime } from "@/components/v2/format"
import { ImpersonateButton } from "../impersonate-button"

interface Props {
  params: Promise<{ cpaId: string }>
}

export default async function AdminCpaDetailPage({ params }: Props) {
  const { cpaId } = await params
  const admin = await getCurrentAdminContext()
  if (!admin) redirect("/workspace")

  const cpa = await prisma.user.findUnique({
    where: { id: cpaId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
      cpaClients: {
        include: {
          client: {
            select: {
              id: true,
              name: true,
              email: true,
              taxYears: {
                orderBy: { year: "desc" },
                take: 1,
                select: { year: true, status: true },
              },
            },
          },
        },
      },
    },
  })

  if (!cpa || cpa.role !== "CPA") notFound()

  const recentEvents = await prisma.auditEvent.findMany({
    where: { OR: [{ actorCpaUserId: cpa.id }, { userId: cpa.id }] },
    orderBy: { occurredAt: "desc" },
    take: 10,
  })

  return (
    <>
      <Section
        sub="ADMIN · CPA"
        title=" "
        right={
          <>
            <ImpersonateButton cpaId={cpa.id} />
            <Btn>Reset password</Btn>
            <Btn kind="danger">{cpa.isActive ? "Suspend" : "Reactivate"}</Btn>
          </>
        }
      >
        <Card pad={22}>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 18, alignItems: "center" }}>
            <Avi name={cpa.name ?? cpa.email} email={cpa.email} size={64} />
            <div>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: -0.4 }}>
                {cpa.name ?? cpa.email}
              </h1>
              <div className="mono" style={{ fontSize: 12, color: "var(--fg-2)", marginTop: 4 }}>{cpa.email}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <Pill s={cpa.isActive ? "active" : "inactive"} />
                <span className="mono" style={{ fontSize: 11, color: "var(--fg-3)" }}>
                  joined {fmtDate(cpa.createdAt)}
                </span>
              </div>
            </div>
          </div>
        </Card>
      </Section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: "0 28px 28px" }}>
        <Card pad={0}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--hairline)", fontSize: 14, fontWeight: 700 }}>
            Clients ({cpa.cpaClients.length})
          </div>
          {cpa.cpaClients.length === 0 ? (
            <div style={{ padding: 36, textAlign: "center", color: "var(--fg-3)", fontSize: 13 }}>
              No clients onboarded yet.
            </div>
          ) : (
            cpa.cpaClients.map((rel, i) => (
              <div
                key={rel.id}
                className="row-h"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto",
                  gap: 14,
                  padding: "12px 18px",
                  alignItems: "center",
                  borderBottom: i < cpa.cpaClients.length - 1 ? "1px solid var(--hairline)" : "none",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 11 }}>
                  <Avi name={rel.client.name ?? rel.client.email} email={rel.client.email} size={28} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {rel.displayName ?? rel.client.name ?? rel.client.email}
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 1 }}>
                      {rel.client.email}
                    </div>
                  </div>
                </span>
                {rel.client.taxYears[0] && (
                  <span className="mono" style={{ fontSize: 11, color: "var(--fg-2)" }}>
                    TY {rel.client.taxYears[0].year}
                  </span>
                )}
                {rel.client.taxYears[0] && (
                  <Pill s={rel.client.taxYears[0].status as never}>{rel.client.taxYears[0].status}</Pill>
                )}
              </div>
            ))
          )}
        </Card>

        <Card pad={0}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--hairline)", fontSize: 14, fontWeight: 700 }}>
            Recent activity
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
                  display: "grid",
                  gridTemplateColumns: "100px 1fr",
                  gap: 12,
                  padding: "10px 18px",
                  borderBottom: i < recentEvents.length - 1 ? "1px solid var(--hairline)" : "none",
                  fontSize: 12,
                }}
              >
                <span className="mono" style={{ fontSize: 11, color: "var(--fg-3)" }}>{relTime(e.occurredAt)}</span>
                <div>
                  <div style={{ fontWeight: 600 }}>{e.eventType}</div>
                  <div className="mono" style={{ fontSize: 10, color: "var(--tl-accent-2)", marginTop: 1 }}>
                    {e.entityType}
                  </div>
                </div>
              </div>
            ))
          )}
          <div style={{ padding: "10px 18px", borderTop: "1px solid var(--hairline)" }}>
            <Link href="/admin/audit" style={{ textDecoration: "none" }}>
              <Btn size="sm" kind="ghost">full audit log →</Btn>
            </Link>
          </div>
        </Card>
      </div>
    </>
  )
}
