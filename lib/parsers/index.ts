/**
 * TaxLens — Statement parser dispatcher
 *
 * parseStatement(buffer, filename) → ParseResult
 *
 * Routing logic:
 *  1. OFX/QFX file extension or OFX header in text → ofx-generic
 *  2. PDF → extractPdfText → (currently no PDF institution parsers in V1; returns FAILED)
 *  3. CSV → extractCsvRows → detectInstitution → dispatchCsvParse
 *
 * Spec §4.2: parse_status = FAILED if pdf-parse returns empty/gibberish text.
 */

import { extractPdfText, isUsableText } from "./pdf-extractor"
import { extractCsvRows } from "./csv-extractor"
import { detectInstitution, dispatchCsvParse } from "./institutions"
import { parseOfxGeneric } from "./institutions/ofx-generic"
import type { ParseResult } from "./types"

export type { ParseResult, RawTx } from "./types"
export { fileHash, transactionKey } from "./dedup"

/** File type resolved from extension + content sniffing */
type FileType = "pdf" | "csv" | "ofx" | "unknown"

function resolveFileType(filename: string, buffer: Buffer): FileType {
  const lower = filename.toLowerCase()
  if (lower.endsWith(".pdf")) return "pdf"
  if (lower.endsWith(".ofx") || lower.endsWith(".qfx")) return "ofx"
  if (lower.endsWith(".csv")) return "csv"

  // Content sniff: OFX marker in first 512 bytes
  const head = buffer.slice(0, 512).toString("utf8")
  const upper = head.toUpperCase()
  if (upper.includes("OFXHEADER") || upper.includes("<OFX>") || upper.includes("<STMTTRN>")) {
    return "ofx"
  }

  // Content sniff: PDF magic bytes
  if (buffer.slice(0, 4).toString("ascii") === "%PDF") return "pdf"

  // Assume CSV for anything else
  return "csv"
}

/**
 * Main entry point.
 * Parses any supported statement file and returns a normalised ParseResult.
 *
 * @param buffer   Raw file bytes
 * @param filename Original filename (used for type detection)
 */
export async function parseStatement(
  buffer: Buffer,
  filename: string,
): Promise<ParseResult> {
  const fileType = resolveFileType(filename, buffer)

  // ── OFX / QFX ──────────────────────────────────────────────────────────────
  if (fileType === "ofx") {
    const text = buffer.toString("utf8")
    return parseOfxGeneric(text)
  }

  // ── PDF ────────────────────────────────────────────────────────────────────
  if (fileType === "pdf") {
    const text = await extractPdfText(buffer)
    if (!isUsableText(text)) {
      return {
        ok: false,
        error: "PDF appears to be scanned or encrypted — no extractable text",
        institution: undefined,
        transactions: [],
        totalInflows: 0,
        totalOutflows: 0,
        reconciliation: { ok: false },
        parseConfidence: 0,
      }
    }

    // V1: no PDF institution parsers yet — return structured failure
    // (PDF parsing is a V2+ feature; users must use CSV exports for now)
    return {
      ok: false,
      error: "PDF text extraction succeeded but no PDF parser is implemented for this institution in V1. Please export as CSV.",
      institution: undefined,
      transactions: [],
      totalInflows: 0,
      totalOutflows: 0,
      reconciliation: { ok: false },
      parseConfidence: 0,
    }
  }

  // ── CSV ────────────────────────────────────────────────────────────────────
  const text = buffer.toString("utf8")
  const { headers, rows } = extractCsvRows(text)

  if (rows.length === 0) {
    return {
      ok: false,
      error: "CSV file is empty or contains only headers",
      institution: undefined,
      transactions: [],
      totalInflows: 0,
      totalOutflows: 0,
      reconciliation: { ok: true },
      parseConfidence: 0,
    }
  }

  const institution = detectInstitution(headers, text)
  return dispatchCsvParse(institution, rows, headers)
}
