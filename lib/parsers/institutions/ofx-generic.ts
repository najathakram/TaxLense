/**
 * OFX / QFX generic parser
 *
 * Sign convention in source: TRNAMT is signed — positive = credit/inflow, negative = debit/outflow
 * Normalisation: amountNormalized = -trnamt
 * (outflows become +, inflows become −)
 *
 * Supports both SGML-style OFX (1.x) and XML-style OFX (2.x / QFX).
 * Text-extraction only — no full OFX library to keep the bundle small.
 *
 * Key tags parsed:
 *   <DTPOSTED>  — posted date (YYYYMMDD or YYYYMMDDHHMMSS)
 *   <DTUSER>    — user/transaction date (optional)
 *   <TRNAMT>    — signed amount
 *   <NAME>      — merchant/payee name
 *   <MEMO>      — additional description
 *   <FITID>     — institution transaction ID (ignored in normalisation; for reference only)
 */

import type { RawTx, ParseResult } from "../types"

/** Extract all tag values for a given tag name (case-insensitive) */
function extractAll(text: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([^<\r\n]+)`, "gi")
  const matches: string[] = []
  for (const m of text.matchAll(re)) {
    matches.push(m[1].trim())
  }
  return matches
}

/** Parse OFX date: YYYYMMDD[HHMMSS[.mmm][±HH:MM]] → Date | null */
function parseOfxDate(raw: string): Date | null {
  if (!raw) return null
  const digits = raw.replace(/[^0-9]/g, "").padEnd(8, "0")
  const y = parseInt(digits.slice(0, 4), 10)
  const mo = parseInt(digits.slice(4, 6), 10) - 1
  const d = parseInt(digits.slice(6, 8), 10)
  if (isNaN(y) || isNaN(mo) || isNaN(d)) return null
  return new Date(y, mo, d)
}

/**
 * Parse all <STMTTRN>...</STMTTRN> blocks from OFX text.
 * Works for both SGML (unclosed tags) and XML (closed tags).
 */
function extractTrnBlocks(text: string): string[] {
  const blocks: string[] = []
  // XML-style: <STMTTRN>...</STMTTRN>
  const xmlRe = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi
  for (const m of text.matchAll(xmlRe)) {
    blocks.push(m[1])
  }
  if (blocks.length > 0) return blocks

  // SGML-style: <STMTTRN> ... <STMTTRN> (next block = end of previous)
  const sgmlRe = /<STMTTRN>([\s\S]*?)(?=<STMTTRN>|<\/BANKTRANLIST>|<\/INVTRANLIST>|$)/gi
  for (const m of text.matchAll(sgmlRe)) {
    const block = m[1].trim()
    if (block) blocks.push(block)
  }
  return blocks
}

export function parseOfxGeneric(text: string): ParseResult {
  const blocks = extractTrnBlocks(text)

  if (blocks.length === 0) {
    return {
      ok: false,
      error: "No <STMTTRN> blocks found in OFX content",
      institution: "ofx-generic",
      transactions: [],
      totalInflows: 0,
      totalOutflows: 0,
      reconciliation: { ok: true },
      parseConfidence: 0,
    }
  }

  const transactions: RawTx[] = []
  const errors: string[] = []

  for (const [i, block] of blocks.entries()) {
    const postedVals = extractAll(block, "DTPOSTED")
    const userVals = extractAll(block, "DTUSER")
    const amtVals = extractAll(block, "TRNAMT")
    const nameVals = extractAll(block, "NAME")
    const memoVals = extractAll(block, "MEMO")

    const postedRaw = postedVals[0] ?? ""
    const amtRaw = amtVals[0] ?? ""
    const nameRaw = nameVals[0] ?? ""
    const memoRaw = memoVals[0] ?? ""

    const postedDate = parseOfxDate(postedRaw)
    if (!postedDate) { errors.push(`Block ${i + 1}: invalid DTPOSTED "${postedRaw}"`); continue }

    const transactionDate = userVals[0] ? (parseOfxDate(userVals[0]) ?? undefined) : undefined

    const trnamt = parseFloat(amtRaw)
    if (isNaN(trnamt)) { errors.push(`Block ${i + 1}: invalid TRNAMT "${amtRaw}"`); continue }

    const amountOriginal = trnamt
    // OFX: positive = credit/inflow → flip to inflow (−); negative = debit/outflow → flip to outflow (+)
    const amountNormalized = -trnamt

    const merchantRaw = nameRaw || memoRaw || "UNKNOWN"

    transactions.push({
      postedDate,
      transactionDate,
      amountOriginal,
      amountNormalized,
      merchantRaw,
      descriptionRaw: memoRaw || undefined,
    })
  }

  if (transactions.length === 0) {
    return {
      ok: false,
      error: errors[0] ?? "No transactions parsed from OFX blocks",
      institution: "ofx-generic",
      transactions: [],
      totalInflows: 0,
      totalOutflows: 0,
      reconciliation: { ok: true },
      parseConfidence: 0,
    }
  }

  const dates = transactions.map((t) => t.postedDate.getTime())
  const totalOutflows = transactions.reduce((s, t) => s + Math.max(0, t.amountNormalized), 0)
  const totalInflows = transactions.reduce((s, t) => s + Math.abs(Math.min(0, t.amountNormalized)), 0)

  return {
    ok: true,
    institution: "ofx-generic",
    periodStart: new Date(Math.min(...dates)),
    periodEnd: new Date(Math.max(...dates)),
    transactions,
    totalInflows,
    totalOutflows,
    reconciliation: { ok: true },
    parseConfidence: errors.length === 0 ? 0.9 : 0.65,
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
  }
}
