import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { reclassifyByInstruction, type NLCandidate } from "@/lib/ai/reclassifyNL"

const BodySchema = z.object({
  year: z.number().int(),
  instruction: z.string().min(3).max(1000),
  candidateIds: z.array(z.string()).max(500),
})

export async function POST(req: Request) {
  const session = await requireAuth()
  const userId = session.user!.id!

  const body = BodySchema.parse(await req.json())

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year: body.year } },
  })
  if (!taxYear) return NextResponse.json({ error: "Tax year not found" }, { status: 404 })

  const txns = await prisma.transaction.findMany({
    where: {
      id: { in: body.candidateIds },
      taxYearId: taxYear.id,
    },
    include: { classifications: { where: { isCurrent: true }, take: 1 } },
  })

  const profile = await prisma.businessProfile.findUnique({
    where: { taxYearId: taxYear.id },
    include: { trips: true, knownEntities: true },
  })

  const candidates: NLCandidate[] = txns.map((t) => ({
    id: t.id,
    date: t.postedDate.toISOString().slice(0, 10),
    merchantNormalized: t.merchantNormalized,
    merchantRaw: t.merchantRaw,
    amount: Number(t.amountNormalized.toString()),
    currentCode: t.classifications[0]?.code ?? "NEEDS_CONTEXT",
    currentPct: t.classifications[0]?.businessPct ?? 0,
  }))

  const result = await reclassifyByInstruction(
    body.instruction,
    candidates,
    {
      naics: profile?.naicsCode ?? null,
      businessDescription: profile?.businessDescription ?? null,
      trips: (profile?.trips ?? []).map((t) => ({
        name: t.name,
        start: t.startDate.toISOString().slice(0, 10),
        end: t.endDate.toISOString().slice(0, 10),
      })),
      entities: (profile?.knownEntities ?? []).map((e) => ({
        displayName: e.displayName,
        keywords: e.matchKeywords,
      })),
    }
  )

  // Filter to transactions that belong to this user
  const allowedIds = new Set(txns.map((t) => t.id))
  result.matches = result.matches.filter((m) => allowedIds.has(m.transactionId))

  await prisma.auditEvent.create({
    data: {
      userId,
      actorType: "AI",
      eventType: "NL_OVERRIDE_PREVIEW",
      entityType: "Transaction",
      beforeState: { instruction: body.instruction, candidateCount: candidates.length },
      afterState: { matchCount: result.matches.length, ruleUpdateCount: result.rule_updates.length },
    },
  })

  return NextResponse.json(result)
}
