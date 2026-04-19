/**
 * TaxLens — CSV row extractor
 * Uses papaparse with header detection.
 */

import Papa from "papaparse"

export type CsvRows = {
  headers: string[]
  rows: Record<string, string>[]
}

/**
 * Parse CSV text into header-keyed rows.
 * Skips completely empty rows.
 */
export function extractCsvRows(text: string): CsvRows {
  const result = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    transform: (v) => v.trim(),
  })

  const headers = result.meta.fields ?? []
  const rows = (result.data ?? []).filter(
    (row) => Object.values(row).some((v) => v !== ""),
  )

  return { headers, rows }
}

/** Parse a dollar string like "$1,234.56" or "-1234.56" → number */
export function parseDollar(raw: string): number | null {
  if (!raw) return null
  const cleaned = raw.replace(/[$,\s]/g, "")
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

/** Parse a date string in M/D/YYYY or YYYY-MM-DD format → Date | null */
export function parseDateFlex(raw: string): Date | null {
  if (!raw) return null
  // Try ISO first
  const iso = new Date(raw)
  if (!isNaN(iso.getTime()) && raw.includes("-")) return iso
  // M/D/YYYY
  const mdyMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdyMatch) {
    const [, m, d, y] = mdyMatch
    return new Date(Number(y), Number(m) - 1, Number(d))
  }
  return null
}
