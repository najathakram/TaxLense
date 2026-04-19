/**
 * Static citation library for Position Memos (spec §10.3, principle 6).
 *
 * The AI is permitted to use ONLY these citations in generated memos.
 * Never pass AI-generated or DB-derived citations to the prompt — these
 * are the known, verified IRC sections for each memo type.
 *
 * If a memo touches a rule not in this list, the AI must write [VERIFY].
 */

export type MemoType =
  | "§183_hobby"
  | "§274n2_100pct_meals"
  | "§280A_home_office"
  | "wardrobe"

export interface MemoRuleEntry {
  type: MemoType
  title: string
  exposureDescription: string
  ircCitations: string[]
  ruleIds: string[]
  factCheckpoints: string[]
}

export const MEMO_RULES: Record<MemoType, MemoRuleEntry> = {
  "§183_hobby": {
    type: "§183_hobby",
    title: "§183 Hobby-Loss Position Memo",
    exposureDescription: "Full deductible expense amount claimed against Schedule C loss",
    ircCitations: [
      "§183 (activities not engaged in for profit)",
      "§183(b)(1)",
      "§183(b)(2)",
      "§183(d) (presumption of profit: 3 of 5 years)",
      "Reg. §1.183-2(b) (nine-factor test)",
      "§162 (trade or business expenses)",
      "§212 (expenses for production of income)",
    ],
    ruleIds: ["R-183-001", "R-183-002"],
    factCheckpoints: [
      "Number of consecutive loss years",
      "Taxpayer's expertise and effort in the activity",
      "Time and effort devoted to the activity",
      "History of income and losses",
      "Amounts of occasional profits, if any",
      "Financial status of taxpayer (dependence on income)",
      "Elements of personal pleasure or recreation",
    ],
  },

  "§274n2_100pct_meals": {
    type: "§274n2_100pct_meals",
    title: "§274(n)(2) 100%-Deductible Meals Position Memo",
    exposureDescription: "50% disallowance avoided on MEALS_100-coded transactions",
    ircCitations: [
      "§274(n)(1) (50% limitation on meal deductions)",
      "§274(n)(2)(B) (employer-provided meals on business premises — 100%)",
      "§274(n)(2)(C) (meals treated as compensation — 100%)",
      "§274(e)(1) (meals sold to customers)",
      "§274(e)(3) (reimbursed meals — 100% to reimburser)",
      "§274(k) (lavish or extravagant limitation)",
      "§274(d) (substantiation requirements)",
      "Reg. §1.274-12",
    ],
    ruleIds: ["R-274-002", "R-274-003"],
    factCheckpoints: [
      "Specific §274(n)(2) exception that applies",
      "Contemporaneous substantiation: amount, place, business purpose, attendees",
      "Whether meal was lavish or extravagant",
      "Treatment on payroll records if compensation exception",
    ],
  },

  "§280A_home_office": {
    type: "§280A_home_office",
    title: "§280A Home Office Position Memo",
    exposureDescription: "Home office deduction under Schedule C Line 30",
    ircCitations: [
      "§280A(a) (general disallowance)",
      "§280A(c)(1) (exclusive and regular use exception)",
      "§280A(c)(1)(A) (principal place of business)",
      "§280A(c)(1)(B) (place to meet clients)",
      "§280A(c)(5) (income limitation — deduction cannot exceed gross income)",
      "Rev. Proc. 2013-13 (simplified method — $5/sqft, max 300 sqft)",
      "Reg. §1.280A-2",
      "§162 (ordinary and necessary)",
    ],
    ruleIds: ["R-280A-001", "R-280A-002"],
    factCheckpoints: [
      "Dedicated-use test: space is used exclusively and regularly for business",
      "Principal place of business test (or client-meeting test)",
      "Square footage of office vs. total home square footage",
      "Simplified vs. regular method election",
      "Income limitation: business gross income for the year",
    ],
  },

  wardrobe: {
    type: "wardrobe",
    title: "Wardrobe / Costume Deduction Position Memo",
    exposureDescription: "Clothing and wardrobe costs claimed as business expense",
    ircCitations: [
      "§162 (ordinary and necessary business expenses)",
      "Pevsner v. Commissioner, 628 F.2d 467 (5th Cir. 1980) (objective standard — adaptable to general use = personal)",
      "Rev. Rul. 70-474 (uniforms required as condition of employment and not suitable for ordinary wear)",
      "Reg. §1.162-1(a)",
      "Costello v. Commissioner, T.C. Memo 1988-596",
    ],
    ruleIds: ["R-162-wardrobe-001"],
    factCheckpoints: [
      "Whether garments are specifically required as a condition of employment",
      "Whether garments are unsuitable for ordinary street wear (objective Pevsner standard)",
      "Whether employer requires wearing the specific items",
      "For performers: costume vs. general wardrobe distinction",
      "Receipts and description of each claimed item",
    ],
  },
}

export function getMemoRule(type: MemoType): MemoRuleEntry {
  return MEMO_RULES[type]
}

export const ALL_MEMO_TYPES: MemoType[] = [
  "§183_hobby",
  "§274n2_100pct_meals",
  "§280A_home_office",
  "wardrobe",
]
