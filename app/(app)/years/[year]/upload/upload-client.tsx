"use client"

import { useState, useRef, useTransition, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Textarea } from "@/components/ui/textarea"
import {
  uploadStatement,
  parseImport,
  deleteImport,
  createAccount,
  saveImportNotes,
  saveUploadSessionNotes,
  closeUploadSession,
} from "./actions"
import type { ParseStatus } from "@/app/generated/prisma/client"
import type { ContextualPrompt } from "@/lib/uploads/contextualPrompts"

// ── Types (serialised from server) ──────────────────────────────────────────

interface ImportRow {
  id: string
  originalFilename: string
  fileType: string
  institution: string | null
  parseStatus: ParseStatus
  parseConfidence: number | null
  transactionCount: number
  totalInflows: number | null
  totalOutflows: number | null
  reconciliationOk: boolean | null
  reconciliationDelta: number | null
  parseError: string | null
  uploadedAt: string
  periodStart: string | null
  periodEnd: string | null
}

interface AccountRow {
  id: string
  institution: string
  nickname: string | null
  mask: string | null
  type: string
  isPrimaryBusiness: boolean
  statementImports: ImportRow[]
}

interface SessionSnapshot {
  id: string
  totalApiCalls: number
  apiCallLimit: number
  notes: string | null
  uploadedAt: string
}

interface Props {
  year: number
  taxYearId: string
  taxYearStatus: string
  accounts: AccountRow[]
  session: SessionSnapshot | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PARSE_STATUS_BADGE: Record<ParseStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  PENDING:  { label: "Pending",  variant: "secondary" },
  SUCCESS:  { label: "Success",  variant: "default" },
  FAILED:   { label: "Failed",   variant: "destructive" },
  PARTIAL:  { label: "Partial",  variant: "outline" },
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function fmtMoney(n: number | null): string {
  if (n === null) return "—"
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" })
}

function confidencePct(n: number | null): string {
  if (n === null) return "—"
  return `${Math.round(n * 100)}%`
}

// ── Add Account Dialog ────────────────────────────────────────────────────────

function AddAccountDialog({
  year,
  open,
  onClose,
}: {
  year: number
  open: boolean
  onClose: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [type, setType] = useState<string>("")
  const [institution, setInstitution] = useState("")
  const [nickname, setNickname] = useState("")
  const [mask, setMask] = useState("")
  const [isPrimary, setIsPrimary] = useState(false)

  function handleSubmit() {
    if (!type || !institution.trim()) {
      setError("Account type and institution name are required")
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await createAccount({
        year,
        type: type as "CHECKING" | "SAVINGS" | "CREDIT_CARD" | "BROKERAGE" | "PAYMENT_PROCESSOR",
        institution: institution.trim(),
        nickname: nickname.trim() || undefined,
        mask: mask.trim() || undefined,
        isPrimaryBusiness: isPrimary,
      })
      if (result.ok) {
        onClose()
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Financial Account</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1">
            <Label>Account Type *</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue placeholder="Select type…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CHECKING">Checking</SelectItem>
                <SelectItem value="SAVINGS">Savings</SelectItem>
                <SelectItem value="CREDIT_CARD">Credit Card</SelectItem>
                <SelectItem value="BROKERAGE">Brokerage</SelectItem>
                <SelectItem value="PAYMENT_PROCESSOR">Payment Processor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Institution Name *</Label>
            <Input
              placeholder="e.g. Chase, American Express…"
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Nickname</Label>
              <Input
                placeholder="e.g. Chase Freedom"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Last 4 digits</Label>
              <Input
                placeholder="1234"
                maxLength={4}
                value={mask}
                onChange={(e) => setMask(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isPrimary"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="isPrimary" className="cursor-pointer">
              Primary business account
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Adding…" : "Add Account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Upload Card (per account) ─────────────────────────────────────────────────

type PollState = { status: "PENDING" | "SUCCESS" | "FAILED" | "PARTIAL"; txCount: number; error: string | null }

function UploadCard({
  account,
  year,
  onSessionUpdate,
}: {
  account: AccountRow
  year: number
  onSessionUpdate: (snap: { id: string; used: number; limit: number }) => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null)
  const [stagingProgress, setStagingProgress] = useState<{ done: number; total: number } | null>(null)
  const [polled, setPolled] = useState<Record<string, PollState>>({})
  const [historyOpen, setHistoryOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const pendingIds = Object.entries(polled)
    .filter(([, s]) => s.status === "PENDING")
    .map(([id]) => id)

  const updatePoll = useCallback((id: string, state: PollState) => {
    setPolled((prev) => ({ ...prev, [id]: state }))
  }, [])

  useEffect(() => {
    if (pendingIds.length === 0) return
    const handle = setInterval(async () => {
      for (const id of pendingIds) {
        try {
          const res = await fetch(`/api/imports/${id}/status`)
          if (res.status === 404) {
            // Import was auto-deleted (missing file). Remove from poll and refresh.
            setPolled((prev) => {
              const next = { ...prev }
              delete next[id]
              return next
            })
            router.refresh()
            continue
          }
          if (!res.ok) continue
          const data = await res.json()
          if (data.parseStatus !== "PENDING") {
            updatePoll(id, {
              status: data.parseStatus,
              txCount: data.transactionCount ?? 0,
              error: data.parseError ?? null,
            })
            if (data.sessionId) {
              onSessionUpdate({ id: data.sessionId, used: data.apiCallsUsed, limit: data.apiCallLimit })
            }
            router.refresh()
          }
        } catch { /* network blip — retry next tick */ }
      }
    }, 2000)
    return () => clearInterval(handle)
  }, [pendingIds.join(","), updatePoll, onSessionUpdate, router])

  // Derive summary once all polled ids have resolved
  useEffect(() => {
    const entries = Object.values(polled)
    if (entries.length === 0) return
    if (entries.some((s) => s.status === "PENDING")) return // still waiting
    const ok = entries.filter((s) => s.status === "SUCCESS" || s.status === "PARTIAL")
    const failed = entries.filter((s) => s.status === "FAILED")
    const totalTx = ok.reduce((s, e) => s + e.txCount, 0)
    if (ok.length > 0) {
      setUploadSuccess(
        ok.length === 1
          ? `${totalTx} transactions extracted`
          : `${ok.length}/${entries.length} files parsed · ${totalTx} transactions`,
      )
    }
    if (failed.length > 0) {
      setUploadError(failed.map((e) => e.error ?? "Parse failed").join("\n"))
    }
  }, [polled])

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return

    setUploadError(null)
    setUploadSuccess(null)
    setStagingProgress({ done: 0, total: files.length })

    startTransition(async () => {
      const errors: string[] = []
      let lastSession: { id: string; used: number; limit: number } | null = null

      for (let i = 0; i < files.length; i++) {
        const file = files[i]!
        const formData = new FormData()
        formData.append("file", file)
        formData.append("accountId", account.id)
        formData.append("year", year.toString())

        const result = await uploadStatement(formData)
        if (result.ok) {
          // Register as PENDING; polling effect picks it up
          setPolled((prev) => ({
            ...prev,
            [result.importId]: { status: "PENDING", txCount: 0, error: null },
          }))
          lastSession = {
            id: result.sessionId,
            used: result.apiCallsUsed,
            limit: result.apiCallLimit,
          }
        } else {
          errors.push(`${file.name}: ${result.error}`)
        }
        setStagingProgress({ done: i + 1, total: files.length })
      }

      if (lastSession) onSessionUpdate(lastSession)
      if (errors.length > 0) setUploadError(errors.join("\n"))
      setStagingProgress(null)
      if (fileRef.current) fileRef.current.value = ""
    })
  }

  function handleReparse(importId: string) {
    setUploadError(null)
    setUploadSuccess(null)
    // Re-stage as PENDING so the polling effect picks it up
    setPolled((prev) => ({ ...prev, [importId]: { status: "PENDING", txCount: 0, error: null } }))
    startTransition(async () => {
      const result = await parseImport(importId, year)
      if (!result.ok) {
        setPolled((prev) => ({
          ...prev,
          [importId]: { status: "FAILED", txCount: 0, error: result.error },
        }))
      }
    })
  }

  function handleDelete(importId: string) {
    startTransition(async () => {
      const result = await deleteImport(importId, year)
      if (!result.ok) setUploadError(result.error)
    })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            {account.nickname ?? account.institution}
            {account.mask && <span className="text-muted-foreground font-normal ml-1">···{account.mask}</span>}
          </CardTitle>
          <Badge variant="outline" className="text-xs">{account.type.replace("_", " ")}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">{account.institution}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Upload zone */}
        <div className="border-2 border-dashed border-border rounded-lg p-4 text-center">
          <p className="text-sm text-muted-foreground mb-2">
            Upload CSV, OFX, QFX, or PDF statement (multiple files OK)
          </p>
          <Label htmlFor={`file-${account.id}`} className="cursor-pointer">
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              asChild
            >
              <span>
                {isPending && stagingProgress
                  ? `Staging ${stagingProgress.done}/${stagingProgress.total}…`
                  : pendingIds.length > 0
                    ? `Parsing ${pendingIds.length} file${pendingIds.length > 1 ? "s" : ""}…`
                    : "Choose Files"}
              </span>
            </Button>
          </Label>
          <input
            ref={fileRef}
            id={`file-${account.id}`}
            type="file"
            accept=".csv,.ofx,.qfx,.pdf"
            multiple
            className="hidden"
            onChange={handleUpload}
            disabled={isPending}
          />
        </div>

        {uploadError && (
          <Alert variant="destructive">
            <AlertDescription className="text-sm">{uploadError}</AlertDescription>
          </Alert>
        )}
        {uploadSuccess && (
          <Alert>
            <AlertDescription className="text-sm text-green-700">{uploadSuccess}</AlertDescription>
          </Alert>
        )}

        {/* Import history — collapsible */}
        {account.statementImports.length > 0 && (
          <div className="space-y-2">
            <button
              onClick={() => setHistoryOpen((o) => !o)}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left"
            >
              <span className={`transition-transform ${historyOpen ? "rotate-90" : ""}`}>▶</span>
              {account.statementImports.length} statement{account.statementImports.length !== 1 ? "s" : ""} imported
              <span className="ml-1 text-[10px]">
                ({account.statementImports.filter((i) => i.parseStatus === "SUCCESS").length} ok
                {account.statementImports.filter((i) => i.parseStatus === "FAILED").length > 0 &&
                  `, ${account.statementImports.filter((i) => i.parseStatus === "FAILED").length} failed`})
              </span>
            </button>

            {historyOpen && account.statementImports.map((imp) => {
              const status = PARSE_STATUS_BADGE[imp.parseStatus]
              return (
                <div key={imp.id} className="rounded-md border p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium truncate max-w-[200px]" title={imp.originalFilename}>
                      {imp.originalFilename}
                    </span>
                    <Badge variant={status.variant} className="text-xs">{status.label}</Badge>
                  </div>
                  <div className="text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-0.5">
                    {imp.institution && <span>Institution: {imp.institution}</span>}
                    <span>Transactions: {imp.transactionCount}</span>
                    {imp.periodStart && (
                      <span>Period: {fmtDate(imp.periodStart)} – {fmtDate(imp.periodEnd)}</span>
                    )}
                    {imp.totalOutflows !== null && <span>Outflows: {fmtMoney(imp.totalOutflows)}</span>}
                    {imp.totalInflows !== null && <span>Inflows: {fmtMoney(imp.totalInflows)}</span>}
                    <span>Confidence: {confidencePct(imp.parseConfidence)}</span>
                    <span>Uploaded: {fmtDate(imp.uploadedAt)}</span>
                  </div>
                  {imp.parseError && (
                    <p className="text-destructive mt-1">{imp.parseError}</p>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => handleReparse(imp.id)}
                      disabled={isPending}
                      className="text-xs underline text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      Reparse
                    </button>
                    {(imp.parseStatus === "FAILED" || imp.parseStatus === "PENDING") && (
                      <button
                        onClick={() => handleDelete(imp.id)}
                        disabled={isPending}
                        className="text-xs underline text-destructive hover:opacity-70 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Main Client Component ────────────────────────────────────────────────────

export function UploadClient({ year, taxYearStatus, accounts, session }: Props) {
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [sessionState, setSessionState] = useState(
    session ? { id: session.id, used: session.totalApiCalls, limit: session.apiCallLimit } : null,
  )
  const isLocked = taxYearStatus === "LOCKED"

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Upload Statements</h1>
          <p className="text-sm text-muted-foreground">Tax Year {year}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline">{taxYearStatus}</Badge>
          {sessionState && (
            <Badge variant={sessionState.used >= sessionState.limit ? "destructive" : "secondary"}>
              API calls: {sessionState.used} / {sessionState.limit}
            </Badge>
          )}
          {!isLocked && (
            <Button onClick={() => setShowAddAccount(true)}>
              + Add Account
            </Button>
          )}
        </div>
      </div>

      {isLocked && (
        <Alert>
          <AlertDescription>
            This tax year is locked. No new uploads are allowed.
          </AlertDescription>
        </Alert>
      )}

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground text-sm mb-4">
              No financial accounts yet. Add an account to start uploading statements.
            </p>
            {!isLocked && (
              <Button onClick={() => setShowAddAccount(true)}>
                Add Your First Account
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {accounts.map((acct) => (
            <UploadCard
              key={acct.id}
              account={acct}
              year={year}
              onSessionUpdate={(snap) => setSessionState(snap)}
            />
          ))}
        </div>
      )}

      {sessionState && !isLocked && (
        <SessionNotesCard
          year={year}
          sessionId={sessionState.id}
          initialNotes={session?.notes ?? ""}
        />
      )}

      <AddAccountDialog
        year={year}
        open={showAddAccount}
        onClose={() => setShowAddAccount(false)}
      />
    </div>
  )
}

// ── Session Notes Card ───────────────────────────────────────────────────────

function SessionNotesCard({
  year,
  sessionId,
  initialNotes,
}: {
  year: number
  sessionId: string
  initialNotes: string
}) {
  const [notes, setNotes] = useState(initialNotes)
  const [isPending, startTransition] = useTransition()
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleSave() {
    setError(null)
    startTransition(async () => {
      const res = await saveUploadSessionNotes(sessionId, year, notes)
      if (res.ok) setSavedAt(new Date().toLocaleTimeString())
      else setError(res.error)
    })
  }

  function handleClose() {
    if (!confirm("Close this upload session? A new session will open on the next upload.")) return
    startTransition(async () => {
      const res = await closeUploadSession(sessionId, year)
      if (!res.ok) setError(res.error)
    })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Session notes</CardTitle>
        <p className="text-xs text-muted-foreground">
          These notes are added to the AI classification prompt as client context.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          placeholder="Anything the CPA should know? e.g. 'Zelle to Francisco = contractor payments', 'Chase ···9517 is personal, only the one deposit in March is business'."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
        />
        {error && (
          <Alert variant="destructive">
            <AlertDescription className="text-sm">{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {savedAt ? `Saved at ${savedAt}` : null}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleClose} disabled={isPending}>
              Close session
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isPending}>
              {isPending ? "Saving…" : "Save notes"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Contextual Prompts Dialog ────────────────────────────────────────────────

function ContextualPromptsDialog({
  year,
  importId,
  prompts,
  onClose,
}: {
  year: number
  importId: string
  prompts: ContextualPrompt[]
  onClose: () => void
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleSubmit() {
    setError(null)
    startTransition(async () => {
      const notes: Record<string, unknown> = {}
      prompts.forEach((p, idx) => {
        const key = `${p.kind}_${idx}`
        const ans = answers[key]
        if (ans && ans.trim()) {
          notes[key] = { question: p.question, answer: ans.trim(), context: p.context }
        }
      })
      const res = await saveImportNotes({ importId, year, notes })
      if (res.ok) onClose()
      else setError(res.error)
    })
  }

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>A few quick questions about this statement</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-xs text-muted-foreground">
            Your answers become context for the AI classifier. Skip anything you're unsure about.
          </p>
          {prompts.map((p, idx) => {
            const key = `${p.kind}_${idx}`
            return (
              <div key={key} className="space-y-1">
                <Label className="text-sm font-medium">{p.question}</Label>
                <Textarea
                  value={answers[key] ?? ""}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [key]: e.target.value }))}
                  rows={2}
                  placeholder="Your answer…"
                />
              </div>
            )
          })}
          {error && (
            <Alert variant="destructive">
              <AlertDescription className="text-sm">{error}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Skip all</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Saving…" : "Save answers"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
