import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface Props {
  params: Promise<{ year: string }>
}

export default async function YearPage({ params }: Props) {
  const { year: yearParam } = await params
  const session = await requireAuth()
  const userId = session.user!.id!

  const year = parseInt(yearParam, 10)
  if (isNaN(year)) notFound()

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    include: {
      _count: { select: { transactions: true, financialAccounts: true, merchantRules: true } },
      businessProfile: { select: { naicsCode: true, businessDescription: true, entityType: true } },
      financialAccounts: { select: { id: true, institution: true, nickname: true, mask: true, type: true } },
    },
  })

  if (!taxYear) notFound()

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-foreground">Tax Year {year}</h1>
        <Badge variant="outline">{taxYear.status}</Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">Accounts</CardTitle></CardHeader>
          <CardContent><span className="text-3xl font-bold">{taxYear._count.financialAccounts}</span></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">Transactions</CardTitle></CardHeader>
          <CardContent><span className="text-3xl font-bold">{taxYear._count.transactions}</span></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">Merchant Rules</CardTitle></CardHeader>
          <CardContent><span className="text-3xl font-bold">{taxYear._count.merchantRules}</span></CardContent>
        </Card>
      </div>

      {taxYear.businessProfile && (
        <Card>
          <CardHeader><CardTitle>Business Profile</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p><span className="text-muted-foreground">Description:</span> {taxYear.businessProfile.businessDescription}</p>
            <p><span className="text-muted-foreground">NAICS:</span> {taxYear.businessProfile.naicsCode}</p>
            <p><span className="text-muted-foreground">Entity:</span> {taxYear.businessProfile.entityType}</p>
          </CardContent>
        </Card>
      )}

      {taxYear.financialAccounts.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Accounts</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {taxYear.financialAccounts.map((acct) => (
                <li key={acct.id} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{acct.nickname ?? acct.institution}</span>
                  <span className="text-muted-foreground">{acct.type} ···{acct.mask}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
