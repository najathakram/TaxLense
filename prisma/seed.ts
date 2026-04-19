/**
 * TaxLens — Prisma seed script
 * Session 1 fixture data for Najath's dev/test environment.
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
  // 1. Rule versions (two; v2 supersedes v1)
  // ------------------------------------------------------------------
  const rv1 = await prisma.ruleVersion.upsert({
    where: { id: "rv_2024_001" },
    create: {
      id: "rv_2024_001",
      effectiveDate: new Date("2024-01-01"),
      ruleSet: { version: "1.0", rules: [] },
      summary: "Initial rule set — Session 1 placeholder",
    },
    update: {},
  })

  const rv2 = await prisma.ruleVersion.upsert({
    where: { id: "rv_2025_001" },
    create: {
      id: "rv_2025_001",
      effectiveDate: new Date("2025-01-01"),
      ruleSet: { version: "2.0", rules: [] },
      summary: "Updated rule set for TY 2025 — Session 1 placeholder",
      supersededById: null,
    },
    update: {},
  })

  // Link rv1 superseded by rv2 (update after both exist)
  await prisma.ruleVersion.update({
    where: { id: "rv_2024_001" },
    data: { supersededById: rv2.id },
  })

  // ------------------------------------------------------------------
  // 2. User — Najath
  // ------------------------------------------------------------------
  const password = await bcrypt.hash("taxlens2025!", 12)

  const user = await prisma.user.upsert({
    where: { email: "najathakram1@gmail.com" },
    create: {
      id: "user_najath",
      name: "Najath Akram",
      email: "najathakram1@gmail.com",
      password,
    },
    update: { name: "Najath Akram" },
  })
  console.log(`  ✓ User: ${user.email}`)

  // ------------------------------------------------------------------
  // 3. Tax Year 2025
  // ------------------------------------------------------------------
  const taxYear = await prisma.taxYear.upsert({
    where: { userId_year: { userId: user.id, year: 2025 } },
    create: {
      id: "ty_2025",
      userId: user.id,
      year: 2025,
      status: "CLASSIFICATION",
      ruleVersionId: rv2.id,
    },
    update: { status: "CLASSIFICATION", ruleVersionId: rv2.id },
  })
  console.log(`  ✓ TaxYear: ${taxYear.year}`)

  // ------------------------------------------------------------------
  // 4. Business Profile
  // ------------------------------------------------------------------
  const profile = await prisma.businessProfile.upsert({
    where: { taxYearId: taxYear.id },
    create: {
      id: "bp_2025",
      userId: user.id,
      taxYearId: taxYear.id,
      naicsCode: "541511",
      entityType: "SOLE_PROP",
      primaryState: "CA",
      businessDescription: "Custom software development and technical consulting",
      grossReceiptsEstimate: 185000,
      accountingMethod: "CASH",
      homeOfficeConfig: {
        has: true,
        dedicated: true,
        officeSqft: 180,
        homeSqft: 1200,
      },
      vehicleConfig: {
        has: true,
        bizPct: 60,
      },
      inventoryConfig: {
        has: false,
        physical: false,
        dropship: false,
      },
      revenueStreams: ["consulting", "contract_development", "saas_licensing"],
      firstYear: false,
    },
    update: {},
  })
  console.log(`  ✓ BusinessProfile: ${profile.naicsCode}`)

  // ------------------------------------------------------------------
  // 5. Known Entities (3)
  // ------------------------------------------------------------------
  await prisma.knownEntity.deleteMany({ where: { profileId: profile.id } })
  await prisma.knownEntity.createMany({
    data: [
      {
        id: "ke_001",
        profileId: profile.id,
        kind: "PERSON_CLIENT",
        displayName: "Acme Corp",
        matchKeywords: ["ACME", "ACME CORP"],
        defaultCode: "BIZ_INCOME",
        notes: "Primary enterprise client — monthly retainer",
      },
      {
        id: "ke_002",
        profileId: profile.id,
        kind: "PERSON_PERSONAL",
        displayName: "Parents",
        matchKeywords: ["MOM", "DAD", "FAMILY TRANSFER"],
        defaultCode: "PERSONAL",
        notes: "Personal family transfers",
      },
      {
        id: "ke_003",
        profileId: profile.id,
        kind: "PATTERN_EXCLUDED",
        displayName: "Internal Transfers",
        matchKeywords: ["TRANSFER", "ONLINE TRANSFER", "ACH TRANSFER"],
        defaultCode: "TRANSFER",
        notes: "Between-account transfers — exclude from Schedule C",
      },
    ],
  })
  console.log("  ✓ KnownEntities: 3")

  // ------------------------------------------------------------------
  // 6. Trips (3)
  // ------------------------------------------------------------------
  await prisma.trip.deleteMany({ where: { profileId: profile.id } })
  await prisma.trip.createMany({
    data: [
      {
        id: "trip_001",
        profileId: profile.id,
        name: "AWS re:Invent 2024",
        destination: "Las Vegas, NV",
        startDate: new Date("2024-12-02"),
        endDate: new Date("2024-12-06"),
        purpose: "Cloud architecture conference and client networking",
        deliverableDescription: "Architecture review deck for Acme migration",
        isConfirmed: true,
      },
      {
        id: "trip_002",
        profileId: profile.id,
        name: "Acme On-site — Q1 2025",
        destination: "San Francisco, CA",
        startDate: new Date("2025-02-10"),
        endDate: new Date("2025-02-12"),
        purpose: "Client kickoff and sprint planning",
        deliverableDescription: "Signed SOW and sprint backlog",
        isConfirmed: true,
      },
      {
        id: "trip_003",
        profileId: profile.id,
        name: "GTC AI Conference",
        destination: "San Jose, CA",
        startDate: new Date("2025-03-17"),
        endDate: new Date("2025-03-21"),
        purpose: "AI/ML tooling research and vendor evaluation",
        deliverableDescription: "Vendor comparison report",
        isConfirmed: false,
      },
    ],
  })
  console.log("  ✓ Trips: 3")

  // ------------------------------------------------------------------
  // 7. Financial Accounts (5)
  // ------------------------------------------------------------------
  await prisma.financialAccount.deleteMany({ where: { taxYearId: taxYear.id } })

  const accounts = await Promise.all([
    prisma.financialAccount.create({
      data: {
        id: "acct_chase_biz",
        userId: user.id,
        taxYearId: taxYear.id,
        type: "CHECKING",
        institution: "Chase Bank",
        mask: "4821",
        nickname: "Chase Biz Checking",
        isPrimaryBusiness: true,
      },
    }),
    prisma.financialAccount.create({
      data: {
        id: "acct_chase_personal",
        userId: user.id,
        taxYearId: taxYear.id,
        type: "CHECKING",
        institution: "Chase Bank",
        mask: "9203",
        nickname: "Chase Personal",
        isPrimaryBusiness: false,
      },
    }),
    prisma.financialAccount.create({
      data: {
        id: "acct_amex",
        userId: user.id,
        taxYearId: taxYear.id,
        type: "CREDIT_CARD",
        institution: "American Express",
        mask: "1005",
        nickname: "Amex Blue Cash Biz",
        isPrimaryBusiness: true,
      },
    }),
    prisma.financialAccount.create({
      data: {
        id: "acct_stripe",
        userId: user.id,
        taxYearId: taxYear.id,
        type: "PAYMENT_PROCESSOR",
        institution: "Stripe",
        mask: null,
        nickname: "Stripe Payments",
        isPrimaryBusiness: true,
      },
    }),
    prisma.financialAccount.create({
      data: {
        id: "acct_schwab",
        userId: user.id,
        taxYearId: taxYear.id,
        type: "SAVINGS",
        institution: "Charles Schwab",
        mask: "7744",
        nickname: "Schwab High-Yield",
        isPrimaryBusiness: false,
      },
    }),
  ])
  console.log("  ✓ FinancialAccounts: 5")

  const [bizChecking, personalChecking, amex, , ] = accounts

  // ------------------------------------------------------------------
  // 8. Transactions (20)
  // ------------------------------------------------------------------
  await prisma.transaction.deleteMany({ where: { taxYearId: taxYear.id } })

  const txData = [
    // --- Biz income from Acme Corp
    {
      id: "tx_001",
      accountId: bizChecking.id,
      postedDate: "2025-01-15",
      amount: "-15000.00",
      merchant: "ACME CORP ACH PYMT",
      description: "Consulting retainer January 2025",
    },
    // --- AWS (biz expense)
    {
      id: "tx_002",
      accountId: amex.id,
      postedDate: "2025-01-02",
      amount: "847.32",
      merchant: "AWS",
      description: "Amazon Web Services Jan 2025",
    },
    // --- GitHub (biz expense)
    {
      id: "tx_003",
      accountId: amex.id,
      postedDate: "2025-01-04",
      amount: "21.00",
      merchant: "GITHUB",
      description: "GitHub Team plan",
    },
    // --- Figma (biz expense)
    {
      id: "tx_004",
      accountId: amex.id,
      postedDate: "2025-01-06",
      amount: "45.00",
      merchant: "FIGMA",
      description: "Figma Professional",
    },
    // --- United Airlines (travel expense — trip_001 dates)
    {
      id: "tx_005",
      accountId: amex.id,
      postedDate: "2025-01-10",
      amount: "612.00",
      merchant: "UNITED AIRLINES",
      description: "Flight SFO-LAS for re:Invent",
    },
    // --- Hotel (travel expense)
    {
      id: "tx_006",
      accountId: amex.id,
      postedDate: "2025-01-12",
      amount: "1230.00",
      merchant: "MGM GRAND LAS VEGAS",
      description: "Hotel 4 nights re:Invent",
    },
    // --- Meal 50%
    {
      id: "tx_007",
      accountId: amex.id,
      postedDate: "2025-01-13",
      amount: "127.45",
      merchant: "NOBU LAS VEGAS",
      description: "Client dinner re:Invent",
    },
    // --- Personal grocery
    {
      id: "tx_008",
      accountId: personalChecking.id,
      postedDate: "2025-01-18",
      amount: "213.67",
      merchant: "WHOLE FOODS",
      description: "Weekly groceries",
    },
    // --- Biz income February
    {
      id: "tx_009",
      accountId: bizChecking.id,
      postedDate: "2025-02-15",
      amount: "-15000.00",
      merchant: "ACME CORP ACH PYMT",
      description: "Consulting retainer February 2025",
    },
    // --- Notion (biz expense)
    {
      id: "tx_010",
      accountId: amex.id,
      postedDate: "2025-02-03",
      amount: "16.00",
      merchant: "NOTION",
      description: "Notion Team plan",
    },
    // --- Zoom (biz expense)
    {
      id: "tx_011",
      accountId: amex.id,
      postedDate: "2025-02-05",
      amount: "15.99",
      merchant: "ZOOM",
      description: "Zoom Pro subscription",
    },
    // --- Delta (travel — trip_002)
    {
      id: "tx_012",
      accountId: amex.id,
      postedDate: "2025-02-08",
      amount: "389.00",
      merchant: "DELTA AIR LINES",
      description: "Flight LAX-SFO for Acme on-site",
    },
    // --- Client lunch (50% meals)
    {
      id: "tx_013",
      accountId: amex.id,
      postedDate: "2025-02-11",
      amount: "94.20",
      merchant: "ATELIER CRENN SF",
      description: "Lunch with Acme PM team",
    },
    // --- Personal Netflix
    {
      id: "tx_014",
      accountId: personalChecking.id,
      postedDate: "2025-02-18",
      amount: "22.99",
      merchant: "NETFLIX",
      description: "Netflix subscription",
    },
    // --- Transfer biz→personal
    {
      id: "tx_015",
      accountId: bizChecking.id,
      postedDate: "2025-02-20",
      amount: "5000.00",
      merchant: "ONLINE TRANSFER",
      description: "Owner draw",
    },
    // --- Corresponding transfer personal←biz
    {
      id: "tx_016",
      accountId: personalChecking.id,
      postedDate: "2025-02-20",
      amount: "-5000.00",
      merchant: "ONLINE TRANSFER",
      description: "Transfer from biz account",
    },
    // --- March — biz income
    {
      id: "tx_017",
      accountId: bizChecking.id,
      postedDate: "2025-03-15",
      amount: "-20000.00",
      merchant: "ACME CORP ACH PYMT",
      description: "Consulting retainer March 2025 + milestone bonus",
    },
    // --- OpenAI (biz expense)
    {
      id: "tx_018",
      accountId: amex.id,
      postedDate: "2025-03-03",
      amount: "20.00",
      merchant: "OPENAI",
      description: "ChatGPT Plus subscription",
    },
    // --- NVIDIA GTC registration (biz expense — trip_003)
    {
      id: "tx_019",
      accountId: amex.id,
      postedDate: "2025-03-10",
      amount: "1499.00",
      merchant: "NVIDIA GTC REGISTRATION",
      description: "GTC 2025 conference pass",
    },
    // --- Gray area — home internet (partial biz)
    {
      id: "tx_020",
      accountId: bizChecking.id,
      postedDate: "2025-03-22",
      amount: "79.99",
      merchant: "AT&T INTERNET",
      description: "Monthly internet bill",
    },
  ]

  for (const tx of txData) {
    const ikey = txKey(tx.accountId, tx.postedDate, tx.amount, tx.merchant)
    await prisma.transaction.create({
      data: {
        id: tx.id,
        accountId: tx.accountId,
        taxYearId: taxYear.id,
        postedDate: new Date(tx.postedDate),
        amountOriginal: tx.amount,
        amountNormalized: tx.amount.startsWith("-")
          ? tx.amount.replace("-", "") // income → positive normalized
          : tx.amount,                 // expense → positive normalized
        merchantRaw: tx.merchant,
        merchantNormalized: tx.merchant.toLowerCase().replace(/\s+/g, "_"),
        descriptionRaw: tx.description,
        idempotencyKey: ikey,
      },
    })
  }
  console.log("  ✓ Transactions: 20")

  // ------------------------------------------------------------------
  // 9. Wire transfer pair (tx_015 / tx_016)
  // ------------------------------------------------------------------
  await prisma.transaction.update({
    where: { id: "tx_015" },
    data: { isTransferPairedWith: "tx_016" },
  })
  await prisma.transaction.update({
    where: { id: "tx_016" },
    data: { isTransferPairedWith: "tx_015" },
  })
  console.log("  ✓ Transfer pair linked")

  // ------------------------------------------------------------------
  // 10. Seed classifications for the obvious transactions
  // ------------------------------------------------------------------
  await prisma.classification.deleteMany({
    where: { transaction: { taxYearId: taxYear.id } },
  })

  const bizIncomeIds = ["tx_001", "tx_009", "tx_017"]
  const writeOffIds  = ["tx_002", "tx_003", "tx_004", "tx_010", "tx_011", "tx_018", "tx_019"]
  const travelIds    = ["tx_005", "tx_006", "tx_012"]
  const meals50Ids   = ["tx_007", "tx_013"]
  const personalIds  = ["tx_008", "tx_014"]
  const transferIds  = ["tx_015", "tx_016"]
  const grayIds      = ["tx_020"]

  const classificationRows: {
    transactionId: string
    code: string
    businessPct: number
    confidence: number
    evidenceTier: number
    source: string
    reasoning: string
    scheduleCLine: string | null
  }[] = [
    ...bizIncomeIds.map((id) => ({
      transactionId: id,
      code: "BIZ_INCOME",
      businessPct: 100,
      confidence: 0.98,
      evidenceTier: 3,
      source: "AI",
      reasoning: "Recurring ACH payment from known client ACME CORP",
      scheduleCLine: null,
    })),
    ...writeOffIds.map((id) => ({
      transactionId: id,
      code: "WRITE_OFF",
      businessPct: 100,
      confidence: 0.92,
      evidenceTier: 2,
      source: "AI",
      reasoning: "Software/SaaS subscription — direct business tool",
      scheduleCLine: "18",
    })),
    ...travelIds.map((id) => ({
      transactionId: id,
      code: "WRITE_OFF_TRAVEL",
      businessPct: 100,
      confidence: 0.88,
      evidenceTier: 2,
      source: "AI",
      reasoning: "Travel expense during confirmed business trip",
      scheduleCLine: "24a",
    })),
    ...meals50Ids.map((id) => ({
      transactionId: id,
      code: "MEALS_50",
      businessPct: 50,
      confidence: 0.85,
      evidenceTier: 2,
      source: "AI",
      reasoning: "Business meal — 50% deductible per IRC §274",
      scheduleCLine: "24b",
    })),
    ...personalIds.map((id) => ({
      transactionId: id,
      code: "PERSONAL",
      businessPct: 0,
      confidence: 0.95,
      evidenceTier: 1,
      source: "AI",
      reasoning: "Personal expense — no business connection",
      scheduleCLine: null,
    })),
    ...transferIds.map((id) => ({
      transactionId: id,
      code: "TRANSFER",
      businessPct: 0,
      confidence: 0.97,
      evidenceTier: 1,
      source: "AI",
      reasoning: "Between-account transfer — not a deductible expense",
      scheduleCLine: null,
    })),
    ...grayIds.map((id) => ({
      transactionId: id,
      code: "GRAY",
      businessPct: 60,
      confidence: 0.62,
      evidenceTier: 2,
      source: "AI",
      reasoning: "Home internet — partial business use per home office % (60%)",
      scheduleCLine: "25",
    })),
  ]

  await prisma.classification.createMany({
    data: classificationRows.map((r) => ({
      transactionId: r.transactionId,
      code: r.code as never,
      scheduleCLine: r.scheduleCLine,
      businessPct: r.businessPct,
      ircCitations: [],
      confidence: r.confidence,
      evidenceTier: r.evidenceTier,
      source: r.source as never,
      reasoning: r.reasoning,
      isCurrent: true,
    })),
  })
  console.log(`  ✓ Classifications: ${classificationRows.length}`)

  console.log("\n✅  Seed complete!")
  console.log(`   User:         ${user.email}  (password: taxlens2025!)`)
  console.log(`   Tax Year:     ${taxYear.year}  (status: ${taxYear.status})`)
  console.log("   Accounts:     5  |  Transactions: 20  |  Classified: 20")
}

main()
  .catch((e) => {
    console.error("❌  Seed failed:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
