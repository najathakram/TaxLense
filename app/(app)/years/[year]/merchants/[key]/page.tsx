import { notFound } from "next/navigation"
import Link from "next/link"
import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { inYearWindow } from "@/lib/queries/yearWindow"

interface Props {
  params: Promise<{ year: string; key: string }>
}

export default async function MerchantDetailPage({ params }: Props) {
  const { year: yearParam, key } = await params
  const userId = await getCurrentUserId()
  const year = parseInt(yearParam, 10)
  if (isNaN(year)) notFound()
  const merchantKey = decodeURIComponent(key)

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
  })
  if (!taxYear) notFound()

  // Load the rule first so we can scope the audit-event query to its ID.
  const rule = await prisma.merchantRule.findFirst({
    where: { taxYearId: taxYear.id, merchantKey },
  })
  const [txns, notes] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        taxYearId: taxYear.id,
        merchantNormalized: merchantKey,
        isSplit: false,
        isStale: false,
        ...inYearWindow(year),
      },
      include: {
        account: { select: { institution: true, mask: true, nickname: true } },
        classifications: {
          orderBy: { createdAt: "desc" },
          include: { cpaNotes: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true, email: true } } } } },
        },
      },
      orderBy: { postedDate: "desc" },
    }),
    prisma.auditEvent.findMany({
      where: {
        entityType: "MerchantRule",
        eventType: { in: ["MERCHANT_RULE_UPDATED", "MERCHANT_RULE_CREATED", "STOP_RESOLVED"] },
        entityId: rule?.id ?? "__no_match__",
      },
      orderBy: { occurredAt: "desc" },
      take: 20,
      include: { user: { select: { name: true, email: true } }, actorCpa: { select: { name: true, email: true } } },
    }),
  ])

  const activeClassifications = txns.flatMap((t) =>
    t.classifications.filter((c) => c.isCurrent).map((c) => ({
      ...c,
      txn: { id: t.id, postedDate: t.postedDate, merchantRaw: t.merchantRaw, account: t.account, amountNormalized: t.amountNormalized },
    })),
  )

  const totalAmount = activeClassifications.reduce(
    (s, c) => s + Math.abs(Number(c.txn.amountNormalized.toString())),
    0,
  )

  return (
    <div className="grid grid-cols-2 gap-4 p-6 h-[calc(100vh-72px)] overflow-hidden">
      {/* Left — transactions */}
      <div className="overflow-y-auto pr-3">
        <h1 className="text-xl font-bold mb-3">{merchantKey}</h1>
        <p className="text-xs text-muted-foreground mb-4">
          {txns.length} transactions · ${totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })} total
        </p>
        {txns.map((t) => {
          const c = t.classifications.find((x) => x.isCurrent)
          const amt = Number(t.amountNormalized.toString())
          return (
            <Card key={t.id} className="mb-3">
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-mono text-xs">{t.postedDate.toISOString().slice(0, 10)}</span>
                  <span className={`font-mono ${amt < 0 ? "text-emerald-500" : "text-red-500"}`}>
                    {amt < 0 ? "+" : "-"}${Math.abs(amt).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {t.account.nickname ?? t.account.institution}
                  {t.account.mask ? ` ··${t.account.mask}` : ""} · {t.merchantRaw}
                </div>
                {c && (
                  <div className="flex items-center gap-2 text-xs pt-1">
                    <Badge variant="outline" className="text-[10px]">{c.code}</Badge>
                    {c.scheduleCLine && <span className="text-muted-foreground">{c.scheduleCLine}</span>}
                    <span className="ml-auto">tier {c.evidenceTier}</span>
                  </div>
                )}
                {c?.cpaNotes && c.cpaNotes.length > 0 && (
                  <div className="border-t pt-2 mt-2 space-y-1">
                    {c.cpaNotes.map((n) => (
                      <div key={n.id} className="text-xs">
                        💬 <span className="text-muted-foreground">{n.author.name ?? n.author.email}:</span> {n.body}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Right — Merchant rule + history */}
      <div className="overflow-y-auto pl-3 border-l space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Merchant Rule</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            {rule ? (
              <>
                <p><span className="text-muted-foreground">Code:</span> <Badge variant="outline">{rule.code}</Badge></p>
                <p><span className="text-muted-foreground">Schedule line:</span> {rule.scheduleCLine ?? "—"}</p>
                <p><span className="text-muted-foreground">Default biz %:</span> {rule.businessPctDefault}%</p>
                <p><span className="text-muted-foreground">Trip override:</span> {rule.appliesTripOverride ? "yes" : "no"}</p>
                <p><span className="text-muted-foreground">Confidence:</span> {(rule.confidence * 100).toFixed(0)}%</p>
                <p><span className="text-muted-foreground">Citations:</span> {rule.ircCitations.join(", ") || "—"}</p>
                <p className="pt-2 border-t text-xs text-muted-foreground">{rule.reasoning}</p>
              </>
            ) : (
              <p className="text-muted-foreground">No MerchantRule yet — run the CPA agent or Apply Rules.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Rule history</CardTitle>
          </CardHeader>
          <CardContent>
            {notes.length === 0 ? (
              <p className="text-xs text-muted-foreground">No history events captured for this rule.</p>
            ) : (
              <ul className="text-xs space-y-2">
                {notes.map((n) => (
                  <li key={n.id} className="border-l-2 pl-2 border-muted-foreground/30">
                    <div className="text-muted-foreground">
                      {n.occurredAt.toISOString().slice(0, 19).replace("T", " ")} ·{" "}
                      <Badge variant="outline" className="text-[9px]">{n.eventType}</Badge>
                    </div>
                    {n.rationale && <p className="italic">&ldquo;{n.rationale}&rdquo;</p>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          <Link href={`/years/${year}/ledger`} className="underline">← Back to ledger</Link>
        </p>
      </div>
    </div>
  )
}
