"use server"

import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { normalizeMerchantsForYear, applyMerchantRules } from "@/lib/classification/apply"
import { matchTransfers } from "@/lib/pairing/transfers"
import { matchCardPayments } from "@/lib/pairing/payments"
import { matchRefunds } from "@/lib/pairing/refunds"
import { runMerchantIntelligence } from "@/lib/ai/merchantIntelligence"
import { revalidatePath } from "next/cache"

async function getTaxYear(userId: string, year: number) {
  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
  })
  if (!taxYear) throw new Error(`No tax year ${year}`)
  return taxYear
}

export async function runNormalizeMerchants(year: number) {
  const userId = await getCurrentUserId()
  const taxYear = await getTaxYear(userId, year)
  const updated = await normalizeMerchantsForYear(taxYear.id)
  revalidatePath(`/years/${year}/pipeline`)
  return { updated }
}

export async function runMatchTransfers(year: number) {
  const userId = await getCurrentUserId()
  const taxYear = await getTaxYear(userId, year)
  const result = await matchTransfers(taxYear.id)
  revalidatePath(`/years/${year}/pipeline`)
  return result
}

export async function runMatchPayments(year: number) {
  const userId = await getCurrentUserId()
  const taxYear = await getTaxYear(userId, year)
  const result = await matchCardPayments(taxYear.id)
  revalidatePath(`/years/${year}/pipeline`)
  return result
}

export async function runMatchRefunds(year: number) {
  const userId = await getCurrentUserId()
  const taxYear = await getTaxYear(userId, year)
  const result = await matchRefunds(taxYear.id)
  revalidatePath(`/years/${year}/pipeline`)
  return result
}

export async function runMerchantAI(year: number) {
  const userId = await getCurrentUserId()
  const taxYear = await getTaxYear(userId, year)
  const result = await runMerchantIntelligence(taxYear.id)
  revalidatePath(`/years/${year}/pipeline`)
  return result
}

export async function runApplyRules(year: number) {
  const userId = await getCurrentUserId()
  const taxYear = await getTaxYear(userId, year)
  const result = await applyMerchantRules(taxYear.id)
  revalidatePath(`/years/${year}/pipeline`)
  return result
}
