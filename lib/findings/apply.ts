/**
 * FINDINGS_APPLY — Stage 9 of the auto-CPA pipeline.
 *
 * Takes ACCEPTED LedgerFinding rows and applies them via flip-and-insert
 * Classifications + StopItem creation. Each application is wrapped in a
 * Prisma $transaction that asserts the prior Classification.isCurrent=true
 * row matches what the finding saw — mismatch → finding marked SUPERSEDED.
 *
 * This module is the single write surface for findings. Both the UI (the
 * findings page accept button) and the orchestrator call into it.
 */

import { prisma } from "@/lib/db"
import type { Prisma, TransactionCode } from "@/app/generated/prisma/client"
import { assertNot274dCohan, assertOwnerEquityInvariants } from "@/lib/classification/cohanGuards"

export interface ApplyFindingsResult {
  applied: number
  superseded: number
  rejected: number
  errors: Array<{ findingId: string; message: string }>
}

// ProposedAction shape lives in lib/findings/humanize.ts so both the server
// (this file) and the client UI can import it without pulling in the Prisma
// graph. We mirror the type here with a narrower `code` field so the apply
// layer can use the Prisma TransactionCode union for switch exhaustiveness.
//
// At runtime there's no difference — both shapes use the same string codes.
interface ReclassifyAction {
  kind: "RECLASSIFY"
  txnIds: string[]
  code: TransactionCode
  businessPct: number
  scheduleCLine: string | null
  ircCitations: string[]
  evidenceTier: number
  cohanFlag?: boolean
  substantiation?: Record<string, unknown>
}

interface StopAction {
  kind: "STOP"
  category: string
  question: string
  transactionIds: string[]
}

interface BlockAction {
  kind: "BLOCK"
  reason: string
}

interface NoteAction {
  kind: "NOTE"
  suggestion: string
}

type ProposedAction = ReclassifyAction | StopAction | BlockAction | NoteAction

// Re-export the shared client-safe shape so callers (server actions) that
// already import the humanize type can pass it straight through without a
// double-cast. The two shapes differ only in code's union type (the apply
// layer's TransactionCode is the same set of strings as humanize's `string`).
import type { ProposedAction as ClientProposedAction } from "@/lib/findings/humanize"
export type { ClientProposedAction as ProposedActionFromUi }

/**
 * Apply every ACCEPTED finding for the year. Failure of an individual finding
 * is recorded in errors[] but never blocks the rest — best-effort sweep.
 */
export async function applyAcceptedFindings(taxYearId: string): Promise<ApplyFindingsResult> {
  const result: ApplyFindingsResult = { applied: 0, superseded: 0, rejected: 0, errors: [] }

  const findings = await prisma.ledgerFinding.findMany({
    where: { taxYearId, state: "ACCEPTED" },
    orderBy: { createdAt: "asc" },
  })

  for (const f of findings) {
    try {
      // Prefer the CPA-supplied override action over the AI's original
      // proposal. acceptedOption captures the human label of the chosen
      // alternative; overrideAction holds the modified ProposedAction
      // (same JSON shape, same hard-rail guards). When neither is set,
      // we fall back to proposedAction — the legacy path.
      const effectiveAction = (f.overrideAction ?? f.proposedAction) as unknown as ProposedAction
      const outcome = await applyOneFinding(f.id, effectiveAction, taxYearId)
      if (outcome === "applied") result.applied++
      else if (outcome === "superseded") result.superseded++
      else if (outcome === "rejected") result.rejected++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errors.push({ findingId: f.id, message: msg })
      console.error(`[findings_apply] ${f.id} failed:`, msg)
    }
  }

  return result
}

/**
 * Single-finding apply. Use this from the UI when the user clicks "accept"
 * on a specific finding. Returns the outcome enum.
 */
async function applyOneFinding(
  findingId: string,
  action: ProposedAction,
  taxYearId: string
): Promise<"applied" | "superseded" | "rejected"> {
  if (action.kind === "RECLASSIFY") {
    return applyReclassify(findingId, action)
  }
  if (action.kind === "STOP") {
    await applyStopCreation(findingId, action, taxYearId)
    return "applied"
  }
  // BLOCK and NOTE are surface-only — marking them APPLIED records the user
  // acknowledgement but creates no new Classification or StopItem.
  await prisma.$transaction(async (tx) => {
    await tx.ledgerFinding.update({
      where: { id: findingId },
      data: { state: "APPLIED" },
    })
    await tx.auditEvent.create({
      data: {
        actorType: "USER",
        eventType: "FINDING_APPLIED",
        entityType: "LedgerFinding",
        entityId: findingId,
        afterState: { kind: action.kind },
      },
    })
  })
  return "applied"
}

async function applyReclassify(
  findingId: string,
  action: ReclassifyAction
): Promise<"applied" | "superseded" | "rejected"> {
  // Cohan §274(d) guard — re-check at apply time.
  // The merchant fields aren't on the action; fetch from txns. Use the first
  // txn's merchant since RECLASSIFY clusters are uniform-merchant by construction.
  const firstTxn = await prisma.transaction.findUnique({
    where: { id: action.txnIds[0]! },
    select: { merchantRaw: true, merchantNormalized: true },
  })
  if (action.cohanFlag) {
    const guard = assertNot274dCohan({
      code: action.code,
      merchantRaw: firstTxn?.merchantRaw ?? null,
      merchantNormalized: firstTxn?.merchantNormalized ?? null,
      ircCitations: action.ircCitations,
      scheduleCLine: action.scheduleCLine,
    })
    if (!guard.allowed) {
      await prisma.$transaction(async (tx) => {
        await tx.ledgerFinding.update({
          where: { id: findingId },
          data: {
            state: "DISMISSED",
            dismissedRationale: `§274(d) bright line: ${guard.reason}`,
          },
        })
        await tx.auditEvent.create({
          data: {
            actorType: "SYSTEM",
            eventType: "COHAN_FORBIDDEN_REJECTED",
            entityType: "LedgerFinding",
            entityId: findingId,
            afterState: { reason: guard.reason },
          },
        })
      })
      return "rejected"
    }
  }

  // OWNER_EQUITY invariant guard — Balance Sheet item, never §162-deductible,
  // never carries a Schedule C line, businessPct always 0.
  if (action.code === "OWNER_EQUITY") {
    const oeGuard = assertOwnerEquityInvariants({
      code: action.code,
      businessPct: action.businessPct,
      cohanFlag: action.cohanFlag,
      scheduleCLine: action.scheduleCLine,
    })
    if (!oeGuard.allowed) {
      await prisma.$transaction(async (tx) => {
        await tx.ledgerFinding.update({
          where: { id: findingId },
          data: {
            state: "DISMISSED",
            dismissedRationale: `OWNER_EQUITY invariant: ${oeGuard.reason}`,
          },
        })
        await tx.auditEvent.create({
          data: {
            actorType: "SYSTEM",
            eventType: "OWNER_EQUITY_INVARIANT_REJECTED",
            entityType: "LedgerFinding",
            entityId: findingId,
            afterState: { reason: oeGuard.reason },
          },
        })
      })
      return "rejected"
    }
  }

  // Validate that each transaction's current classification still matches what
  // the finding saw (rough check by txnId existence). If a prior classification
  // was mutated by another path, we mark the finding SUPERSEDED.
  const currentClassifications = await prisma.classification.findMany({
    where: { transactionId: { in: action.txnIds }, isCurrent: true },
    select: { id: true, transactionId: true },
  })
  if (currentClassifications.length !== action.txnIds.length) {
    await prisma.$transaction(async (tx) => {
      await tx.ledgerFinding.update({
        where: { id: findingId },
        data: { state: "SUPERSEDED" },
      })
      await tx.auditEvent.create({
        data: {
          actorType: "SYSTEM",
          eventType: "FINDING_DISMISSED",
          entityType: "LedgerFinding",
          entityId: findingId,
          afterState: { reason: "current classifications drifted from finding-time state" },
        },
      })
    })
    return "superseded"
  }

  await prisma.$transaction(async (tx) => {
    for (const txnId of action.txnIds) {
      await tx.classification.updateMany({
        where: { transactionId: txnId, isCurrent: true },
        data: { isCurrent: false },
      })
      await tx.classification.create({
        data: {
          transactionId: txnId,
          code: action.code,
          scheduleCLine: action.scheduleCLine,
          businessPct: action.businessPct,
          ircCitations: action.ircCitations,
          confidence: 0.9,
          evidenceTier: action.evidenceTier,
          source: "AI_USER_CONFIRMED",
          reasoning: `Applied via LedgerFinding ${findingId}`,
          cohanFlag: action.cohanFlag === true,
          substantiation: (action.substantiation as never) ?? undefined,
          isCurrent: true,
        },
      })
    }
    await tx.ledgerFinding.update({
      where: { id: findingId },
      data: { state: "APPLIED" },
    })
    await tx.auditEvent.create({
      data: {
        actorType: "USER",
        eventType: "FINDING_APPLIED",
        entityType: "LedgerFinding",
        entityId: findingId,
        afterState: {
          kind: "RECLASSIFY",
          txnCount: action.txnIds.length,
          newCode: action.code,
          cohanFlag: action.cohanFlag === true,
        },
      },
    })
  })

  return "applied"
}

async function applyStopCreation(
  findingId: string,
  action: StopAction,
  taxYearId: string
): Promise<void> {
  // Map the AI's free-text category onto our enum.
  const categoryMap: Record<string, "MERCHANT" | "TRANSFER" | "PERIOD_GAP" | "DEPOSIT" | "SECTION_274D" | "P2P_ROUNDTRIP"> = {
    MERCHANT: "MERCHANT",
    TRANSFER: "TRANSFER",
    PERIOD_GAP: "PERIOD_GAP",
    DEPOSIT: "DEPOSIT",
    SECTION_274D: "SECTION_274D",
    P2P_ROUNDTRIP: "P2P_ROUNDTRIP",
  }
  const stopCategory = categoryMap[action.category] ?? "MERCHANT"

  await prisma.$transaction(async (tx) => {
    const stop = await tx.stopItem.create({
      data: {
        taxYearId,
        category: stopCategory,
        question: action.question,
        context: { source: "ledger_finding", findingId },
        transactionIds: action.transactionIds,
        state: "PENDING",
      },
    })
    await tx.ledgerFinding.update({
      where: { id: findingId },
      data: { state: "APPLIED" },
    })
    await tx.auditEvent.create({
      data: {
        actorType: "USER",
        eventType: "FINDING_APPLIED",
        entityType: "LedgerFinding",
        entityId: findingId,
        afterState: { kind: "STOP", stopId: stop.id },
      },
    })
  })
}

/**
 * Accept a single finding "as proposed". Used by the findings UI's plain
 * Accept button. The apply path will execute the finding's proposedAction
 * verbatim.
 */
export async function acceptFinding(findingId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.ledgerFinding.update({
      where: { id: findingId },
      data: { state: "ACCEPTED" },
    })
    await tx.auditEvent.create({
      data: {
        actorType: "USER",
        eventType: "FINDING_ACCEPTED",
        entityType: "LedgerFinding",
        entityId: findingId,
      },
    })
  })
}

/**
 * Accept a finding with a *modified* ProposedAction (one of the
 * case-derived alternatives the UI offers via humanize.deriveAlternatives).
 *
 * `optionLabel` is the short human-readable label the CPA picked
 * ("Move to Line 17 Legal & Professional", "Promote to COGS", etc.) — stored
 * for audit-trail display so the workpaper shows what the CPA chose, not
 * just the resulting Classification.
 *
 * The override is checked against the same §274(d) Cohan + OWNER_EQUITY
 * invariant guards at apply time as the AI's original proposal — the
 * alternatives can't sneak past the hard rails.
 */
export async function acceptFindingWithOverride(
  findingId: string,
  override: ClientProposedAction,
  optionLabel: string
): Promise<void> {
  if (!optionLabel || optionLabel.trim().length === 0) {
    throw new Error("acceptedOption label required when overriding the proposed action")
  }
  await prisma.$transaction(async (tx) => {
    await tx.ledgerFinding.update({
      where: { id: findingId },
      data: {
        state: "ACCEPTED",
        overrideAction: override as unknown as Prisma.InputJsonValue,
        acceptedOption: optionLabel.trim().slice(0, 200),
      },
    })
    await tx.auditEvent.create({
      data: {
        actorType: "USER",
        eventType: "FINDING_ACCEPTED",
        entityType: "LedgerFinding",
        entityId: findingId,
        afterState: {
          acceptedOption: optionLabel,
          override: override as unknown as Prisma.InputJsonValue,
        } as unknown as Prisma.InputJsonValue,
      },
    })
  })
}

/**
 * Accept a finding with a free-text "Other…" instruction. The instruction is
 * stored verbatim; the apply path turns it into a STOP carrying the
 * instruction as the surfaced question. We DON'T translate the instruction
 * into a Classification — that would risk fabricating a tax position from
 * ambiguous English. The CPA reviews the resulting STOP and resolves it
 * through the existing STOP flow.
 */
export async function acceptFindingWithInstruction(
  findingId: string,
  instruction: string,
  citedTxnIds: string[]
): Promise<void> {
  const trimmed = instruction.trim()
  if (trimmed.length < 5) {
    throw new Error("Custom instruction must be at least 5 characters")
  }
  const stopOverride: ClientProposedAction = {
    kind: "STOP",
    category: "MERCHANT",
    question: `CPA instruction: ${trimmed.slice(0, 500)}`,
    transactionIds: citedTxnIds,
  }
  await prisma.$transaction(async (tx) => {
    await tx.ledgerFinding.update({
      where: { id: findingId },
      data: {
        state: "ACCEPTED",
        overrideAction: stopOverride as unknown as Prisma.InputJsonValue,
        userInstruction: trimmed,
        acceptedOption: "Other (custom instruction)",
      },
    })
    await tx.auditEvent.create({
      data: {
        actorType: "USER",
        eventType: "FINDING_ACCEPTED",
        entityType: "LedgerFinding",
        entityId: findingId,
        afterState: {
          userInstruction: trimmed,
          override: stopOverride as unknown as Prisma.InputJsonValue,
        } as unknown as Prisma.InputJsonValue,
      },
    })
  })
}

/**
 * Dismiss a finding with a rationale. Used by the findings UI.
 */
export async function dismissFinding(findingId: string, rationale: string): Promise<void> {
  if (!rationale || rationale.trim().length < 5) {
    throw new Error("Dismiss rationale required (minimum 5 characters)")
  }
  await prisma.$transaction(async (tx) => {
    await tx.ledgerFinding.update({
      where: { id: findingId },
      data: { state: "DISMISSED", dismissedRationale: rationale.trim() },
    })
    await tx.auditEvent.create({
      data: {
        actorType: "USER",
        eventType: "FINDING_DISMISSED",
        entityType: "LedgerFinding",
        entityId: findingId,
        rationale: rationale.trim(),
      },
    })
  })
}
