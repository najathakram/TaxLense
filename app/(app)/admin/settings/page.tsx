import { redirect } from "next/navigation"
import { prisma } from "@/lib/db"
import { getCurrentAdminContext } from "@/lib/admin/adminContext"
import { Section, Card } from "@/components/v2/primitives"

export default async function AdminSettingsPage() {
  const admin = await getCurrentAdminContext()
  if (!admin) redirect("/workspace")

  const ruleVersion = await prisma.ruleVersion.findFirst({ orderBy: { effectiveDate: "desc" } })

  const settings: Array<[string, string, "mono" | "default"]> = [
    ["Pinned RuleVersion", ruleVersion ? ruleVersion.summary ?? ruleVersion.id : "(none)", "mono"],
    ["Default model — classification", "claude-sonnet-4-6", "default"],
    ["Default model — memos", "claude-opus-4-7", "default"],
    ["Default model — PDF cleanup", "claude-haiku-4-5", "default"],
    ["UPLOAD_BASE_DIR", process.env["UPLOAD_BASE_DIR"] ?? "./data/uploads", "mono"],
    ["Admin session TTL", "8 hours", "default"],
    ["Idle impersonation drop", "30 minutes", "default"],
    ["Cookie collision policy", "deepest wins (client > admin > session)", "default"],
  ]

  return (
    <Section sub="ADMIN · SETTINGS" title="Platform settings">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {settings.map(([k, v, kind], i) => (
          <Card key={i} pad={16}>
            <div
              style={{
                fontSize: 10,
                color: "var(--fg-3)",
                letterSpacing: 1.2,
                fontWeight: 700,
                textTransform: "uppercase",
                marginBottom: 5,
              }}
            >
              {k}
            </div>
            <div style={{ fontSize: 14, fontFamily: kind === "mono" ? "var(--mono)" : "inherit" }}>{v}</div>
            <div style={{ marginTop: 10, fontSize: 11, color: "var(--fg-3)" }}>
              read-only · mutate via DB script
            </div>
          </Card>
        ))}
      </div>
    </Section>
  )
}
