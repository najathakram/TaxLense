import { redirect } from "next/navigation"
import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { Section, Card, Btn } from "@/components/v2/primitives"
import { createClientAccount } from "@/lib/cpa/actions"

export default async function NewClientPage() {
  const session = await requireAuth()
  const userId = session.user!.id!
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (me?.role !== "CPA" && me?.role !== "SUPER_ADMIN") redirect("/dashboard")

  return (
    <Section sub="CPA · CLIENTS · NEW" title="Add a client">
      <Card pad={28} style={{ maxWidth: 560 }}>
        <form action={createClientAccount} style={{ display: "grid", gap: 18 }}>
          {(
            [
              ["name", "Name", "text", "Atif Khan"],
              ["email", "Email", "email", "atif@example.com"],
              ["displayName", "Display name (optional)", "text", "Atif K."],
            ] as const
          ).map(([n, l, t, p]) => (
            <div key={n}>
              <label
                style={{
                  display: "block",
                  fontSize: 10,
                  color: "var(--fg-3)",
                  letterSpacing: 1.2,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                {l}
              </label>
              <input
                name={n}
                type={t}
                required={n !== "displayName"}
                placeholder={p}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid var(--hairline)",
                  color: "var(--fg)",
                  fontSize: 14,
                  fontFamily: t === "email" ? "var(--mono)" : "var(--sans)",
                }}
              />
            </div>
          ))}
          <div style={{ fontSize: 11, color: "var(--fg-3)", lineHeight: 1.6 }}>
            A temporary password will be generated and shown once on the next screen. You can email
            it to the client out-of-band; they can change it on first login.
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn type="submit" kind="primary">Create client →</Btn>
          </div>
        </form>
      </Card>
    </Section>
  )
}
