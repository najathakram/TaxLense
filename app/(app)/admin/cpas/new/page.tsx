import { redirect } from "next/navigation"
import { getCurrentAdminContext } from "@/lib/admin/adminContext"
import { createCpaAccount } from "@/lib/admin/actions"
import { Section, Card, Btn } from "@/components/v2/primitives"

export default async function AdminAddCpaPage() {
  const admin = await getCurrentAdminContext()
  if (!admin) redirect("/workspace")
  return (
    <Section sub="ADMIN · CPAs · NEW" title="Add a CPA">
      <Card pad={28} style={{ maxWidth: 560 }}>
        <form action={createCpaAccount} style={{ display: "grid", gap: 18 }}>
          <div>
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
              Name
            </label>
            <input
              name="name"
              required
              placeholder="Sara Mendoza"
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 12,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid var(--hairline)",
                color: "var(--fg)",
                fontSize: 14,
                fontFamily: "var(--sans)",
              }}
            />
          </div>
          <div>
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
              Email
            </label>
            <input
              name="email"
              type="email"
              required
              placeholder="sara@firm.com"
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 12,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid var(--hairline)",
                color: "var(--fg)",
                fontSize: 14,
                fontFamily: "var(--mono)",
              }}
            />
          </div>
          <div style={{ fontSize: 11, color: "var(--fg-3)", lineHeight: 1.6 }}>
            A temporary password will be generated and shown once on the next screen. Email it to
            the CPA out-of-band; they can change it on first login.
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn type="submit" kind="primary">Create CPA →</Btn>
          </div>
        </form>
      </Card>
    </Section>
  )
}
