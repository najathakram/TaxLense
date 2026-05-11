import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { detectNeededMemos } from "@/lib/ai/positionMemo"
import { Card, CardContent } from "@/components/ui/card"

interface Props {
  params: Promise<{ year: string }>
}

const MEMO_LABELS: Record<string, string> = {
  "§183_hobby": "§183 Hobby Loss",
  "§274n2_100pct_meals": "§274(n)(2) 100% Meals",
  "§280A_home_office": "§280A Home Office",
  wardrobe: "Wardrobe (NAICS 7115xx)",
}

export default async function MemosIndexPage({ params }: Props) {
  const { year: yearParam } = await params
  const userId = await getCurrentUserId()
  const year = parseInt(yearParam, 10)
  if (isNaN(year)) notFound()

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
  })
  if (!taxYear) notFound()
  const memos = await detectNeededMemos(taxYear.id).catch(() => [] as string[])

  if (memos.length === 1) {
    redirect(`/years/${year}/memos/${encodeURIComponent(memos[0]!)}`)
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Position Memos — TY {year}</h1>
      <p className="text-sm text-muted-foreground">
        AI-drafted memos defending gray-zone tax positions (§183 hobby loss, §274(n)(2) 100%
        meals, §280A home office, wardrobe). Each memo follows the FACTS / LAW / ANALYSIS /
        CONCLUSION structure required by Circular 230 §10.34.
      </p>
      {memos.length === 0 ? (
        <p className="text-sm text-muted-foreground">No memos required for this tax year.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {memos.map((m) => (
            <Link key={m} href={`/years/${year}/memos/${encodeURIComponent(m)}`}>
              <Card className="hover:bg-accent/50 cursor-pointer">
                <CardContent className="p-4">
                  <div className="font-medium text-sm">{MEMO_LABELS[m] ?? m}</div>
                  <div className="text-xs text-muted-foreground mt-1">{m}</div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
