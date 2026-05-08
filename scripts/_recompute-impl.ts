// Tsx-only impl invoked by recompute-tax-year-statuses.mjs. Lives separately
// so we can keep the env-gate in the .mjs file (faster startup; doesn't pull
// in the prisma client unless we actually plan to run).

import "dotenv/config"
import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { deriveStage } from "../lib/taxYear/status"

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const targetEmail = process.env["RECOMPUTE_USER_EMAIL"]
  const where = targetEmail ? { user: { email: targetEmail } } : {}

  const years = await prisma.taxYear.findMany({
    where,
    select: { id: true, year: true, status: true, lockedAt: true, user: { select: { email: true } } },
    orderBy: [{ user: { email: "asc" } }, { year: "asc" }],
  })

  if (years.length === 0) {
    console.log(`[recompute-status] no TaxYears matched (filter: ${targetEmail ?? "none"})`)
    return
  }

  console.log(`[recompute-status] processing ${years.length} TaxYear${years.length === 1 ? "" : "s"}…`)

  let changed = 0
  let unchanged = 0
  for (const y of years) {
    if (y.status === "ARCHIVED") {
      unchanged++
      continue
    }
    const [totalTx, classifiedTx, pendingStops] = await Promise.all([
      prisma.transaction.count({ where: { taxYearId: y.id, isDuplicateOf: null } }),
      prisma.classification.count({
        where: { transaction: { taxYearId: y.id, isDuplicateOf: null }, isCurrent: true },
      }),
      prisma.stopItem.count({ where: { taxYearId: y.id, state: "PENDING" } }),
    ])

    const next = deriveStage(
      { status: y.status, lockedAt: y.lockedAt },
      { totalTx, classifiedTx, pendingStops },
    )

    const tag = `${y.user.email} / ${y.year}`
    if (next === y.status) {
      console.log(`  [unchanged] ${tag} · ${y.status} · ${classifiedTx}/${totalTx} cls · ${pendingStops} stops`)
      unchanged++
      continue
    }

    await prisma.taxYear.update({ where: { id: y.id }, data: { status: next } })
    console.log(`  [updated]  ${tag} · ${y.status} → ${next} · ${classifiedTx}/${totalTx} cls · ${pendingStops} stops`)
    changed++
  }

  console.log(`[recompute-status] done — ${changed} changed, ${unchanged} unchanged`)
}

main()
  .catch((err) => {
    console.error("[recompute-status] failed:", err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
