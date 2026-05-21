"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import {
  acceptFinding as acceptFindingImpl,
  acceptFindingWithOverride as acceptFindingWithOverrideImpl,
  acceptFindingWithInstruction as acceptFindingWithInstructionImpl,
  dismissFinding as dismissFindingImpl,
  applyAcceptedFindings,
} from "@/lib/findings/apply"
import type { ProposedAction } from "@/lib/findings/humanize"

async function assertOwnsTaxYear(year: number) {
  const userId = await getCurrentUserId()
  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    select: { id: true },
  })
  if (!taxYear) throw new Error("TaxYear not found")
  return { userId, taxYearId: taxYear.id }
}

export async function acceptFindingAction(year: number, findingId: string) {
  await assertOwnsTaxYear(year)
  await acceptFindingImpl(findingId)
  revalidatePath(`/years/${year}/findings`)
}

/**
 * Accept a finding with one of the case-derived alternatives.
 * `override` is a serialized ProposedAction; `optionLabel` is the short
 * human label the UI displayed.
 */
export async function acceptFindingWithOverrideAction(
  year: number,
  findingId: string,
  override: ProposedAction,
  optionLabel: string
) {
  await assertOwnsTaxYear(year)
  await acceptFindingWithOverrideImpl(findingId, override, optionLabel)
  revalidatePath(`/years/${year}/findings`)
}

/**
 * Accept a finding with a free-text instruction from the "Other…" dialog.
 * The instruction is stored verbatim; apply turns it into a STOP carrying
 * the instruction as the question (no AI fabrication).
 */
export async function acceptFindingWithInstructionAction(
  year: number,
  findingId: string,
  instruction: string,
  citedTxnIds: string[]
) {
  await assertOwnsTaxYear(year)
  await acceptFindingWithInstructionImpl(findingId, instruction, citedTxnIds)
  revalidatePath(`/years/${year}/findings`)
}

export async function dismissFindingAction(year: number, findingId: string, rationale: string) {
  await assertOwnsTaxYear(year)
  await dismissFindingImpl(findingId, rationale)
  revalidatePath(`/years/${year}/findings`)
}

export async function acceptAllAutoFixableAction(year: number) {
  const { taxYearId } = await assertOwnsTaxYear(year)
  const auto = await prisma.ledgerFinding.findMany({
    where: { taxYearId, state: "PROPOSED", autoFixable: true },
    select: { id: true },
  })
  for (const f of auto) {
    await acceptFindingImpl(f.id)
  }
  revalidatePath(`/years/${year}/findings`)
  return { accepted: auto.length }
}

export async function applyFindingsAction(year: number) {
  const { taxYearId } = await assertOwnsTaxYear(year)
  const result = await applyAcceptedFindings(taxYearId)
  revalidatePath(`/years/${year}/findings`)
  revalidatePath(`/years/${year}/ledger`)
  revalidatePath(`/years/${year}/risk`)
  return result
}
