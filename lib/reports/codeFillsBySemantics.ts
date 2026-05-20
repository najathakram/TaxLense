/**
 * Code → fill color mapping for the General Ledger row coloring.
 *
 * The reference workbook colors rows by DEDUCTIBILITY CHARACTER (full / partial
 * / gray / allocated), not by code enum. This module returns the appropriate
 * semantic fill given the (code, businessPct, scheduleCLine) triple.
 *
 * 5 visual classes:
 *   - Mint (`#D5E8D4`):  100% content meals
 *   - Light green (`#E2EFDA`):  100% write-off (general)
 *   - Light blue (`#DDEBF7`):  50% partial deduction (meals 50%, vehicle 50%)
 *   - Light yellow (`#FFF2CC`):  gray zone (needs CPA review)
 *   - Light pink (`#EAD1DC`):  allocated partial (e.g. 65% biz / 35% personal)
 *   - None (no fill):  personal / transfer / payment / income
 */

import type { TransactionCode } from "@/app/generated/prisma/client"
import { FILL_SEMANTICS } from "./financialStatementsStyles"
import ExcelJS from "exceljs"

export type FillSemanticClass =
  | "contentMeals100"
  | "writeOff100"
  | "partialDeduction50"
  | "grayZone"
  | "allocatedPartial"
  | "none"

/**
 * Decide which semantic fill class a row belongs to, based on its
 * classification triple.
 *
 * Decision order (most specific first):
 *   1. Meals 100% on Line 24b → contentMeals100 (mint)
 *   2. Meals 50% → partialDeduction50 (blue)
 *   3. GRAY code → grayZone (yellow)
 *   4. WRITE_OFF_TRAVEL or vehicle line with bizPct 50–99 → partialDeduction50 (blue)
 *   5. WRITE_OFF / WRITE_OFF_COGS / WRITE_OFF_TRAVEL with bizPct = 100 → writeOff100 (green)
 *   6. WRITE_OFF / WRITE_OFF_COGS with bizPct 1–99 → allocatedPartial (pink)
 *   7. BIZ_INCOME / TRANSFER / PAYMENT / PERSONAL / NEEDS_CONTEXT → none
 */
export function classifySemanticFill(
  code: TransactionCode,
  businessPct: number,
  scheduleCLine: string | null,
): FillSemanticClass {
  // Step 1–2: Meals
  if (code === "MEALS_100") return "contentMeals100"
  if (code === "MEALS_50") return "partialDeduction50"

  // Step 3: explicit gray
  if (code === "GRAY") return "grayZone"

  // Step 4: vehicle / travel partial
  const line = (scheduleCLine ?? "").toLowerCase()
  const isVehicleLine = line.includes("line 9") || line.includes("car & truck") || line.includes("car and truck")
  if (code === "WRITE_OFF_TRAVEL" && businessPct < 100) return "partialDeduction50"
  if (isVehicleLine && businessPct >= 30 && businessPct <= 99) return "partialDeduction50"

  // Step 5: full deduction
  const fullDeductibleCodes: TransactionCode[] = ["WRITE_OFF", "WRITE_OFF_COGS", "WRITE_OFF_TRAVEL"]
  if (fullDeductibleCodes.includes(code) && businessPct >= 100) return "writeOff100"

  // Step 6: allocated partial (e.g. 65% biz interest)
  if (fullDeductibleCodes.includes(code) && businessPct > 0 && businessPct < 100) return "allocatedPartial"

  // Step 7: everything else (PERSONAL, TRANSFER, PAYMENT, BIZ_INCOME,
  // OWNER_EQUITY, NEEDS_CONTEXT) — Balance Sheet items, payment plumbing,
  // income, and unresolved rows get no Schedule C deductibility fill.
  return "none"
}

/**
 * Resolve the ExcelJS fill object for a given classification. Returns
 * undefined for "none" (no fill applied).
 */
export function semanticFillFor(
  code: TransactionCode,
  businessPct: number,
  scheduleCLine: string | null,
): ExcelJS.Fill | undefined {
  const cls = classifySemanticFill(code, businessPct, scheduleCLine)
  const argb = FILL_SEMANTICS[cls]
  if (!argb) return undefined
  return { type: "pattern", pattern: "solid", fgColor: { argb } }
}
