"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import {
  acceptFinding as acceptFindingImpl,
  dismissFinding as dismissFindingImpl,
  applyAcceptedFindings,
} from "@/lib/findings/apply"

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
