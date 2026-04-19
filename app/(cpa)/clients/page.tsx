import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { enterClientSession } from "@/lib/cpa/actions"

const STATUS_LABELS: Record<string, string> = {
  CREATED: "Not started",
  INGESTION: "Uploading",
  CLASSIFICATION: "AI classifying",
  REVIEW: "Under review",
  LOCKED: "Locked",
  ARCHIVED: "Archived",
}

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline"> = {
  CREATED: "outline",
  INGESTION: "secondary",
  CLASSIFICATION: "secondary",
  REVIEW: "default",
  LOCKED: "default",
  ARCHIVED: "secondary",
}

export default async function ClientsPage() {
  const session = await requireAuth()
  const userId = session.user!.id!

  // Ensure the logged-in user is a CPA
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (me?.role !== "CPA") redirect("/dashboard")

  const cpaClients = await prisma.cpaClient.findMany({
    where: { cpaUserId: userId },
    include: {
      client: {
        select: {
          id: true,
          name: true,
          email: true,
          taxYears: {
            orderBy: { year: "desc" },
            take: 1,
            include: {
              _count: { select: { transactions: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  })

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Clients</h1>
          <p className="text-muted-foreground">{cpaClients.length} client{cpaClients.length !== 1 ? "s" : ""}</p>
        </div>
        <Button asChild>
          <Link href="/clients/new">+ Add Client</Link>
        </Button>
      </div>

      {cpaClients.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">No clients yet. Add your first client to get started.</p>
            <Button asChild>
              <Link href="/clients/new">Add Client</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cpaClients.map((rel) => {
            const name = rel.displayName ?? rel.client.name ?? rel.client.email
            const latestYear = rel.client.taxYears[0]
            return (
              <Card key={rel.id} className="flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate">{name}</CardTitle>
                      <CardDescription className="text-xs truncate">{rel.client.email}</CardDescription>
                    </div>
                    {latestYear && (
                      <Badge
                        variant={STATUS_VARIANTS[latestYear.status] ?? "outline"}
                        className="shrink-0 text-xs"
                      >
                        {STATUS_LABELS[latestYear.status] ?? latestYear.status}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-0 flex-1 flex flex-col justify-between gap-4">
                  <div className="text-sm text-muted-foreground space-y-1">
                    {latestYear ? (
                      <>
                        <p>TY {latestYear.year}</p>
                        <p>
                          {latestYear._count.transactions} transaction
                          {latestYear._count.transactions !== 1 ? "s" : ""}
                        </p>
                      </>
                    ) : (
                      <p>No tax years yet</p>
                    )}
                  </div>
                  <form
                    action={async () => {
                      "use server"
                      await enterClientSession(rel.client.id)
                    }}
                  >
                    <Button type="submit" className="w-full" size="sm">
                      Open client workspace →
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
