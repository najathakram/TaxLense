"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import type { TransactionCode } from "@/app/generated/prisma/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { TRANSACTION_CODES, SCHEDULE_C_LINES, codeColorClass } from "@/lib/classification/constants"
import { AMAZON_MERCHANT_PATTERN, AMAZON_SPLIT_THRESHOLD } from "@/lib/splits/config"
import {
  editClassification,
  bulkReclassify,
  splitTransaction,
  applyReclassification,
  fetchMerchantCategories,
  type SplitInput,
  type NLMatch,
  type NLRuleUpdate,
} from "./actions"

export interface LedgerRow {
  id: string
  date: string
  accountId: string
  accountNickname: string | null
  merchantRaw: string
  merchantNormalized: string | null
  descriptionRaw: string | null
  amount: number
  code: TransactionCode
  scheduleCLine: string | null
  businessPct: number
  deductibleAmt: number
  evidenceTier: number
  confidence: number
  isUserConfirmed: boolean
  reasoning: string
  isChildOfSplit: boolean
}

interface Props {
  year: number
  rows: LedgerRow[]
  accounts: { id: string; nickname: string | null }[]
}

export function LedgerClient({ year, rows, accounts }: Props) {
  // ---- filter state ----
  const [accountFilter, setAccountFilter] = useState<Set<string>>(new Set())
  const [codeFilter, setCodeFilter] = useState<Set<TransactionCode>>(new Set())
  const [merchantSearch, setMerchantSearch] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  // ---- sort state ----
  const [sortKey, setSortKey] = useState<"date" | "account" | "amount">("date")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  // ---- AI merchant categories ----
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({})
  useEffect(() => {
    const unique = Array.from(new Set(rows.map((r) => r.merchantNormalized ?? r.merchantRaw)))
    fetchMerchantCategories(year, unique).then(setCategoryMap).catch(() => {})
  }, [year, rows])

  // ---- selection state ----
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // ---- NL override state ----
  const [nlInstruction, setNlInstruction] = useState("")
  const [nlPreview, setNlPreview] = useState<null | {
    matches: NLMatch[]
    rule_updates: NLRuleUpdate[]
  }>(null)
  const [nlLoading, setNlLoading] = useState(false)
  const [nlError, setNlError] = useState<string | null>(null)

  // ---- split dialog state ----
  const [splitRow, setSplitRow] = useState<LedgerRow | null>(null)

  const [pending, start] = useTransition()

  const filtered = useMemo(() => {
    const q = merchantSearch.trim().toLowerCase()
    const list = rows.filter((r) => {
      if (accountFilter.size > 0 && !accountFilter.has(r.accountId)) return false
      if (codeFilter.size > 0 && !codeFilter.has(r.code)) return false
      if (q && !(r.merchantRaw.toLowerCase().includes(q) || (r.merchantNormalized ?? "").toLowerCase().includes(q) || (r.descriptionRaw ?? "").toLowerCase().includes(q))) return false
      if (dateFrom && r.date < dateFrom) return false
      if (dateTo && r.date > dateTo) return false
      return true
    })
    const dir = sortDir === "asc" ? 1 : -1
    return [...list].sort((a, b) => {
      if (sortKey === "date") return dir * a.date.localeCompare(b.date)
      if (sortKey === "account") return dir * (a.accountNickname ?? "").localeCompare(b.accountNickname ?? "")
      if (sortKey === "amount") return dir * (a.amount - b.amount)
      return 0
    })
  }, [rows, accountFilter, codeFilter, merchantSearch, dateFrom, dateTo, sortKey, sortDir])

  // ---- virtualizer ----
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 52,
    overscan: 12,
  })

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc")
    else { setSortKey(key); setSortDir("asc") }
  }
  const sortArrow = (key: typeof sortKey) => sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : ""

  const toggleSet = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    return next
  }

  const totalDeductible = filtered.reduce((s, r) => s + r.deductibleAmt, 0)

  // ---- handlers ----
  const onInlineEdit = (edit: Parameters<typeof editClassification>[1]) => {
    start(async () => {
      try {
        await editClassification(year, edit)
      } catch (e) {
        alert(e instanceof Error ? e.message : String(e))
      }
    })
  }

  const onBulk = (partial: { code?: TransactionCode; businessPct?: number; confirm?: boolean }) => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    start(async () => {
      try {
        await bulkReclassify(year, { transactionIds: ids, ...partial })
        setSelected(new Set())
      } catch (e) {
        alert(e instanceof Error ? e.message : String(e))
      }
    })
  }

  const onNLPreview = async () => {
    if (!nlInstruction.trim()) return
    setNlLoading(true)
    setNlError(null)
    try {
      const res = await fetch("/api/reclassify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          instruction: nlInstruction,
          candidateIds: filtered.map((r) => r.id).slice(0, 500),
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      const data = (await res.json()) as { matches: NLMatch[]; rule_updates: NLRuleUpdate[] }
      setNlPreview(data)
    } catch (e) {
      setNlError(e instanceof Error ? e.message : String(e))
    } finally {
      setNlLoading(false)
    }
  }

  const onNLApply = () => {
    if (!nlPreview) return
    start(async () => {
      try {
        await applyReclassification(year, nlInstruction, nlPreview.matches, nlPreview.rule_updates)
        setNlPreview(null)
        setNlInstruction("")
      } catch (e) {
        alert(e instanceof Error ? e.message : String(e))
      }
    })
  }

  return (
    <div className="space-y-4">
      {/* NL override bar */}
      <div className="border rounded p-3 bg-muted/30 space-y-2">
        <Label className="text-xs">Tell the AI what to change</Label>
        <div className="flex gap-2">
          <Input
            placeholder='e.g. "Mark all Zelle payments to Francisco A. as personal."'
            value={nlInstruction}
            onChange={(e) => setNlInstruction(e.target.value)}
            className="flex-1"
          />
          <Button disabled={nlLoading || !nlInstruction.trim()} onClick={onNLPreview}>
            {nlLoading ? "Previewing…" : "Preview"}
          </Button>
        </div>
        {nlError && <p className="text-xs text-red-600">{nlError}</p>}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-end text-xs">
        <div>
          <Label className="text-xs">Account</Label>
          <div className="flex flex-wrap gap-1 mt-1">
            {accounts.map((a) => (
              <button
                key={a.id}
                onClick={() => setAccountFilter(toggleSet(accountFilter, a.id))}
                className={`px-2 py-1 rounded border ${accountFilter.has(a.id) ? "bg-primary text-primary-foreground" : "bg-background"}`}
              >
                {a.nickname}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label className="text-xs">Code</Label>
          <div className="flex flex-wrap gap-1 mt-1 max-w-xl">
            {TRANSACTION_CODES.map((c) => (
              <button
                key={c}
                onClick={() => setCodeFilter(toggleSet(codeFilter, c))}
                className={`px-2 py-0.5 rounded border ${codeFilter.has(c) ? "bg-primary text-primary-foreground" : "bg-background"}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label className="text-xs">Merchant</Label>
          <Input
            className="h-8 w-48"
            value={merchantSearch}
            onChange={(e) => setMerchantSearch(e.target.value)}
            placeholder="Search…"
          />
        </div>
        <div>
          <Label className="text-xs">From</Label>
          <Input className="h-8 w-36" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">To</Label>
          <Input className="h-8 w-36" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <div className="ml-auto text-right">
          <div>{filtered.length} rows</div>
          <div className="font-semibold">${totalDeductible.toFixed(2)} deductible</div>
        </div>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex flex-wrap gap-2 items-center border rounded p-2 bg-accent/20 text-sm">
          <span>{selected.size} selected</span>
          <select
            className="border rounded p-1 bg-background"
            onChange={(e) => {
              const v = e.target.value
              e.currentTarget.value = ""
              if (v) onBulk({ code: v as TransactionCode })
            }}
            defaultValue=""
            disabled={pending}
          >
            <option value="">Reclassify as…</option>
            {TRANSACTION_CODES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => onBulk({ confirm: true })}>
            Confirm all
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => onBulk({ businessPct: 100 })}>
            Set pct 100
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => onBulk({ businessPct: 0 })}>
            Set pct 0
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {/* Virtualized table */}
      <div className="border rounded">
        <div className="grid grid-cols-[40px_90px_120px_1fr_120px_100px_150px_120px_70px_110px_70px_70px_70px] bg-muted/50 text-xs font-semibold border-b">
          <div className="p-2"></div>
          <button className="p-2 text-left hover:text-primary" onClick={() => toggleSort("date")}>Date{sortArrow("date")}</button>
          <button className="p-2 text-left hover:text-primary" onClick={() => toggleSort("account")}>Account{sortArrow("account")}</button>
          <div className="p-2">Merchant</div>
          <div className="p-2">Category</div>
          <button className="p-2 text-right w-full hover:text-primary" onClick={() => toggleSort("amount")}>Amount{sortArrow("amount")}</button>
          <div className="p-2">Code</div>
          <div className="p-2">Sch C Line</div>
          <div className="p-2 text-right">Biz %</div>
          <div className="p-2 text-right">Deductible</div>
          <div className="p-2 text-center">Tier</div>
          <div className="p-2 text-center">Conf</div>
          <div className="p-2 text-center">✓</div>
        </div>
        <div ref={scrollRef} className="overflow-auto" style={{ height: "60vh" }} data-testid="ledger-scroll">
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              position: "relative",
              width: "100%",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((v) => {
              const r = filtered[v.index]!
              const isSplitChild = r.isChildOfSplit
              return (
                <div
                  key={r.id}
                  data-testid="ledger-row"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${v.size}px`,
                    transform: `translateY(${v.start}px)`,
                  }}
                  className={`grid grid-cols-[40px_90px_120px_1fr_120px_100px_150px_120px_70px_110px_70px_70px_70px] text-xs border-b hover:bg-accent/20 ${codeColorClass(r.code)} ${r.evidenceTier >= 3 ? "italic text-muted-foreground" : ""} ${isSplitChild ? "pl-4" : ""}`}
                >
                  <div className="p-2">
                    <Checkbox
                      checked={selected.has(r.id)}
                      onCheckedChange={() => setSelected(toggleSet(selected, r.id))}
                    />
                  </div>
                  <div className="p-2">{r.date}</div>
                  <div className="p-2 truncate">{r.accountNickname}</div>
                  <div className="p-2 min-w-0" title={r.merchantRaw}>
                    <div className="truncate">{r.merchantNormalized ?? r.merchantRaw}</div>
                    {r.descriptionRaw && r.descriptionRaw !== r.merchantRaw && (
                      <div className="truncate text-[10px] text-muted-foreground">{r.descriptionRaw}</div>
                    )}
                  </div>
                  <div className="p-2 truncate text-muted-foreground text-[11px]">
                    {categoryMap[r.merchantNormalized ?? r.merchantRaw] ?? ""}
                  </div>
                  <div className={`p-2 text-right tabular-nums ${r.amount > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                    {r.amount > 0 ? "-" : "+"}${Math.abs(r.amount).toFixed(2)}
                  </div>
                  <div className="p-2">
                    <select
                      className="w-full bg-transparent border rounded p-0.5"
                      value={r.code}
                      disabled={pending}
                      onChange={(e) => onInlineEdit({ transactionId: r.id, code: e.target.value as TransactionCode })}
                    >
                      {TRANSACTION_CODES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div className="p-2">
                    <select
                      className="w-full bg-transparent border rounded p-0.5"
                      value={r.scheduleCLine ?? ""}
                      disabled={pending}
                      onChange={(e) =>
                        onInlineEdit({
                          transactionId: r.id,
                          scheduleCLine: e.target.value || null,
                        })
                      }
                    >
                      <option value="">—</option>
                      {SCHEDULE_C_LINES.map((l) => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </select>
                  </div>
                  <div className="p-2 text-right">
                    <BizPctEditor
                      value={r.businessPct}
                      disabled={r.code === "WRITE_OFF_TRAVEL" || pending}
                      onCommit={(v) => onInlineEdit({ transactionId: r.id, businessPct: v })}
                    />
                  </div>
                  <div className="p-2 text-right tabular-nums">${r.deductibleAmt.toFixed(2)}</div>
                  <div className="p-2 text-center">
                    <Badge variant="outline">{r.evidenceTier}</Badge>
                  </div>
                  <div className="p-2 text-center">
                    <div className="h-1.5 bg-muted rounded overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${Math.round(r.confidence * 100)}%` }} />
                    </div>
                  </div>
                  <div className="p-2 text-center flex items-center justify-center gap-1">
                    <Checkbox
                      checked={r.isUserConfirmed}
                      disabled={pending}
                      onCheckedChange={() => onInlineEdit({ transactionId: r.id, confirm: true })}
                    />
                    <ExplainPopover reasoning={r.reasoning} />
                    {AMAZON_MERCHANT_PATTERN.test(r.merchantRaw) &&
                      Math.abs(r.amount) > AMAZON_SPLIT_THRESHOLD && (
                        <button
                          className="text-[10px] underline"
                          onClick={() => setSplitRow(r)}
                          disabled={pending}
                        >
                          Split
                        </button>
                      )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* NL preview dialog */}
      <Dialog open={!!nlPreview} onOpenChange={(open) => !open && setNlPreview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Preview reclassification</DialogTitle>
          </DialogHeader>
          {nlPreview && (
            <div className="space-y-3 text-sm">
              <p>
                This will change <strong>{nlPreview.matches.length}</strong> rows
                {nlPreview.rule_updates.length > 0 && (
                  <> across <strong>{nlPreview.rule_updates.length}</strong> merchant rule{nlPreview.rule_updates.length !== 1 ? "s" : ""}</>
                )}.
              </p>
              <div className="max-h-72 overflow-auto border rounded text-xs">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-1">Txn</th>
                      <th className="text-left p-1">New Code</th>
                      <th className="text-right p-1">New %</th>
                      <th className="text-left p-1">Reasoning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nlPreview.matches.map((m) => (
                      <tr key={m.transactionId} className="border-t">
                        <td className="p-1 font-mono">{m.transactionId.slice(0, 10)}</td>
                        <td className="p-1">{m.newCode}</td>
                        <td className="p-1 text-right">{m.newBusinessPct}</td>
                        <td className="p-1 truncate max-w-sm" title={m.reasoning}>{m.reasoning}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNlPreview(null)}>Cancel</Button>
            <Button onClick={onNLApply} disabled={pending}>
              {pending ? "Applying…" : "Proceed"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Amazon split dialog */}
      {splitRow && (
        <AmazonSplitDialog
          year={year}
          row={splitRow}
          onClose={() => setSplitRow(null)}
        />
      )}
    </div>
  )
}

function BizPctEditor({
  value,
  disabled,
  onCommit,
}: {
  value: number
  disabled: boolean
  onCommit: (v: number) => void
}) {
  const [draft, setDraft] = useState(value)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="text-xs underline disabled:no-underline"
          disabled={disabled}
        >
          {value}%
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2">
        <Label className="text-xs">Business %: {draft}</Label>
        <input
          type="range"
          min={0}
          max={100}
          value={draft}
          onChange={(e) => setDraft(parseInt(e.target.value, 10))}
          className="w-full"
        />
        <div className="flex justify-end gap-1">
          <Button size="sm" onClick={() => onCommit(draft)}>Save</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ExplainPopover({ reasoning }: { reasoning: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="text-[10px] underline">?</button>
      </PopoverTrigger>
      <PopoverContent className="w-96 text-xs whitespace-pre-wrap">
        {reasoning || <span className="text-muted-foreground italic">No reasoning recorded.</span>}
      </PopoverContent>
    </Popover>
  )
}

// ---------- Amazon split dialog ----------

function AmazonSplitDialog({
  year,
  row,
  onClose,
}: {
  year: number
  row: LedgerRow
  onClose: () => void
}) {
  const [splits, setSplits] = useState<SplitInput[]>([
    {
      amount: Math.abs(row.amount),
      code: "WRITE_OFF",
      scheduleCLine: "Line 18 Office Expense",
      businessPct: 100,
      reasoning: "",
    },
  ])
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const parentCents = Math.round(Math.abs(row.amount) * 100)
  const sumCents = splits.reduce((s, x) => s + Math.round(x.amount * 100), 0)
  const valid = parentCents === sumCents && splits.every((s) => s.amount > 0)

  const update = (i: number, patch: Partial<SplitInput>) =>
    setSplits(splits.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))

  const addSplit = () => {
    if (splits.length >= 5) return
    setSplits([
      ...splits,
      {
        amount: 0,
        code: "WRITE_OFF",
        scheduleCLine: "Line 18 Office Expense",
        businessPct: 100,
        reasoning: "",
      },
    ])
  }

  const removeSplit = (i: number) => setSplits(splits.filter((_, idx) => idx !== i))

  const onSave = () => {
    setError(null)
    start(async () => {
      try {
        await splitTransaction(year, row.id, splits)
        onClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Split transaction — {row.merchantNormalized ?? row.merchantRaw}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>
            Parent: <strong>${Math.abs(row.amount).toFixed(2)}</strong> on {row.date}
          </p>
          <div className="space-y-2">
            {splits.map((s, i) => (
              <div key={i} className="border rounded p-2 space-y-1">
                <div className="flex gap-2 items-center">
                  <Input
                    type="number"
                    step="0.01"
                    value={s.amount}
                    onChange={(e) => update(i, { amount: parseFloat(e.target.value) || 0 })}
                    className="w-28"
                  />
                  <select
                    className="border rounded p-1 bg-background"
                    value={s.code}
                    onChange={(e) => update(i, { code: e.target.value as TransactionCode })}
                  >
                    {TRANSACTION_CODES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <select
                    className="border rounded p-1 bg-background text-xs"
                    value={s.scheduleCLine ?? ""}
                    onChange={(e) => update(i, { scheduleCLine: e.target.value || null })}
                  >
                    <option value="">—</option>
                    {SCHEDULE_C_LINES.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={s.businessPct}
                    onChange={(e) => update(i, { businessPct: parseInt(e.target.value, 10) || 0 })}
                    className="w-16"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeSplit(i)}
                    disabled={splits.length === 1}
                  >
                    ×
                  </Button>
                </div>
                <Textarea
                  placeholder="Reasoning"
                  value={s.reasoning}
                  onChange={(e) => update(i, { reasoning: e.target.value })}
                  className="h-12 text-xs"
                />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between text-xs">
            <Button variant="outline" size="sm" onClick={addSplit} disabled={splits.length >= 5}>
              + Add split
            </Button>
            <div className={valid ? "text-green-600" : "text-red-600"}>
              Sum: ${(sumCents / 100).toFixed(2)} / ${(parentCents / 100).toFixed(2)} —{" "}
              Delta: ${((parentCents - sumCents) / 100).toFixed(2)}
            </div>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} disabled={!valid || pending}>
            {pending ? "Saving…" : "Save splits"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
