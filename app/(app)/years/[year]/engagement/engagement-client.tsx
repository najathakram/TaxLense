"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  draftEngagementLetter,
  requestEngagementSignature,
  markEngagementSigned,
  generate8879,
  markForm8879Signed,
  recordFilingMilestone,
} from "./actions"

interface EngagementShape {
  bodyMarkdown: string
  clientName: string
  clientEmail: string
  signatureStatus: string
  cpaSignedAt: string | null
  clientSignedAt: string | null
  signatureToken: string | null
}
interface F8879Shape {
  totalIncomeUsd: number
  taxableIncomeUsd: number
  totalTaxUsd: number
  refundOrAmtDue: number
  eroPin: string
  taxpayerPin: string
  signatureStatus: string
  signedAt: string | null
}
interface MilestoneRow {
  id: string
  status: string
  occurredAt: string
  notes: string
  externalRef: string
}

interface Props {
  year: number
  isLocked: boolean
  defaultBody: string
  defaultClientName: string
  defaultClientEmail: string
  engagement: EngagementShape | null
  form8879: F8879Shape | null
  filingMilestones: MilestoneRow[]
}

const FILING_OPTIONS = [
  { value: "EFILED", label: "E-filed (transmitted)" },
  { value: "ACCEPTED_BY_IRS", label: "Accepted by IRS" },
  { value: "REJECTED_BY_IRS", label: "Rejected by IRS" },
  { value: "PAPER_FILED", label: "Paper-filed" },
  { value: "REFUND_RECEIVED", label: "Refund received" },
  { value: "BALANCE_PAID", label: "Balance paid" },
] as const

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 })
}

export function EngagementClient({
  year,
  isLocked,
  defaultBody,
  defaultClientName,
  defaultClientEmail,
  engagement,
  form8879,
  filingMilestones,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [body, setBody] = useState(engagement?.bodyMarkdown ?? defaultBody)
  const [clientName, setClientName] = useState(engagement?.clientName ?? defaultClientName)
  const [clientEmail, setClientEmail] = useState(engagement?.clientEmail ?? defaultClientEmail)

  const [taxableIncome, setTaxableIncome] = useState<number>(form8879?.taxableIncomeUsd ?? 0)
  const [totalTax, setTotalTax] = useState<number>(form8879?.totalTaxUsd ?? 0)
  const [refundOrDue, setRefundOrDue] = useState<number>(form8879?.refundOrAmtDue ?? 0)
  const [eroPin, setEroPin] = useState(form8879?.eroPin ?? "")
  const [taxpayerPin, setTaxpayerPin] = useState(form8879?.taxpayerPin ?? "")

  const [milestoneStatus, setMilestoneStatus] = useState<typeof FILING_OPTIONS[number]["value"]>("EFILED")
  const [milestoneNotes, setMilestoneNotes] = useState("")
  const [milestoneRef, setMilestoneRef] = useState("")

  function saveDraft() {
    setError(null)
    startTransition(async () => {
      const res = await draftEngagementLetter({ year, bodyMarkdown: body, clientName, clientEmail })
      if (!res.ok) setError(res.error)
      else router.refresh()
    })
  }
  function requestSig() {
    setError(null)
    startTransition(async () => {
      const res = await requestEngagementSignature(year)
      if (!res.ok) setError(res.error)
      else router.refresh()
    })
  }
  function markSigned(who: "CPA" | "CLIENT") {
    setError(null)
    startTransition(async () => {
      const res = await markEngagementSigned(year, who)
      if (!res.ok) setError(res.error)
      else router.refresh()
    })
  }
  function gen8879() {
    setError(null)
    startTransition(async () => {
      const res = await generate8879({
        year,
        taxableIncome,
        totalTax,
        refundOrDue,
        eroPin: eroPin || null,
        taxpayerPin: taxpayerPin || null,
      })
      if (!res.ok) setError(res.error)
      else router.refresh()
    })
  }
  function sign8879() {
    setError(null)
    startTransition(async () => {
      const res = await markForm8879Signed(year)
      if (!res.ok) setError(res.error)
      else router.refresh()
    })
  }
  function addMilestone() {
    setError(null)
    startTransition(async () => {
      const res = await recordFilingMilestone({
        year,
        status: milestoneStatus,
        notes: milestoneNotes || null,
        externalRef: milestoneRef || null,
      })
      if (!res.ok) setError(res.error)
      else {
        setMilestoneNotes("")
        setMilestoneRef("")
        router.refresh()
      }
    })
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Engagement & Filing — Tax Year {year}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Engagement letter, Form 8879 e-file authorization, and the filing-status tracker.
          Engagement letter can be drafted any time; Form 8879 requires the year LOCKED so the
          income figures are final.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Engagement letter */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Engagement letter
            {engagement && (
              <Badge variant={engagement.signatureStatus === "SIGNED" ? "default" : "outline"} className="ml-2 text-xs">
                {engagement.signatureStatus}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Client name</Label>
              <Input value={clientName} onChange={(e) => setClientName(e.target.value)} />
            </div>
            <div>
              <Label>Client email</Label>
              <Input
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label>Body (markdown)</Label>
            <Textarea
              rows={14}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Button onClick={saveDraft} disabled={isPending} size="sm">
              Save draft
            </Button>
            <Button
              onClick={requestSig}
              disabled={isPending || !engagement}
              size="sm"
              variant="outline"
            >
              Request client signature
            </Button>
            <Button
              onClick={() => markSigned("CPA")}
              disabled={isPending || !engagement || !!engagement.cpaSignedAt}
              size="sm"
              variant="outline"
            >
              Mark CPA-signed
            </Button>
            <Button
              onClick={() => markSigned("CLIENT")}
              disabled={isPending || !engagement || !!engagement.clientSignedAt}
              size="sm"
              variant="outline"
            >
              Mark client-signed
            </Button>
            <a
              href={`/api/years/${year}/documents/engagement-letter/pdf?inline=0`}
              className="text-xs underline ml-auto"
              download
            >
              Download PDF
            </a>
          </div>
          {engagement?.signatureToken && (
            <Alert>
              <AlertDescription className="font-mono text-xs">
                Signature link: /sign/engagement/{engagement.signatureToken}
                <br />
                <span className="text-muted-foreground">
                  Email this link to {engagement.clientEmail}. Token rotates each request.
                </span>
              </AlertDescription>
            </Alert>
          )}
          {engagement && (engagement.cpaSignedAt || engagement.clientSignedAt) && (
            <div className="text-xs space-y-1 pt-2 border-t">
              {engagement.cpaSignedAt && <p>CPA signed: {engagement.cpaSignedAt.slice(0, 19)}</p>}
              {engagement.clientSignedAt && <p>Client signed: {engagement.clientSignedAt.slice(0, 19)}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Form 8879 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Form 8879 — IRS e-file authorization
            {form8879 && (
              <Badge
                variant={form8879.signatureStatus === "SIGNED" ? "default" : "outline"}
                className="ml-2 text-xs"
              >
                {form8879.signatureStatus}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isLocked && (
            <Alert>
              <AlertDescription>
                Form 8879 needs the year LOCKED so the Part I income figures are final. Lock the
                year first on Finalize.
              </AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Total income (1040 line 9 / Schedule C)</Label>
              <Input
                type="number"
                value={form8879?.totalIncomeUsd ?? 0}
                disabled
                className="font-mono"
              />
            </div>
            <div>
              <Label>Taxable income (1040 line 15)</Label>
              <Input
                type="number"
                step="0.01"
                value={taxableIncome}
                onChange={(e) => setTaxableIncome(Number(e.target.value))}
              />
            </div>
            <div>
              <Label>Total tax (1040 line 24)</Label>
              <Input
                type="number"
                step="0.01"
                value={totalTax}
                onChange={(e) => setTotalTax(Number(e.target.value))}
              />
            </div>
            <div>
              <Label>Refund (+) / Balance due (−)</Label>
              <Input
                type="number"
                step="0.01"
                value={refundOrDue}
                onChange={(e) => setRefundOrDue(Number(e.target.value))}
              />
            </div>
            <div>
              <Label>ERO PIN (5 digits)</Label>
              <Input
                value={eroPin}
                maxLength={5}
                onChange={(e) => setEroPin(e.target.value)}
              />
            </div>
            <div>
              <Label>Taxpayer self-select PIN</Label>
              <Input
                value={taxpayerPin}
                maxLength={5}
                onChange={(e) => setTaxpayerPin(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <Button onClick={gen8879} disabled={isPending || !isLocked} size="sm">
              {form8879 ? "Update Form 8879" : "Generate Form 8879"}
            </Button>
            <Button
              onClick={sign8879}
              disabled={isPending || !form8879 || form8879.signatureStatus === "SIGNED"}
              size="sm"
              variant="outline"
            >
              Mark taxpayer-signed
            </Button>
            <a
              href={`/api/years/${year}/documents/form-8879/pdf?inline=0`}
              className="text-xs underline ml-auto"
              download
            >
              Download PDF
            </a>
          </div>
          {form8879 && (
            <div className="text-xs space-y-1 pt-2 border-t font-mono">
              <p>Total income: {fmt(form8879.totalIncomeUsd)}</p>
              <p>Taxable income: {fmt(form8879.taxableIncomeUsd)}</p>
              <p>Total tax: {fmt(form8879.totalTaxUsd)}</p>
              <p>Refund/Due: {fmt(form8879.refundOrAmtDue)}</p>
              {form8879.signedAt && <p className="text-emerald-500">Signed: {form8879.signedAt.slice(0, 19)}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filing status tracker */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Filing status tracker</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Status</Label>
              <select
                className="w-full border rounded px-2 py-1.5 bg-background text-sm mt-1"
                value={milestoneStatus}
                onChange={(e) => setMilestoneStatus(e.target.value as typeof FILING_OPTIONS[number]["value"])}
              >
                {FILING_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input value={milestoneNotes} onChange={(e) => setMilestoneNotes(e.target.value)} />
            </div>
            <div>
              <Label>External ref (e.g. Drake ack ID)</Label>
              <Input value={milestoneRef} onChange={(e) => setMilestoneRef(e.target.value)} />
            </div>
          </div>
          <Button onClick={addMilestone} disabled={isPending} size="sm">
            Record milestone
          </Button>
          {filingMilestones.length > 0 && (
            <table className="w-full text-xs mt-2">
              <thead className="text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-1">Status</th>
                  <th className="text-left">When</th>
                  <th className="text-left">Notes</th>
                  <th className="text-left">Ref</th>
                </tr>
              </thead>
              <tbody>
                {filingMilestones.map((m) => (
                  <tr key={m.id} className="border-b">
                    <td className="py-1">
                      <Badge variant="outline" className="text-[10px]">{m.status}</Badge>
                    </td>
                    <td className="font-mono text-[10px]">{m.occurredAt.slice(0, 19)}</td>
                    <td>{m.notes}</td>
                    <td className="font-mono text-[10px]">{m.externalRef}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
