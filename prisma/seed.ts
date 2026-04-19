/**
 * TaxLens — Prisma seed script
 *
 * Fixture: Najath's profile — wedding photography / travel content / e-commerce.
 * This matches the Maznah Media 2025 acceptance-test archetype from spec §14.
 *
 * Run:  pnpm seed
 */

import "dotenv/config"
import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import bcrypt from "bcryptjs"
import crypto from "crypto"

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! })
const prisma = new PrismaClient({ adapter })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function txKey(accountId: string, date: string, amount: string, merchant: string) {
  return crypto
    .createHash("sha256")
    .update(`${accountId}|${date}|${amount}|${merchant}`)
    .digest("hex")
    .slice(0, 32)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("🌱  Seeding TaxLens database…")

  // ------------------------------------------------------------------
  // 1. Rule versions
  //    rv_2024 = pre-OBBBA (§168(k) 60% bonus 2024)
  //    rv_2025 = post-OBBBA (§168(k) 100% bonus restored Jan 20 2025)
  // ------------------------------------------------------------------
  const rv2024 = await prisma.ruleVersion.upsert({
    where: { id: "rv_2024_001" },
    create: {
      id: "rv_2024_001",
      effectiveDate: new Date("2024-01-01"),
      ruleSet: {
        version: "1.0-pre-obbba",
        notes: "§168(k) 60% bonus depreciation; §179 $1.22M limit",
        rules: [],
      },
      summary: "Pre-OBBBA rule set — 60% bonus depreciation",
    },
    update: {},
  })

  const rv2025 = await prisma.ruleVersion.upsert({
    where: { id: "rv_2025_001" },
    create: {
      id: "rv_2025_001",
      effectiveDate: new Date("2025-01-20"),
      ruleSet: {
        version: "2.0-post-obbba",
        notes: "OBBBA signed Jan 20 2025: §168(k) 100% bonus restored for post-Jan-19-2025 acquisitions; §179 $1.25M limit",
        rules: [],
      },
      summary: "Post-OBBBA rule set — 100% bonus depreciation restored",
      supersededById: null,
    },
    update: {},
  })

  // rv2024 superseded by rv2025
  await prisma.ruleVersion.update({
    where: { id: "rv_2024_001" },
    data: { supersededById: rv2025.id },
  })
  console.log("  ✓ RuleVersions: 2 (pre-OBBBA + post-OBBBA)")

  // ------------------------------------------------------------------
  // 2. User — canonical fixture account
  // ------------------------------------------------------------------
  const password = await bcrypt.hash("test123", 12)

  const user = await prisma.user.upsert({
    where: { email: "test@taxlens.local" },
    create: {
      id: "user_fixture_001",
      name: "Najath Akram",
      email: "test@taxlens.local",
      password,
    },
    update: { name: "Najath Akram" },
  })
  console.log(`  ✓ User: ${user.email}  (password: test123)`)

  // ------------------------------------------------------------------
  // 3. Tax Year 2025
  // ------------------------------------------------------------------
  const taxYear = await prisma.taxYear.upsert({
    where: { userId_year: { userId: user.id, year: 2025 } },
    create: {
      id: "ty_2025_fixture",
      userId: user.id,
      year: 2025,
      status: "CREATED",
      ruleVersionId: rv2025.id,
    },
    update: { ruleVersionId: rv2025.id },
  })
  console.log(`  ✓ TaxYear: ${taxYear.year}  (status: ${taxYear.status})`)

  // ------------------------------------------------------------------
  // 4. Business Profile
  //    NAICS 711510 = Independent Artists, Writers, and Performers
  //    Matches Maznah Media archetype: wedding photography + travel content + e-commerce
  // ------------------------------------------------------------------
  const profile = await prisma.businessProfile.upsert({
    where: { taxYearId: taxYear.id },
    create: {
      id: "bp_2025_fixture",
      userId: user.id,
      taxYearId: taxYear.id,
      naicsCode: "711510",
      entityType: "SOLE_PROP",
      primaryState: "TX",
      businessDescription:
        "Wedding photography, travel content creation, and e-commerce",
      grossReceiptsEstimate: 281800,
      accountingMethod: "CASH",
      homeOfficeConfig: {
        has: true,
        dedicated: true,
        officeSqft: 200,
        homeSqft: 2000,
      },
      vehicleConfig: {
        has: true,
        bizPct: 60,
      },
      inventoryConfig: {
        has: true,
        physical: true,
        dropship: false,
      },
      revenueStreams: [
        "wedding_photography",
        "travel_content",
        "brand_deals",
        "affiliate",
        "digital_products",
        "ecommerce",
      ],
      firstYear: false,
    },
    update: {},
  })
  console.log(`  ✓ BusinessProfile: NAICS ${profile.naicsCode} — ${profile.businessDescription}`)

  // ------------------------------------------------------------------
  // 5. Known Entities (3)
  //    These drive auto-classification:
  //    - Spouse: personal transfers → PERSONAL
  //    - Business partner (Zelle): partner payments → PERSONAL (not deductible draws)
  //    - HSMCA: donations → PERSONAL (non-deductible for Sch C)
  // ------------------------------------------------------------------
  await prisma.knownEntity.deleteMany({ where: { profileId: profile.id } })
  await prisma.knownEntity.createMany({
    data: [
      {
        id: "ke_spouse_001",
        profileId: profile.id,
        kind: "PERSON_PERSONAL",
        displayName: "Spouse",
        matchKeywords: ["RANDI", "ZELLE RANDI", "VENMO RANDI"],
        defaultCode: "PERSONAL",
        notes: "Personal transfers to spouse — not deductible",
      },
      {
        id: "ke_partner_001",
        profileId: profile.id,
        kind: "PERSON_PERSONAL",
        displayName: "Business Partner",
        matchKeywords: ["ZELLE ALI", "VENMO ALI", "PARTNER DRAW"],
        defaultCode: "PERSONAL",
        notes: "Zelle payments to business partner — personal draws",
      },
      {
        id: "ke_hsmca_001",
        profileId: profile.id,
        kind: "PATTERN_EXCLUDED",
        displayName: "HSMCA Donations",
        matchKeywords: ["HSMCA", "HS MCA", "MUSLIM CHARITY"],
        defaultCode: "PERSONAL",
        notes: "Charitable donations — not deductible on Schedule C",
      },
    ],
  })
  console.log("  ✓ KnownEntities: 3")

  // ------------------------------------------------------------------
  // 6. Trips (3)
  //    Spec fixture trips from §14 Session 8 acceptance criteria
  // ------------------------------------------------------------------
  await prisma.trip.deleteMany({ where: { profileId: profile.id } })
  await prisma.trip.createMany({
    data: [
      {
        id: "trip_alaska_2025",
        profileId: profile.id,
        name: "Alaska Content Trip",
        destination: "Denali / Anchorage, AK",
        startDate: new Date("2025-08-02"),
        endDate: new Date("2025-08-13"),
        purpose: "Travel content creation — glaciers, wildlife, landscape photography",
        deliverableDescription:
          "Instagram Reels series + blog post + 3 brand deal deliverables (REI, Peak Design, Visit Alaska)",
        isConfirmed: true,
      },
      {
        id: "trip_srilanka_2025",
        profileId: profile.id,
        name: "Sri Lanka Content Trip",
        destination: "Colombo / Galle / Ella, Sri Lanka",
        startDate: new Date("2025-09-15"),
        endDate: new Date("2025-11-03"),
        purpose: "Extended travel content creation — cultural photography and brand collaboration",
        deliverableDescription:
          "YouTube series (6 episodes) + brand deals (Airbnb, Capture One, local tourism board)",
        isConfirmed: true,
      },
      {
        id: "trip_colorado_2025",
        profileId: profile.id,
        name: "Colorado Winter Shoot",
        destination: "Telluride / Aspen, CO",
        startDate: new Date("2025-12-04"),
        endDate: new Date("2025-12-12"),
        purpose: "Winter wedding photography + ski resort content partnership",
        deliverableDescription:
          "Wedding album delivery + Instagram content for Telluride Ski Resort",
        isConfirmed: false,
      },
    ],
  })
  console.log("  ✓ Trips: 3 (Alaska Aug, Sri Lanka Sep–Nov, Colorado Dec)")

  // ------------------------------------------------------------------
  // 7. Financial Accounts (5)
  //    Matching spec §14 Session 1 fixture list
  // ------------------------------------------------------------------
  await prisma.financialAccount.deleteMany({ where: { taxYearId: taxYear.id } })

  const accounts = await Promise.all([
    prisma.financialAccount.create({
      data: {
        id: "acct_chase_freedom",
        userId: user.id,
        taxYearId: taxYear.id,
        type: "CREDIT_CARD",
        institution: "Chase",
        mask: "4242",
        nickname: "Chase Freedom Unlimited",
        isPrimaryBusiness: true,
      },
    }),
    prisma.financialAccount.create({
      data: {
        id: "acct_amex_platinum",
        userId: user.id,
        taxYearId: taxYear.id,
        type: "CREDIT_CARD",
        institution: "American Express",
        mask: "1001",
        nickname: "Amex Platinum",
        isPrimaryBusiness: true,
      },
    }),
    prisma.financialAccount.create({
      data: {
        id: "acct_costco_citi",
        userId: user.id,
        taxYearId: taxYear.id,
        type: "CREDIT_CARD",
        institution: "Citi / Costco",
        mask: "5555",
        nickname: "Costco Anywhere Visa",
        isPrimaryBusiness: false,
      },
    }),
    prisma.financialAccount.create({
      data: {
        id: "acct_chase_checking",
        userId: user.id,
        taxYearId: taxYear.id,
        type: "CHECKING",
        institution: "Chase",
        mask: "9517",
        nickname: "Chase Checking 9517",
        isPrimaryBusiness: true,
      },
    }),
    prisma.financialAccount.create({
      data: {
        id: "acct_robinhood",
        userId: user.id,
        taxYearId: taxYear.id,
        type: "BROKERAGE",
        institution: "Robinhood",
        mask: null,
        nickname: "Robinhood Brokerage",
        isPrimaryBusiness: false,
      },
    }),
  ])
  console.log("  ✓ FinancialAccounts: 5")

  const [chaseFreedom, amex, costcoCiti, chaseChecking, robinhood] = accounts

  // ------------------------------------------------------------------
  // 8. Transactions (20) — realistic for a photographer/creator in 2025
  // ------------------------------------------------------------------
  await prisma.transaction.deleteMany({ where: { taxYearId: taxYear.id } })

  const txData = [
    // ── INCOME ──────────────────────────────────────────────────────
    {
      id: "tx_001",
      accountId: chaseChecking.id,
      date: "2025-01-20",
      amount: "-8500.00",   // credit = income
      merchant: "THEKNOT WEDDING WIRE",
      desc: "Wedding booking deposit — Jan couple",
    },
    {
      id: "tx_002",
      accountId: chaseChecking.id,
      date: "2025-03-15",
      amount: "-12000.00",
      merchant: "THEKNOT WEDDING WIRE",
      desc: "Wedding final payment — March couple",
    },
    {
      id: "tx_003",
      accountId: chaseChecking.id,
      date: "2025-04-01",
      amount: "-3200.00",
      merchant: "BRAND DEAL DIRECT DEPOSIT",
      desc: "REI brand deal — spring campaign",
    },

    // ── BUSINESS EXPENSES — SOFTWARE / SUBSCRIPTIONS ─────────────
    {
      id: "tx_004",
      accountId: amex.id,
      date: "2025-01-05",
      amount: "55.00",
      merchant: "ADOBE SYSTEMS",
      desc: "Adobe Creative Cloud — monthly",
    },
    {
      id: "tx_005",
      accountId: amex.id,
      date: "2025-01-08",
      amount: "299.00",
      merchant: "CAPTURE ONE",
      desc: "Capture One Pro annual license",
    },
    {
      id: "tx_006",
      accountId: amex.id,
      date: "2025-02-01",
      amount: "16.00",
      merchant: "NOTION",
      desc: "Notion Pro subscription",
    },

    // ── EQUIPMENT ────────────────────────────────────────────────
    {
      id: "tx_007",
      accountId: amex.id,
      date: "2025-02-14",
      amount: "2849.00",
      merchant: "B&H PHOTO VIDEO",
      desc: "Sony a7R V body — primary camera",
    },
    {
      id: "tx_008",
      accountId: amex.id,
      date: "2025-03-22",
      amount: "389.00",
      merchant: "PEAK DESIGN",
      desc: "Travel tripod + capture clips",
    },

    // ── MEALS — CLIENT / TRAVEL ───────────────────────────────────
    {
      id: "tx_009",
      accountId: chaseFreedom.id,
      date: "2025-01-28",
      amount: "147.50",
      merchant: "UCHIKO AUSTIN",
      desc: "Client dinner — wedding consultation",
    },
    {
      id: "tx_010",
      accountId: chaseFreedom.id,
      date: "2025-08-05",  // During Alaska trip
      amount: "62.00",
      merchant: "RUSTIC GOAT ANCHORAGE",
      desc: "Dinner during Alaska content trip",
    },

    // ── TRAVEL — ALASKA TRIP (Aug 2–13) ──────────────────────────
    {
      id: "tx_011",
      accountId: amex.id,
      date: "2025-07-30",
      amount: "687.00",
      merchant: "DELTA AIR LINES",
      desc: "IAH-ANC round trip — Alaska trip",
    },
    {
      id: "tx_012",
      accountId: amex.id,
      date: "2025-08-02",
      amount: "1840.00",
      merchant: "AIRBNB",
      desc: "Cabin rental Denali area Aug 2–12",
    },

    // ── TRAVEL — SRI LANKA TRIP (Sep 15–Nov 3) ───────────────────
    {
      id: "tx_013",
      accountId: amex.id,
      date: "2025-09-10",
      amount: "1420.00",
      merchant: "EMIRATES AIRLINES",
      desc: "IAH-CMB round trip — Sri Lanka content trip",
    },
    {
      id: "tx_014",
      accountId: amex.id,
      date: "2025-09-15",
      amount: "2100.00",
      merchant: "AIRBNB",
      desc: "Villa Galle Sri Lanka Sep 15–Nov 3",
    },

    // ── VEHICLE / GRAY ───────────────────────────────────────────
    {
      id: "tx_015",
      accountId: chaseFreedom.id,
      date: "2025-04-10",
      amount: "89.00",
      merchant: "BLUEWAVE CAR WASH",
      desc: "Car wash — vehicle maintenance",
    },
    {
      id: "tx_016",
      accountId: chaseFreedom.id,
      date: "2025-05-22",
      amount: "112.40",
      merchant: "CHEVRON",
      desc: "Gas — vehicle business use",
    },

    // ── PERSONAL ─────────────────────────────────────────────────
    {
      id: "tx_017",
      accountId: chaseChecking.id,
      date: "2025-03-01",
      amount: "2200.00",
      merchant: "ZELLE RANDI",
      desc: "Transfer to spouse",
    },
    {
      id: "tx_018",
      accountId: chaseChecking.id,
      date: "2025-06-15",
      amount: "500.00",
      merchant: "HSMCA",
      desc: "Monthly donation",
    },

    // ── TRANSFERS ────────────────────────────────────────────────
    {
      id: "tx_019",
      accountId: chaseChecking.id,
      date: "2025-02-28",
      amount: "3000.00",
      merchant: "ONLINE TRANSFER TO AMEX",
      desc: "Credit card payment",
    },
    {
      id: "tx_020",
      accountId: amex.id,
      date: "2025-02-28",
      amount: "-3000.00",
      merchant: "PAYMENT THANK YOU",
      desc: "Amex payment received",
    },
  ]

  // Delete existing fixture data (idempotent re-seed across taxYear versions)
  // Must respect FK order: Classification → Transaction
  const fixtureIds = Array.from({ length: 20 }, (_, i) => `tx_${String(i + 1).padStart(3, "0")}`)
  await prisma.classification.deleteMany({ where: { transactionId: { in: fixtureIds } } })
  await prisma.transaction.deleteMany({ where: { id: { in: fixtureIds } } })

  for (const tx of txData) {
    const ikey = txKey(tx.accountId, tx.date, tx.amount, tx.merchant)
    await prisma.transaction.create({
      data: {
        id: tx.id,
        accountId: tx.accountId,
        taxYearId: taxYear.id,
        postedDate: new Date(tx.date),
        amountOriginal: tx.amount,
        amountNormalized: tx.amount.startsWith("-")
          ? tx.amount.replace("-", "")
          : tx.amount,
        merchantRaw: tx.merchant,
        merchantNormalized: tx.merchant.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        descriptionRaw: tx.desc,
        idempotencyKey: ikey,
      },
    })
  }
  console.log("  ✓ Transactions: 20")

  // Wire transfer pair (tx_019 / tx_020)
  await prisma.transaction.update({
    where: { id: "tx_019" },
    data: { isTransferPairedWith: "tx_020" },
  })
  await prisma.transaction.update({
    where: { id: "tx_020" },
    data: { isTransferPairedWith: "tx_019" },
  })
  console.log("  ✓ Transfer pair linked (credit card payment)")

  // ------------------------------------------------------------------
  // No Classifications seeded — that's intentional.
  // Classifications are created by the AI agent in Prompt 4.
  // ------------------------------------------------------------------

  console.log("\n✅  Seed complete!")
  console.log(`   User:      ${user.email}  (password: test123)`)
  console.log(`   Tax Year:  2025  |  Status: CREATED`)
  console.log(`   Profile:   NAICS 711510 — Wedding photography / travel content / e-commerce`)
  console.log(`   Trips:     Alaska (Aug 2–13) · Sri Lanka (Sep 15–Nov 3) · Colorado (Dec 4–12)`)
  console.log(`   Accounts:  Chase Freedom CC · Amex Platinum CC · Costco Citi CC · Chase Checking 9517 · Robinhood`)
  console.log(`   Txns:      20  |  Classifications: 0 (seeded by AI agent in Prompt 4)`)
}

main()
  .catch((e) => {
    console.error("❌  Seed failed:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
