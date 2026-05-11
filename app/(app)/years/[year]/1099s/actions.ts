"use server"

/**
 * Phase E — 1099-NEC issuance server actions.
 *
 *   approveCandidate         — promote a candidate to Form1099Filing row
 *   recordW9                 — capture W-9 details (TIN, address, classification)
 *   markW9Requested          — flag a payee as W-9-request-sent (no TIN yet)
 *   deleteFiling             — remove a Form1099Filing (audit-logged)
 */

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { Prisma } from "@/app/generated/prisma/client"

async function resolveTaxYear(year: number) {
  const userId = await getCurrentUserId()
  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    select: { id: true, status: true, userId: true },
  })
  if (!taxYear) throw new Error("Tax year not found")
  return { taxYear, userId }
}

const ApproveCandidateSchema = z.object({
  year: z.number().int(),
  payeeName: z.string().min(1),
  totalDollars: z.number().min(0),
  txIds: z.array(z.string()).default([]),
})

export async function approveCandidate(
  input: z.infer<typeof ApproveCandidateSchema>,
): Promise<{ ok: true; filingId: string } | { ok: false; error: string }> {
  const parsed = ApproveCandidateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  const { year, payeeName, totalDollars, txIds } = parsed.data
  const { taxYear, userId } = await resolveTaxYear(year)
  if (taxYear.status === "LOCKED") return { ok: false, error: "Tax year is locked" }

  let filingId: string
  await prisma.$transaction(async (tx) => {
    const w9 = await tx.w9Submission.findUnique({
      where: { taxYearId_payeeName: { taxYearId: taxYear.id, payeeName } },
    })
    const filing = await tx.form1099Filing.upsert({
      where: { taxYearId_recipientName: { taxYearId: taxYear.id, recipientName: payeeName } },
      create: {
        taxYearId: taxYear.id,
        recipientName: payeeName,
        recipientTin: w9?.tin ?? null,
        recipientAddress: w9
          ? ({
              line1: w9.addressLine1 ?? "",
              line2: w9.addressLine2 ?? "",
              city: w9.city ?? "",
              state: w9.stateRegion ?? "",
              postal: w9.postalCode ?? "",
            } as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        box1NonemployeeComp: new Prisma.Decimal(totalDollars),
        sourceTransactionIds: txIds,
      },
      update: {
        box1NonemployeeComp: new Prisma.Decimal(totalDollars),
        sourceTransactionIds: txIds,
        recipientTin: w9?.tin ?? null,
      },
    })
    filingId = filing.id
    await tx.auditEvent.create({
      data: {
        userId: taxYear.userId,
        actorType: "USER",
        eventType: "FORM_1099_NEC_APPROVED",
        entityType: "Form1099Filing",
        entityId: filingId,
        afterState: { payeeName, totalDollars, txCount: txIds.length },
      },
    })
  })
  revalidatePath(`/years/${year}/1099s`)
  return { ok: true, filingId: filingId! }
  void userId
}

const RecordW9Schema = z.object({
  year: z.number().int(),
  payeeName: z.string().min(1),
  payeeEmail: z.string().email().optional().nullable(),
  businessName: z.string().optional().nullable(),
  taxClassification: z.string().optional().nullable(),
  tin: z
    .string()
    .regex(/^(\d{3}-?\d{2}-?\d{4}|\d{2}-?\d{7})$/, "TIN must be SSN (XXX-XX-XXXX) or EIN (XX-XXXXXXX) format")
    .optional()
    .nullable(),
  isEntityCorporation: z.boolean().default(false),
  isExempt: z.boolean().default(false),
  exemptCode: z.string().optional().nullable(),
  addressLine1: z.string().optional().nullable(),
  addressLine2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  stateRegion: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

export async function recordW9(
  input: z.infer<typeof RecordW9Schema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = RecordW9Schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  const data = parsed.data
  const { taxYear } = await resolveTaxYear(data.year)
  if (taxYear.status === "LOCKED") return { ok: false, error: "Tax year is locked" }

  await prisma.$transaction(async (tx) => {
    await tx.w9Submission.upsert({
      where: { taxYearId_payeeName: { taxYearId: taxYear.id, payeeName: data.payeeName } },
      create: {
        taxYearId: taxYear.id,
        payeeName: data.payeeName,
        payeeEmail: data.payeeEmail ?? null,
        businessName: data.businessName ?? null,
        taxClassification: data.taxClassification ?? null,
        tin: data.tin ?? null,
        isEntityCorporation: data.isEntityCorporation,
        isExempt: data.isExempt,
        exemptCode: data.exemptCode ?? null,
        addressLine1: data.addressLine1 ?? null,
        addressLine2: data.addressLine2 ?? null,
        city: data.city ?? null,
        stateRegion: data.stateRegion ?? null,
        postalCode: data.postalCode ?? null,
        notes: data.notes ?? null,
        status: data.tin ? "RECEIVED" : "REQUESTED",
        receivedAt: data.tin ? new Date() : undefined,
      },
      update: {
        payeeEmail: data.payeeEmail ?? null,
        businessName: data.businessName ?? null,
        taxClassification: data.taxClassification ?? null,
        tin: data.tin ?? null,
        isEntityCorporation: data.isEntityCorporation,
        isExempt: data.isExempt,
        exemptCode: data.exemptCode ?? null,
        addressLine1: data.addressLine1 ?? null,
        addressLine2: data.addressLine2 ?? null,
        city: data.city ?? null,
        stateRegion: data.stateRegion ?? null,
        postalCode: data.postalCode ?? null,
        notes: data.notes ?? null,
        status: data.tin ? "RECEIVED" : "REQUESTED",
        receivedAt: data.tin ? new Date() : undefined,
      },
    })
    // Cascade: any existing Form1099Filing should pick up the new TIN
    await tx.form1099Filing.updateMany({
      where: { taxYearId: taxYear.id, recipientName: data.payeeName },
      data: {
        recipientTin: data.tin ?? null,
        recipientAddress: {
          line1: data.addressLine1 ?? "",
          line2: data.addressLine2 ?? "",
          city: data.city ?? "",
          state: data.stateRegion ?? "",
          postal: data.postalCode ?? "",
        } as Prisma.InputJsonValue,
      },
    })
    await tx.auditEvent.create({
      data: {
        userId: taxYear.userId,
        actorType: "USER",
        eventType: "W9_RECORDED",
        entityType: "W9Submission",
        entityId: data.payeeName,
        afterState: { hasTin: !!data.tin, taxClassification: data.taxClassification },
      },
    })
  })
  revalidatePath(`/years/${data.year}/1099s`)
  return { ok: true }
}

export async function markW9Requested(
  year: number,
  payeeName: string,
  payeeEmail?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { taxYear } = await resolveTaxYear(year)
  if (taxYear.status === "LOCKED") return { ok: false, error: "Tax year is locked" }
  await prisma.w9Submission.upsert({
    where: { taxYearId_payeeName: { taxYearId: taxYear.id, payeeName } },
    create: {
      taxYearId: taxYear.id,
      payeeName,
      payeeEmail: payeeEmail ?? null,
      status: "REQUESTED",
      requestedAt: new Date(),
    },
    update: {
      payeeEmail: payeeEmail ?? null,
      status: "REQUESTED",
      requestedAt: new Date(),
    },
  })
  revalidatePath(`/years/${year}/1099s`)
  return { ok: true }
}

export async function deleteFiling(
  year: number,
  filingId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { taxYear } = await resolveTaxYear(year)
  if (taxYear.status === "LOCKED") return { ok: false, error: "Tax year is locked" }
  await prisma.$transaction(async (tx) => {
    const f = await tx.form1099Filing.findUnique({ where: { id: filingId } })
    if (!f || f.taxYearId !== taxYear.id) throw new Error("Filing not found")
    await tx.form1099Filing.delete({ where: { id: filingId } })
    await tx.auditEvent.create({
      data: {
        userId: taxYear.userId,
        actorType: "USER",
        eventType: "FORM_1099_NEC_DELETED",
        entityType: "Form1099Filing",
        entityId: filingId,
        beforeState: {
          recipientName: f.recipientName,
          amount: f.box1NonemployeeComp?.toString() ?? "0",
        },
      },
    })
  })
  revalidatePath(`/years/${year}/1099s`)
  return { ok: true }
}
