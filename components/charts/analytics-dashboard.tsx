"use client"

import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  RadialBarChart,
  RadialBar,
} from "recharts"
import type { AnalyticsDataset } from "@/lib/analytics/build"
import { RED_FLAG_THRESHOLDS } from "@/lib/analytics/irsBenchmarks"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#84cc16", "#ec4899", "#64748b", "#f97316"]

const fmtUSD = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`

function ChartCard({
  title,
  children,
  warning,
}: {
  title: string
  children: React.ReactNode
  warning?: string | null
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between">
          <span>{title}</span>
          {warning && <Badge variant="destructive" className="text-xs">{warning}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export function AnalyticsDashboard({ data }: { data: AnalyticsDataset }) {
  // Derive red-flag warnings
  const highMealsMonth = data.charts.mealsRatio.find(
    (m) => m.ratio > RED_FLAG_THRESHOLDS.mealsRatioOfReceipts,
  )
  const highVehicle =
    data.charts.vehicleGauge.hasConfig &&
    data.charts.vehicleGauge.bizPct / 100 > RED_FLAG_THRESHOLDS.vehicleBizPct

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="py-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Gross receipts</p>
            <p className="text-2xl font-bold">{fmtUSD(data.grossReceipts)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total deductions</p>
            <p className="text-2xl font-bold">{fmtUSD(data.totalDeductible)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Net profit</p>
            <p className={`text-2xl font-bold ${data.netProfit < 0 ? "text-destructive" : ""}`}>
              {fmtUSD(data.netProfit)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Row 1: deduction mix + meals ratio */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Deduction mix vs industry">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.charts.deductionMix}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-25} textAnchor="end" height={70} />
              <YAxis tickFormatter={fmtPct} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => fmtPct(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="clientShare" name="This client" fill="#3b82f6" />
              <Bar dataKey="benchmarkShare" name="Industry median" fill="#94a3b8" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Meals as % of receipts"
          warning={highMealsMonth ? `>${(RED_FLAG_THRESHOLDS.mealsRatioOfReceipts * 100).toFixed(0)}% in ${highMealsMonth.month}` : null}
        >
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data.charts.mealsRatio}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={fmtPct} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => fmtPct(v)} />
              <Line type="monotone" dataKey="ratio" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Row 2: vehicle gauge + deposits waterfall */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Vehicle business-use %"
          warning={highVehicle ? ">90% is a red flag" : null}
        >
          {data.charts.vehicleGauge.hasConfig ? (
            <ResponsiveContainer width="100%" height={280}>
              <RadialBarChart
                innerRadius="60%"
                outerRadius="90%"
                data={[{ name: "Vehicle", value: data.charts.vehicleGauge.bizPct, fill: "#3b82f6" }]}
                startAngle={180}
                endAngle={0}
              >
                <RadialBar background dataKey="value" />
                <text
                  x="50%"
                  y="60%"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-foreground text-3xl font-bold"
                >
                  {data.charts.vehicleGauge.bizPct}%
                </text>
              </RadialBarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
              No vehicle configured
            </div>
          )}
        </ChartCard>

        <ChartCard title="Deposits reconciliation">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.charts.depositsWaterfall}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={fmtUSD} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => fmtUSD(v)} />
              <Bar dataKey="amount" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Row 3: evidence tier stack + monthly */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Deductions by evidence tier">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.charts.evidenceTierStack} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tickFormatter={fmtUSD} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="scheduleCLine" tick={{ fontSize: 10 }} width={160} />
              <Tooltip formatter={(v: number) => fmtUSD(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="tier1" stackId="a" fill="#10b981" name="Tier 1" />
              <Bar dataKey="tier2" stackId="a" fill="#3b82f6" name="Tier 2" />
              <Bar dataKey="tier3" stackId="a" fill="#f59e0b" name="Tier 3" />
              <Bar dataKey="tier4" stackId="a" fill="#ef4444" name="Tier 4" />
              <Bar dataKey="tier5" stackId="a" fill="#7f1d1d" name="Tier 5" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Monthly expense">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.charts.monthlyExpense}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={fmtUSD} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => fmtUSD(v)} />
              <Bar dataKey="total" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Row 4: top merchants + account donut */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Top merchants by deductible spend">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.charts.topMerchants} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tickFormatter={fmtUSD} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="merchantKey" tick={{ fontSize: 10 }} width={160} />
              <Tooltip formatter={(v: number) => fmtUSD(v)} />
              <Bar dataKey="total" fill="#8b5cf6" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Outflows by account">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={data.charts.accountDonut}
                dataKey="total"
                nameKey="accountLabel"
                cx="50%"
                cy="50%"
                outerRadius={100}
                innerRadius={60}
                label={({ accountLabel }) => accountLabel}
                fontSize={11}
              >
                {data.charts.accountDonut.map((_, idx) => (
                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => fmtUSD(v)} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Row 5: trip map */}
      {data.charts.tripMap.length > 0 && (
        <ChartCard title="Trip spending">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs uppercase text-muted-foreground">
                  <th className="text-left py-2">Trip</th>
                  <th className="text-left py-2">Destination</th>
                  <th className="text-left py-2">Dates</th>
                  <th className="text-right py-2">Transactions</th>
                  <th className="text-right py-2">Deductible</th>
                </tr>
              </thead>
              <tbody>
                {data.charts.tripMap.map((t) => (
                  <tr key={t.tripName} className="border-b">
                    <td className="py-2 font-medium">{t.tripName}</td>
                    <td className="py-2">{t.destination}</td>
                    <td className="py-2 text-muted-foreground">{t.startDate} – {t.endDate}</td>
                    <td className="py-2 text-right">{t.txCount}</td>
                    <td className="py-2 text-right">{fmtUSD(t.totalSpent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
      )}
    </div>
  )
}
