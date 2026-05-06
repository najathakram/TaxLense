import { redirect, notFound } from "next/navigation"
import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getCurrentCpaContext } from "@/lib/cpa/clientContext"
import { getAdminCpaContext } from "@/lib/admin/adminContext"
import { Section, Card, Btn } from "@/components/v2/primitives"

interface Props {
  params: Promise<{ clientId: string }>
}

export default async function ClientProfilePage({ params }: Props) {
  const { clientId } = await params
  await requireAuth()
  const cpaCtx = await getCurrentCpaContext()
  const adminCpaCtx = await getAdminCpaContext()
  const effectiveCpaId = adminCpaCtx?.cpaId ?? cpaCtx?.cpaId ?? null
  if (!effectiveCpaId) redirect("/dashboard")

  const rel = await prisma.cpaClient.findFirst({
    where: { cpaUserId: effectiveCpaId, clientUserId: clientId },
    include: { client: { select: { id: true, name: true, email: true } } },
  })
  if (!rel) notFound()

  const profile = await prisma.businessProfile.findFirst({
    where: { userId: clientId },
    orderBy: { createdAt: "desc" },
  })

  const fields: Array<[string, string | number | null | undefined]> = [
    ["Legal name", rel.client.name ?? rel.client.email],
    ["Email", rel.client.email],
    ["Entity type", profile?.entityType ?? "—"],
    ["State", profile?.primaryState ?? "—"],
    ["NAICS code", profile?.naicsCode ?? "—"],
    ["Industry", profile?.businessDescription ?? "—"],
    ["Accounting method", profile?.accountingMethod ?? "—"],
    ["First year", profile?.firstYear ? "Yes" : "No"],
  ]

  return (
    <Section sub="CPA · CLIENT · PROFILE" title="Business profile" right={<Btn kind="primary">Edit profile</Btn>}>
      <Card>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 24 }}>
          {fields.map(([k, v], i) => (
            <div key={k} style={{ paddingBottom: 12, borderBottom: i < fields.length - 2 ? "1px solid var(--hairline)" : "none" }}>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--fg-3)",
                  letterSpacing: 1.2,
                  fontWeight: 700,
                  textTransform: "uppercase",
                }}
              >
                {k}
              </div>
              <div style={{ fontSize: 14, marginTop: 4 }}>{v ?? "—"}</div>
            </div>
          ))}
        </div>
      </Card>
    </Section>
  )
}
