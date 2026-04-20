import type { TransactionCode } from "@/app/generated/prisma/client"

export const TRANSACTION_CODES: TransactionCode[] = [
  "WRITE_OFF",
  "WRITE_OFF_TRAVEL",
  "WRITE_OFF_COGS",
  "MEALS_50",
  "MEALS_100",
  "GRAY",
  "PERSONAL",
  "TRANSFER",
  "PAYMENT",
  "BIZ_INCOME",
  "NEEDS_CONTEXT",
]

export const SCHEDULE_C_LINES: string[] = [
  "Line 8 Advertising",
  "Line 9 Car & Truck",
  "Line 11 Contract Labor",
  "Line 13 Depreciation",
  "Line 15 Insurance",
  "Line 16b Interest",
  "Line 17 Legal & Professional",
  "Line 18 Office Expense",
  "Line 20b Rent — Other",
  "Line 21 Repairs & Maintenance",
  "Line 22 Supplies",
  "Line 23 Taxes & Licenses",
  "Line 24a Travel",
  "Line 24b Meals",
  "Line 25 Utilities",
  "Line 27a Other Expenses",
  "Line 30 Home Office",
  "Part III COGS",
  "N/A",
]

export function codeToCategory(code: TransactionCode, scheduleCLine: string | null): string {
  switch (code) {
    case "PERSONAL": return "Personal"
    case "TRANSFER": return "Transfer"
    case "PAYMENT": return "Payment"
    case "BIZ_INCOME": return "Business Income"
    case "NEEDS_CONTEXT": return "Needs Review"
    case "GRAY": return "Unclear"
    case "MEALS_50": return "Meals (50%)"
    case "MEALS_100": return "Meals (100%)"
    case "WRITE_OFF_TRAVEL": return "Travel"
    case "WRITE_OFF_COGS": return "Cost of Goods"
    case "WRITE_OFF": {
      if (scheduleCLine && scheduleCLine !== "N/A") {
        // Strip "Line XX " prefix → "Office Expense", "Car & Truck", etc.
        return scheduleCLine.replace(/^Line\s+\d+[a-z]?\s+/i, "").replace(/^Part\s+\w+\s+/i, "")
      }
      return "Business Expense"
    }
    default: return ""
  }
}

// §10.1 color coding
export function codeColorClass(code: TransactionCode): string {
  switch (code) {
    case "WRITE_OFF":
    case "WRITE_OFF_TRAVEL":
    case "WRITE_OFF_COGS":
      return "bg-green-50 dark:bg-green-950/30"
    case "MEALS_50":
    case "MEALS_100":
    case "GRAY":
      return "bg-amber-50 dark:bg-amber-950/30"
    case "PERSONAL":
      return "bg-red-50 dark:bg-red-950/30"
    case "TRANSFER":
    case "PAYMENT":
      return "bg-blue-50 dark:bg-blue-950/30"
    case "BIZ_INCOME":
      return "bg-emerald-50 dark:bg-emerald-950/30"
    case "NEEDS_CONTEXT":
      return "bg-yellow-50 dark:bg-yellow-950/30"
    default:
      return ""
  }
}
