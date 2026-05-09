// One-shot: run deriveStopsFromAssertions over a TaxYear so DEPOSIT-category
// STOPs materialize for every unclassified / NEEDS_CONTEXT inflow. Useful
// after fix-inflow-misclassifications.mjs has demoted prior bad WRITE_OFFs
// — the user/CPA needs the new STOPs to triage what each inflow actually
// is.
//
// Usage:
//   DATABASE_URL=<prod-public-url> DERIVE_USER_EMAIL=atif.ameer@example.com \
//   DERIVE_YEAR=2025 npx tsx scripts/derive-stops-now.ts
import "dotenv/config"
import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { deriveStopsFromAssertions } from "../lib/stops/deriveFromAssertions"

async function main() {
  const email = process.env["DERIVE_USER_EMAIL"]
  const yearStr = process.env["DERIVE_YEAR"] ?? "2025"
  if (!email) {
    console.error("[derive-stops-now] DERIVE_USER_EMAIL is required")
    process.exit(1)
  }
  const year = parseInt(yearStr, 10)
  if (!Number.isFinite(year)) {
    console.error(`[derive-stops-now] invalid DERIVE_YEAR="${yearStr}"`)
    process.exit(1)
  }
  const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! })
  const prisma = new PrismaClient({ adapter })
  try {
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      console.error(`[derive-stops-now] no user with email ${email}`)
      process.exit(1)
    }
    const ty = await prisma.taxYear.findUnique({
      where: { userId_year: { userId: user.id, year } },
    })
    if (!ty) {
      console.error(`[derive-stops-now] no TaxYear ${year} for user`)
      process.exit(1)
    }
    console.log(`[derive-stops-now] deriving stops for ${email} TY ${year} (${ty.id})…`)
    const r = await deriveStopsFromAssertions(ty.id)
    console.log(`[derive-stops-now] done: ${r.depositStops} deposit stops, ${r.section274dStops} §274(d) stops`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
