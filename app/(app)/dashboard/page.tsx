import { requireAuth } from "@/lib/auth"
import { getCurrentUserId } from "@/lib/auth"
import { getClientContext } from "@/lib/cpa/clientContext"
import { prisma } from "@/lib/db"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const STATUS_LABELS: Record<string, string> = {
  CREATED: "Not started",
  INGESTION: "Uploading statements",
  CLASSIFICATION: "AI classification",
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

export default async function DashboardPage() {
  const session = await requireAuth()
  const loggedInUserId = session.user!.id!

  // CPA without an active client context → send them to the client list
  const me = await prisma.user.findUnique({ where: { id: loggedInUserId }, select: { role: true } })
  if (me?.role === "CPA") {
    const ctx = await getClientContext()
    if (!ctx) redirect("/clients")
  }

  const userId = await getCurrentUserId()

  const taxYears = await prisma.taxYear.findMany({
    where: { userId },
    orderBy: { year: "desc" },
    include: {
      _count: { select: { transactions: true, financialAccounts: true } },
    },
  })

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tax Years</h1>
          <p className="text-muted-foreground">Your Schedule C workspaces</p>
        </div>
      </div>

      {taxYears.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">No tax years yet.</p>
            <Button asChild>
              <Link href="/onboarding">Start Profile Wizard</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {taxYears.map((ty) => (
            <Link key={ty.id} href={`/years/${ty.year}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>TY {ty.year}</CardTitle>
                    <Badge variant={STATUS_VARIANTS[ty.status] ?? "outline"}>
                      {STATUS_LABELS[ty.status] ?? ty.status}
                    </Badge>
                  </div>
                  <CardDescription>
                    {ty._count.financialAccounts} account{ty._count.financialAccounts !== 1 ? "s" : ""} ·{" "}
                    {ty._count.transactions} transaction{ty._count.transactions !== 1 ? "s" : ""}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
