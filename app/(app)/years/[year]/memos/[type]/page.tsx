import { notFound } from "next/navigation"
import Link from "next/link"
import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { generatePositionMemo } from "@/lib/ai/positionMemo"
import type { MemoType } from "@/lib/rules/memoRules"
import { runLockAssertions } from "@/lib/validation/assertions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"

interface Props {
  params: Promise<{ year: string; type: string }>
}

const VALID_TYPES = new Set<string>(["§183_hobby", "§274n2_100pct_meals", "§280A_home_office", "wardrobe"])

const MEMO_LABELS: Record<string, string> = {
  "§183_hobby": "§183 Hobby Loss Defense",
  "§274n2_100pct_meals": "§274(n)(2) — 100% Meals Position",
  "§280A_home_office": "§280A Home Office Defense",
  wardrobe: "Wardrobe Deduction Defense (NAICS 7115xx)",
}

const SECTION_RX = /^(FACTS|LAW|ANALYSIS|CONCLUSION):/i

export default async function MemoViewerPage({ params }: Props) {
  const { year: yearParam, type } = await params
  const memoType = decodeURIComponent(type)
  const userId = await getCurrentUserId()
  const year = parseInt(yearParam, 10)
  if (isNaN(year)) notFound()
  if (!VALID_TYPES.has(memoType)) notFound()

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
  })
  if (!taxYear) notFound()

  // Memo gating (P1.5): require assertions to pass before drafting on top of
  // in-flux data. If failing, we still let the user view but flag the warning.
  const assertions = await runLockAssertions(taxYear.id)
  const assertionsPass = assertions.blockingFailures.length === 0

  let memoBody: string | null = null
  let memoError: string | null = null
  let exposure = 0
  let modelUsed = ""
  try {
    const result = await generatePositionMemo(memoType as MemoType, taxYear.id)
    memoBody = result.text
    exposure = result.exposure
    modelUsed = result.modelUsed
  } catch (e) {
    memoError = e instanceof Error ? e.message : String(e)
  }

  // Split by section markers so we can render each with its own heading.
  const sections: Array<{ label: string; body: string }> = []
  if (memoBody) {
    const lines = memoBody.split("\n")
    let cur = { label: "Preamble", body: "" }
    for (const ln of lines) {
      const m = SECTION_RX.exec(ln)
      if (m) {
        if (cur.body.trim().length) sections.push(cur)
        cur = { label: m[1]!.toUpperCase(), body: ln.replace(SECTION_RX, "").trim() + "\n" }
      } else {
        cur.body += ln + "\n"
      }
    }
    if (cur.body.trim().length) sections.push(cur)
  }

  return (
    <div className="p-6 max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{MEMO_LABELS[memoType] ?? memoType}</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Tax Year {year} · drafted by {modelUsed || "Claude"} per memo-rule library{" "}
          (lib/rules/memoRules.ts)
          {exposure > 0 && ` · exposure $${exposure.toLocaleString()}`}
        </p>
      </div>

      {!assertionsPass && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">
            Lock-assertions are currently failing — this memo is being drafted on top of
            in-flux data. Resolve blockers in /finalize first or treat this as preview only.
          </AlertDescription>
        </Alert>
      )}

      {memoError && (
        <Alert variant="destructive">
          <AlertDescription>Failed to generate memo: {memoError}</AlertDescription>
        </Alert>
      )}

      {sections.length > 0 ? (
        sections.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                {s.label}
                {["FACTS", "LAW", "ANALYSIS", "CONCLUSION"].includes(s.label) && (
                  <Badge variant="outline" className="text-[9px]">required</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm">
                {s.body.trim()}
              </div>
            </CardContent>
          </Card>
        ))
      ) : memoBody ? (
        <Card>
          <CardContent className="pt-4">
            <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm">{memoBody}</div>
          </CardContent>
        </Card>
      ) : null}

      <p className="text-xs text-muted-foreground">
        <Link href={`/years/${year}/memos`} className="underline">← All memos</Link> ·{" "}
        <Link href={`/years/${year}/finalize`} className="underline">Finalize →</Link>
      </p>
    </div>
  )
}
