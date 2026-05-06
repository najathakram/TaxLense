import { redirect } from "next/navigation"
import { prisma } from "@/lib/db"
import { getCurrentAdminContext } from "@/lib/admin/adminContext"
import { Section, Card, Btn, Tag, fmtDateTime } from "@/components/v2/primitives"

export default async function AdminAuditPage() {
  const admin = await getCurrentAdminContext()
  if (!admin) redirect("/workspace")

  const events = await prisma.auditEvent.findMany({
    orderBy: { occurredAt: "desc" },
    take: 200,
    include: {
      user: { select: { name: true, email: true } },
      actorCpa: { select: { name: true, email: true } },
      actorAdmin: { select: { name: true, email: true } },
    },
  })

  return (
    <Section
      sub="ADMIN · AUDIT"
      title={`Cross-firm audit log (${events.length})`}
      right={
        <>
          <Btn>Filter</Btn>
          <Btn icon="↓">Export CSV</Btn>
        </>
      }
    >
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <Tag color="var(--tl-purple)">+actorAdminUserId</Tag>
        <Tag>actor:any</Tag>
        <Tag>events:all</Tag>
        <Tag>last 200</Tag>
      </div>
      <Card pad={0}>
        {events.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center", color: "var(--fg-3)", fontSize: 13 }}>
            No audit events yet.
          </div>
        ) : (
          events.map((e, i) => (
            <div
              key={e.id}
              className="row-h"
              style={{
                display: "grid",
                gridTemplateColumns: "150px 200px 200px 1fr",
                gap: 16,
                padding: "12px 18px",
                alignItems: "center",
                borderBottom: i < events.length - 1 ? "1px solid var(--hairline)" : "none",
                fontSize: 12.5,
              }}
            >
              <span className="mono" style={{ color: "var(--fg-3)", fontSize: 11 }}>
                {fmtDateTime(e.occurredAt)}
              </span>
              <span style={{ fontWeight: 600 }}>
                {e.actorAdmin
                  ? e.actorAdmin.name ?? e.actorAdmin.email
                  : e.actorCpa
                  ? e.actorCpa.name ?? e.actorCpa.email
                  : e.actorType}
                {e.user && (
                  <span style={{ color: "var(--fg-3)", fontWeight: 400, marginLeft: 6 }}>
                    → {e.user.name ?? e.user.email}
                  </span>
                )}
              </span>
              <Tag color="var(--tl-accent-2)">{e.eventType}</Tag>
              <span style={{ color: "var(--fg-2)" }}>
                {e.entityType}
                {e.entityId && (
                  <span className="mono" style={{ color: "var(--fg-3)", marginLeft: 8, fontSize: 11 }}>
                    #{e.entityId.slice(0, 8)}
                  </span>
                )}
                {e.rationale && (
                  <span style={{ color: "var(--fg-3)", marginLeft: 8, fontStyle: "italic" }}>
                    — {e.rationale.length > 80 ? e.rationale.slice(0, 80) + "…" : e.rationale}
                  </span>
                )}
              </span>
            </div>
          ))
        )}
      </Card>
    </Section>
  )
}
