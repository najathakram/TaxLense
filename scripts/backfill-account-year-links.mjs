/**
 * Backfill: create one AccountYearLink row per existing FinancialAccount
 * (using its taxYearId). Idempotent — re-running is safe.
 *
 * Phase 1 of the B-21 multi-year refactor. Future PRs will:
 *   - migrate read paths (Coverage, Upload, Ledger, Pipeline) to query
 *     through AccountYearLink instead of FinancialAccount.taxYearId
 *   - collapse duplicate (userId, institution, mask) FinancialAccount rows
 *   - drop FinancialAccount.taxYearId once all readers move
 *
 * Activation: env-gated. Set RUN_ACCOUNT_LINK_BACKFILL=true and run
 *   pnpm post-deploy
 * (or call this script directly from the Railway shell).
 */

import { PrismaClient } from "../app/generated/prisma/client.js"
import { PrismaPg } from "@prisma/adapter-pg"
import "dotenv/config"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  if (process.env.RUN_ACCOUNT_LINK_BACKFILL !== "true") {
    console.log("[account-link-backfill] RUN_ACCOUNT_LINK_BACKFILL != 'true' — skipping (no-op).")
    return
  }
  console.log("[account-link-backfill] starting")

  const accounts = await prisma.financialAccount.findMany({
    select: { id: true, taxYearId: true, nickname: true },
  })
  console.log(`[account-link-backfill] found ${accounts.length} FinancialAccount row(s)`)

  let created = 0
  let skipped = 0

  for (const acct of accounts) {
    // upsert keeps the script idempotent — re-runs don't duplicate.
    const result = await prisma.accountYearLink.upsert({
      where: {
        accountId_taxYearId: {
          accountId: acct.id,
          taxYearId: acct.taxYearId,
        },
      },
      create: {
        accountId: acct.id,
        taxYearId: acct.taxYearId,
        nickname: acct.nickname,
      },
      update: {},
    })
    if (result) {
      // Prisma upsert doesn't tell us whether it created or updated; count by
      // comparing createdAt to "now" (within 5s).
      const justCreated = Date.now() - new Date(result.createdAt).getTime() < 5_000
      if (justCreated) created++
      else skipped++
    }
  }

  console.log(`[account-link-backfill] done — created=${created}, skipped=${skipped}`)
}

main()
  .catch((err) => {
    console.error("[account-link-backfill] failed:", err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
