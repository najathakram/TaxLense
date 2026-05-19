/**
 * Line 27a Other Expenses sub-category mapping.
 *
 * The reference workbook breaks Line 27a Other Expenses into named
 * sub-categories (Travel / Subscriptions / Auto Expense / Props & Supplies /
 * Clothing & Grooming / Robinhood Card / Card & Bank Fees / Other) for a
 * CPA-readable breakdown.
 *
 * This module classifies each transaction by merchant pattern into one of the
 * named sub-categories. Used by buildFinancialStatements() to emit indented
 * sub-rows under "Line 27a Other Expenses" on both the Schedule C and P&L
 * sheets.
 *
 * Decision order: first match wins. Future per-client tuning can be done by
 * adding entries to MERCHANT_OVERRIDES before deployment.
 */

export type Line27aSubCategory =
  | "Travel"
  | "Subscriptions"
  | "Auto Expense"
  | "Props & Supplies"
  | "Clothing & Grooming"
  | "Robinhood Card"
  | "Card & Bank Fees"
  | "Bank Interest"
  | "Other"

interface SubCategoryRule {
  readonly subCategory: Line27aSubCategory
  /** Case-insensitive regex against (merchantNormalized || merchantRaw). */
  readonly pattern: RegExp
}

// Order matters — first match wins. Most-specific rules first.
// Bank Interest comes BEFORE Robinhood so "Finance charge — Robinhood"
// classifies as Bank Interest (the more meaningful tax classification),
// not Robinhood Card.
const RULES: readonly SubCategoryRule[] = [
  // Bank interest patterns (highest priority — these are §163-style charges
  // that need precise classification regardless of card brand).
  { subCategory: "Bank Interest", pattern: /\b(cash\s+advance\s+interest|interest\s+charge|finance\s+charge)\b/i },

  // Robinhood card — explicit (after Bank Interest so finance charges on
  // Robinhood still route to Bank Interest).
  { subCategory: "Robinhood Card", pattern: /\brobinhood\b/i },

  // Bank/card fees (excluding interest, which was handled above).
  {
    subCategory: "Card & Bank Fees",
    pattern: /\b(monthly\s+service\s+fee|annual\s+fee|membership\s+fee|maintenance\s+fee|late\s+fee|wire\s+fee|atm\s+fee|nsf|overdraft|foreign\s+(transaction|exchange)\s+fee|card\s+fee|bank\s+fee|merchant\s+fee|processing\s+fee|stripe\s+fee|paypal\s+fee|wise\s+(charge|charges|fee|fees))\b/i,
  },

  // Travel
  {
    subCategory: "Travel",
    pattern: /\b(airbnb|booking\.com|expedia|hotels?\.com|marriott|hilton|hyatt|delta|united|american\s+airlines|southwest|spirit|jetblue|frontier|alaska\s+air|uber\b|lyft|airfare|baggage|hertz|avis|enterprise\s+rent|rental\s+car|amtrak|tsa|airport)\b/i,
  },

  // Auto expense (parts, fuel, maintenance — excludes mileage)
  {
    subCategory: "Auto Expense",
    pattern: /\b(exxon|chevron|shell\s|arco|mobil|76\s|sunoco|valero|costco\s+gas|gas\s+station|fuel|auto\s+parts|tire|oil\s+change|car\s+wash|jiffy\s+lube|advance\s+auto|autozone|napa\s+auto|pep\s+boys|firestone|midas)\b/i,
  },

  // Subscriptions (SaaS, cloud, software, content platforms)
  {
    subCategory: "Subscriptions",
    pattern: /\b(adobe|davinci|notion|figma|github|google\s+workspace|microsoft\s+365|m365|office\s+365|dropbox|icloud|google\s+one|zoom|slack|asana|monday|trello|airtable|atlassian|jira|aws|gcp|azure|cloud|hosting|godaddy|cloudflare|vercel|netlify|substack|tiktok\s+ads|google\s+ads|meta\s+ads|facebook\s+ads|youtube\s+premium|spotify|apple\.com\/bill|apple\s+com\s+bill|chatgpt|openai|anthropic|claude)\b/i,
  },

  // Clothing & Grooming
  {
    subCategory: "Clothing & Grooming",
    pattern: /\b(salon|barber|haircut|nails|spa|skincare|makeup|sephora|ulta|nordstrom|macy'?s|zara|h&m|uniqlo|gap|old\s+navy|j\.?crew|target\s+(clothing|apparel)|amazon\s+fashion|asos|men'?s\s+wearhouse|dry\s+clean)\b/i,
  },

  // Props & Supplies (production / content props)
  {
    subCategory: "Props & Supplies",
    pattern: /\b(ross\s+store|tj\s*maxx|tjmaxx|marshalls|home\s+goods|home\s+depot|lowe'?s|michael'?s|hobby\s+lobby|aaa\s+supplies|prop\s+|supply\s+|amazon\s+basics|staples|office\s+depot|costco)\b/i,
  },
]

/**
 * Classify a transaction into a Line 27a sub-category. Returns "Other" when
 * no rule matches. Caller should only invoke this for transactions whose
 * scheduleCLine is "Line 27a Other Expenses" (or the legacy "Line 27a").
 */
export function classifyLine27aSubCategory(merchant: string | null | undefined): Line27aSubCategory {
  if (!merchant) return "Other"
  for (const rule of RULES) {
    if (rule.pattern.test(merchant)) return rule.subCategory
  }
  return "Other"
}

/**
 * Display order for Line 27a sub-categories in the breakdown — matches the
 * reference workbook ordering (Travel first, then Subscriptions, etc.) so the
 * generated XLSX is visually consistent across clients.
 */
export const LINE_27A_SUBCATEGORY_DISPLAY_ORDER: readonly Line27aSubCategory[] = [
  "Travel",
  "Subscriptions",
  "Auto Expense",
  "Props & Supplies",
  "Clothing & Grooming",
  "Robinhood Card",
  "Card & Bank Fees",
  "Bank Interest",
  "Other",
] as const

/**
 * Detect whether a Schedule C line string refers to Line 27a (handles both
 * canonical "Line 27a Other Expenses" and legacy variants like "Line 27a" /
 * "Line 27a Other Expenses (legacy)").
 */
export function isLine27a(line: string | null | undefined): boolean {
  if (!line) return false
  return /\bline\s+27a\b/i.test(line)
}
