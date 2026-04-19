import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { redirect } from "next/navigation"
import Link from "next/link"
import { buildFirmOverview } from "@/lib/analytics/build"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

function fmtUSD(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
}

export default async function FirmAnalyticsPage() {
  const session = await requireAuth()
  const userId = session.user!.id!
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (me?.role !== "CPA") redirect("/dashboard")

  const summaries = await buildFirmOverview(userId)

  const totalReceipts = summaries.reduce((s, c) => s + c.grossReceipts, 0)
  const totalDeductions = summaries.reduce((s, c) => s + c.totalDeductible, 0)
  const totalProfit = summaries.reduce((s, c) => s + c.netProfit, 0)
  const lockedCount = summaries.filter((c) => c.status === "LOCKED").length
  const pendingStops = summaries.reduce((s, c) => s + c.pendingStops, 0)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Firm Overview</h1>
        <p className="text-sm text-muted-foreground">
          {summaries.length} client{summaries.length === 1 ? "" : "s"} · {lockedCount} locked · {pendingStops} pending STOPs
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="py-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Portfolio gross receipts</p>
            <p className="text-2xl font-bold">{fmtUSD(totalReceipts)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Portfolio deductions</p>
            <p className="text-2xl font-bold">{fmtUSD(totalDeductions)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Portfolio net profit</p>
            <p className={`text-2xl font-bold ${totalProfit < 0 ? "text-destructive" : ""}`}>
              {fmtUSD(totalProfit)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clients</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs uppercase text-muted-foreground">
                <th className="text-left py-2 px-4">Client</th>
                <th className="text-left py-2 px-4">Year</th>
                <th className="text-left py-2 px-4">Status</th>
                <th className="text-right py-2 px-4">Receipts</th>
                <th className="text-right py-2 px-4">Deductions</th>
                <th className="text-right py-2 px-4">Net</th>
                <th className="text-right py-2 px-4">Open STOPs</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((c) => (
                <tr key={c.clientUserId} className="border-b hover:bg-muted/40">
                  <td className="py-2 px-4 font-medium">{c.clientName}</td>
                  <td className="py-2 px-4">{c.year ?? "—"}</td>
                  <td className="py-2 px-4">
                    {c.status ? <Badge variant="outline">{c.status}</Badge> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="py-2 px-4 text-right">{fmtUSD(c.grossReceipts)}</td>
                  <td className="py-2 px-4 text-right">{fmtUSD(c.totalDeductible)}</td>
                  <td className={`py-2 px-4 text-right ${c.netProfit < 0 ? "text-destructive" : ""}`}>
                    {fmtUSD(c.netProfit)}
                  </td>
                  <td className="py-2 px-4 text-right">
                    {c.pendingStops > 0 ? (
                      <Badge variant="destructive" className="text-xs">{c.pendingStops}</Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                </tr>
              ))}
              {summaries.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground">
                    No clients yet. <Link href="/clients/new" className="underline">Add one</Link>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
