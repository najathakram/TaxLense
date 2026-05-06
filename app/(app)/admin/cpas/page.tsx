import { redirect } from "next/navigation"
import Link from "next/link"
import { getCurrentAdminContext, listAllCpas } from "@/lib/admin/adminContext"
import { Section, Card, Btn, Pill, Avi, fmtUSD, relTime } from "@/components/v2/primitives"
import { ImpersonateButton } from "./impersonate-button"

export default async function AdminCpasPage() {
  const admin = await getCurrentAdminContext()
  if (!admin) redirect("/workspace")

  const cpas = await listAllCpas()

  return (
    <Section
      sub="ADMIN · CPAs"
      title={`All CPAs (${cpas.length})`}
      right={
        <Link href="/admin/cpas/new" style={{ textDecoration: "none" }}>
          <Btn kind="primary" icon="+">Add CPA</Btn>
        </Link>
      }
    >
      <Card pad={0}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["CPA", "Status", "Clients", "Last login", ""].map((h, i) => (
                <th
                  key={i}
                  style={{
                    textAlign: i === 2 || i === 3 ? "right" : "left",
                    padding: "12px 18px",
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--fg-3)",
                    letterSpacing: 1.2,
                    textTransform: "uppercase",
                    borderBottom: "1px solid var(--hairline)",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cpas.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 36, textAlign: "center", color: "var(--fg-3)" }}>
                  No CPAs yet — <Link href="/admin/cpas/new" style={{ color: "var(--tl-accent)" }}>add one</Link>.
                </td>
              </tr>
            ) : (
              cpas.map((c, i) => (
                <tr
                  key={c.cpaId}
                  className="row-h"
                  style={{
                    borderBottom: i < cpas.length - 1 ? "1px solid var(--hairline)" : "none",
                  }}
                >
                  <td style={{ padding: "12px 18px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                      <Avi name={c.cpaName} email={c.cpaEmail} size={32} />
                      <div>
                        <div style={{ fontWeight: 600 }}>{c.cpaName}</div>
                        <div className="mono" style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 1 }}>
                          {c.cpaEmail}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: "12px 18px" }}>
                    <Pill s={c.isActive ? "active" : "inactive"} />
                  </td>
                  <td className="num" style={{ padding: "12px 18px", textAlign: "right" }}>{c.clientCount}</td>
                  <td className="mono" style={{ padding: "12px 18px", textAlign: "right", color: "var(--fg-3)", fontSize: 11 }}>
                    {relTime(c.createdAt)}
                  </td>
                  <td style={{ padding: "8px 18px", textAlign: "right" }}>
                    <ImpersonateButton cpaId={c.cpaId} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </Section>
  )
}

void fmtUSD // imported for downstream use; satisfy linter if unused
