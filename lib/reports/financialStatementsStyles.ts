/**
 * Financial-statements design system — extracted from the
 * MaznahMediaGroup_FinancialStatements_2025_v2.xlsx reference workbook the
 * user supplied as the quality bar.
 *
 * Centralizes color palette, font, number format, and ExcelJS style helpers
 * so every sheet renders with the same visual language.
 *
 * Color palette is keyed by SEMANTIC ROLE (title / section header / line
 * header / positive accent / risk accent / footer note) rather than by code
 * enum. The code→fill mapping (for ledger row coloring by deductibility
 * character) lives in codeFillsBySemantics.ts.
 */

import ExcelJS from "exceljs"

// ─────────────────────────────────────────────────────────────────────────────
// Color palette (ARGB hex strings — ExcelJS convention)
// ─────────────────────────────────────────────────────────────────────────────

export const FS_COLORS = {
  // Title text (14pt bold, A1)
  titleText: "FF1F4E79", // dark navy

  // Subtitle text (11pt italic, A2)
  subtitleText: "FF4472C4", // medium blue

  // Footer note text (italic gray)
  footerNoteText: "FF7F7F7F", // medium gray

  // Section bands — Income on dark navy, Expenses on medium blue
  incomeSectionFill: "FF1F4E79",
  expensesSectionFill: "FF2E75B6",
  sectionBandText: "FFFFFFFF", // white text on colored band

  // Line-aggregation header (e.g. "Line 1 — Gross Receipts")
  lineHeaderFill: "FFF2F2F2", // light gray
  lineHeaderText: "FF000000", // black bold

  // Positive accent (Gross Profit, positive subtotals)
  positiveFill: "FFE2EFDA",
  positiveText: "FF375623", // dark green

  // Risk accent (Total Expenses — final tally above net)
  riskFill: "FFFDECEA",
  riskText: "FFC00000", // dark red

  // Final-tally accent (Net Profit / Net Loss row)
  finalTallyFill: "FFFCE4D6", // soft salmon
  finalTallyText: "FFC00000", // dark red

  // Plain header row (column headers on detail sheets)
  headerFill: "FF1F4E79",
  headerText: "FFFFFFFF",

  // Border
  borderColor: "FF9CA3AF",

  // Body row stripe (subtle, optional — keep neutral)
  bodyAltFill: "FFFAFAFA",
} as const

export const FS_FONT = {
  name: "Arial",
  titleSize: 14,
  subtitleSize: 11,
  bodySize: 10,
} as const

// Number format: parens for negatives, dash for zero, 2 decimals
export const FS_NUM_FMT_MONEY = '#,##0.00;\\(#,##0.00\\);\\-'
export const FS_NUM_FMT_PERCENT = '0.0%;\\(0.0%\\);\\-'
export const FS_NUM_FMT_INT = '#,##0;\\(#,##0\\);\\-'

// ─────────────────────────────────────────────────────────────────────────────
// Style helpers — each returns a partial style object an ExcelJS row/cell can
// be assigned. Keep these stateless; callers apply to the right rows.
// ─────────────────────────────────────────────────────────────────────────────

export function fsTitleStyle(): { font: Partial<ExcelJS.Font> } {
  return {
    font: {
      name: FS_FONT.name,
      size: FS_FONT.titleSize,
      bold: true,
      color: { argb: FS_COLORS.titleText },
    },
  }
}

export function fsSubtitleStyle(): { font: Partial<ExcelJS.Font> } {
  return {
    font: {
      name: FS_FONT.name,
      size: FS_FONT.subtitleSize,
      italic: true,
      color: { argb: FS_COLORS.subtitleText },
    },
  }
}

export function fsSectionBandStyle(variant: "income" | "expenses" = "income"): {
  font: Partial<ExcelJS.Font>
  fill: ExcelJS.Fill
} {
  const bg = variant === "income" ? FS_COLORS.incomeSectionFill : FS_COLORS.expensesSectionFill
  return {
    font: {
      name: FS_FONT.name,
      size: FS_FONT.bodySize,
      bold: true,
      color: { argb: FS_COLORS.sectionBandText },
    },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: bg } },
  }
}

export function fsLineHeaderStyle(): {
  font: Partial<ExcelJS.Font>
  fill: ExcelJS.Fill
} {
  return {
    font: {
      name: FS_FONT.name,
      size: FS_FONT.bodySize,
      bold: true,
      color: { argb: FS_COLORS.lineHeaderText },
    },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: FS_COLORS.lineHeaderFill } },
  }
}

export function fsBodyStyle(): { font: Partial<ExcelJS.Font> } {
  return {
    font: { name: FS_FONT.name, size: FS_FONT.bodySize },
  }
}

export function fsPositiveAccentStyle(): {
  font: Partial<ExcelJS.Font>
  fill: ExcelJS.Fill
} {
  return {
    font: {
      name: FS_FONT.name,
      size: FS_FONT.bodySize,
      bold: true,
      color: { argb: FS_COLORS.positiveText },
    },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: FS_COLORS.positiveFill } },
  }
}

export function fsRiskAccentStyle(): {
  font: Partial<ExcelJS.Font>
  fill: ExcelJS.Fill
} {
  return {
    font: {
      name: FS_FONT.name,
      size: FS_FONT.bodySize,
      bold: true,
      color: { argb: FS_COLORS.riskText },
    },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: FS_COLORS.riskFill } },
  }
}

export function fsFinalTallyStyle(): {
  font: Partial<ExcelJS.Font>
  fill: ExcelJS.Fill
} {
  return {
    font: {
      name: FS_FONT.name,
      size: FS_FONT.bodySize,
      bold: true,
      color: { argb: FS_COLORS.finalTallyText },
    },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: FS_COLORS.finalTallyFill } },
  }
}

export function fsHeaderRowStyle(): {
  font: Partial<ExcelJS.Font>
  fill: ExcelJS.Fill
  border: Partial<ExcelJS.Borders>
} {
  return {
    font: {
      name: FS_FONT.name,
      size: FS_FONT.bodySize,
      bold: true,
      color: { argb: FS_COLORS.headerText },
    },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: FS_COLORS.headerFill } },
    border: { bottom: { style: "thin", color: { argb: FS_COLORS.borderColor } } },
  }
}

export function fsFooterNoteStyle(): { font: Partial<ExcelJS.Font> } {
  return {
    font: {
      name: FS_FONT.name,
      size: FS_FONT.bodySize,
      italic: true,
      color: { argb: FS_COLORS.footerNoteText },
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience appliers — write an entire row with one style call. The caller
// has already populated the row via sheet.addRow() or similar.
// ─────────────────────────────────────────────────────────────────────────────

export function applyRowStyle(
  row: ExcelJS.Row,
  style: {
    font?: Partial<ExcelJS.Font>
    fill?: ExcelJS.Fill
    border?: Partial<ExcelJS.Borders>
  }
): void {
  if (style.font) row.font = style.font
  if (style.fill) {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = style.fill!
    })
  }
  if (style.border) row.border = style.border
}

/**
 * Merge a range across the visible width of the sheet and apply a single style.
 * Useful for title/subtitle/section-band/footer-note rows.
 */
export function mergeAndStyle(
  sheet: ExcelJS.Worksheet,
  rowNum: number,
  colCount: number,
  style: {
    font?: Partial<ExcelJS.Font>
    fill?: ExcelJS.Fill
  }
): void {
  const lastCol = String.fromCharCode(64 + colCount) // A=65, so 65+colCount-1 = lastCol
  sheet.mergeCells(`A${rowNum}:${lastCol}${rowNum}`)
  const row = sheet.getRow(rowNum)
  if (style.font) row.font = style.font
  if (style.fill) {
    row.eachCell({ includeEmpty: false }, (cell) => {
      cell.fill = style.fill!
    })
  }
}

// Style classes for ledger row coloring by deductibility character.
// Re-export-friendly so the codeFillsBySemantics module + masterLedger can
// share a single source of truth.
export const FILL_SEMANTICS = {
  // Mint = 100%-deductible meals (content meals)
  contentMeals100: "FFD5E8D4",
  // Light green = 100%-deductible write-off (general)
  writeOff100: "FFE2EFDA",
  // Light blue = 50%-deductible (meals 50%, vehicle 50%)
  partialDeduction50: "FFDDEBF7",
  // Light yellow = gray zone (needs review)
  grayZone: "FFFFF2CC",
  // Light pink = allocated portion (e.g., 65% biz / 35% personal)
  allocatedPartial: "FFEAD1DC",
  // No fill — personal / transfer / payment
  none: undefined,
} as const
