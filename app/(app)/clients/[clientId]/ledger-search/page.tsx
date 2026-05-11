import { notFound } from "next/navigation"
import Link from "next/link"
import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getCurrentCpaContext } from "@/lib/cpa/clientContext"
import { getAdminCpaContext } from "@/lib/admin/adminContext"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

interface Props {
  params: Promise<{ clientId: string }>
  searchParams?: Promise<{ q?: string; minDollar?: string }>
}

const YEAR_COLORS = ["bg-blue-500/15 text-blue-400", "bg-emerald-500/15 text-emerald-400", "bg-amber-500/15 text-amber-400", "bg-pink-500/15 text-pink-400", "bg-violet-500/15 text-violet-400"]

export default async function MultiYearLedgerSearchPage({ params, searchParams }: Props) {
  await requireAuth()
  const { clientId } = await params
  const sp = (await searchParams) ?? {}
  const q = (sp.q ?? "").trim()
  const minDollar = parseFloat(sp.minDollar ?? "0")

  const cpaCtx = await getCurrentCpaContext()
  const adminCpaCtx = await getAdminCpaContext()
  const effectiveCpaId = adminCpaCtx?.cpaId ?? cpaCtx?.cpaId ?? null
  if (!effectiveCpaId) notFound()
  const rel = await prisma.cpaClient.findFirst({
    where: { cpaUserId: effectiveCpaId, clientUserId: clientId },
    include: { client: { select: { id: true, name: true, email: true } } },
  })
  if (!rel) notFound()

  // Find every TaxYear for the client and search across them.
  const years = await prisma.taxYear.findMany({
    where: { userId: clientId },
    orderBy: { year: "desc" },
    select: { id: true, year: true },
  })
  const yearMap = new Map(years.map((y) => [y.id, y.year]))
  const yearColor = new Map(years.map((y, i) => [y.year, YEAR_COLORS[i % YEAR_COLORS.length]]))

  const where: Record<string, unknown> = {
    taxYearId: { in: years.map((y) => y.id) },
    isSplit: false,
    isStale: false,
    isDuplicateOf: null,
  }
  if (q) {
    where.OR = [
      { merchantRaw: { contains: q, mode: "insensitive" } },
      { merchantNormalized: { contains: q, mode: "insensitive" } },
    ]
  }
  const limit = q ? 200 : 0  // No query = empty result; search is opt-in
  const txns = q
    ? await prisma.transaction.findMany({
        where,
        include: {
          account: { select: { institution: true, mask: true, nickname: true } },
          classifications: { where: { isCurrent: true }, take: 1 },
        },
        orderBy: { postedDate: "desc" },
        take: limit,
      })
    : []
  const filtered = minDollar > 0
    ? txns.filter((t) => Math.abs(Number(t.amountNormalized.toString())) >= minDollar)
    : txns

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Multi-year ledger search — {rel.client.name ?? rel.client.email}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Search across {years.length} year{years.length === 1 ? "" : "s"}. Useful when the CPA wonders "did this client pay this vendor last year too?"
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4">
          <form action="" method="get" className="flex gap-2 flex-wrap">
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Merchant search (e.g. WISE INC, Adobe, Kirsten Hatch)"
              className="flex-1 min-w-[240px] border rounded px-3 py-1.5 text-sm bg-background"
            />
            <input
              type="number"
              name="minDollar"
              defaultValue={minDollar > 0 ? String(minDollar) : ""}
              placeholder="Min $"
              className="w-24 border rounded px-3 py-1.5 text-sm bg-background"
            />
            <button type="submit" className="text-sm border rounded px-3 py-1.5 hover:bg-accent">Search</button>
          </form>
        </CardContent>
      </Card>

      {q && (
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b text-xs text-muted-foreground">
              {filtered.length} match{filtered.length === 1 ? "" : "es"} for &ldquo;{q}&rdquo; across {years.length} year{years.length === 1 ? "" : "s"}
              {minDollar > 0 ? ` (≥ $${minDollar})` : ""}.
            </div>
            <table className="w-full text-xs">
              <thead className="border-b">
                <tr>
                  <th className="text-left px-4 py-2">Year</th>
                  <th className="text-left">Date</th>
                  <th className="text-left">Account</th>
                  <th className="text-left">Merchant</th>
                  <th className="text-right">Amount</th>
                  <th className="text-left">Code</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => {
                  const c = t.classifications[0]
                  const amt = Number(t.amountNormalized.toString())
                  const year = yearMap.get(t.taxYearId)!
                  return (
                    <tr key={t.id} className="border-b hover:bg-muted/20">
                      <td className="px-4 py-2">
                        <Badge className={`text-[10px] ${yearColor.get(year)}`}>{year}</Badge>
                      </td>
                      <td className="font-mono">{t.postedDate.toISOString().slice(0, 10)}</td>
                      <td className="text-muted-foreground">
                        {t.account.nickname ?? t.account.institution}
                        {t.account.mask ? ` ··${t.account.mask}` : ""}
                      </td>
                      <td>{t.merchantNormalized ?? t.merchantRaw}</td>
                      <td className={`text-right font-mono ${amt < 0 ? "text-emerald-500" : "text-red-500"}`}>
                        {amt < 0 ? "+" : "-"}${Math.abs(amt).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </td>
                      <td>
                        {c ? (
                          <Link
                            href={`/years/${year}/ledger?txnId=${t.id}`}
                            className="text-[10px] underline"
                          >
                            {c.code}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-muted-foreground">
                      No transactions matching the criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
