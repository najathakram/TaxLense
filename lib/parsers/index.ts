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

import Anthropic from "@anthropic-ai/sdk"
import { extractPdfText, pdfPageCount } from "./pdf-extractor"
import { extractCsvRows } from "./csv-extractor"
import { detectInstitution, dispatchCsvParse } from "./institutions"
import { parseOfxGeneric } from "./institutions/ofx-generic"
import { routePdf, scorePdfText, type PdfRoutingPath } from "./pdf-router"
import { extractViaHaikuCleanup } from "./haiku-cleanup"
import { extractViaVisionDoc } from "./vision-doc"
import type { ParseResult } from "./types"
import type { ExtractorTelemetry } from "./haiku-cleanup"

export type { ParseResult, RawTx } from "./types"
export { fileHash, transactionKey } from "./dedup"
export type { ExtractorTelemetry } from "./haiku-cleanup"

/**
 * Partition raw transactions by tax year. Used at upload time to prevent
 * out-of-year rows leaking into a TaxYear (assertion A10 YEAR_BOUNDARY).
 *
 * Year is determined by `postedDate.getUTCFullYear()` to match A10's check.
 * Statements that span a year boundary (e.g. Dec→Jan PDFs) typically contain
 * rows for both years; only the in-year rows belong in this TaxYear.
 */
export function partitionByTaxYear<T extends { postedDate: Date }>(
  txns: T[],
  year: number,
): { inYear: T[]; outOfYear: T[] } {
  const inYear: T[] = []
  const outOfYear: T[] = []
  for (const tx of txns) {
    if (tx.postedDate.getUTCFullYear() === year) {
      inYear.push(tx)
    } else {
      outOfYear.push(tx)
    }
  }
  return { inYear, outOfYear }
}

export interface ParseStatementOptions {
  /** Override the default AI client (for tests). */
  anthropicClient?: Anthropic
  /** Rate limit hook: called per AI API call; throw to abort. */
  onAiCall?: () => Promise<void> | void
}

/**
 * Extended parse result carrying extraction telemetry for StatementImport.
 */
export interface ExtendedParseResult extends ParseResult {
  extractionPath?: PdfRoutingPath | "CSV" | "OFX"
  extractionTelemetry?: ExtractorTelemetry
}

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
  options: ParseStatementOptions = {},
): Promise<ExtendedParseResult> {
  const fileType = resolveFileType(filename, buffer)

  // ── OFX / QFX ──────────────────────────────────────────────────────────────
  if (fileType === "ofx") {
    const text = buffer.toString("utf8")
    const result = parseOfxGeneric(text)
    return { ...result, extractionPath: "OFX" }
  }

  // ── PDF ────────────────────────────────────────────────────────────────────
  if (fileType === "pdf") {
    const { text, numpages } = await extractPdfText(buffer)
    const score = scorePdfText(text, numpages)
    const route = routePdf(score)

    // Rate-limit gate — increment before any AI call
    if (options.onAiCall) await options.onAiCall()

    const { parseResult, telemetry } =
      route === "VISION_DOC"
        ? await extractViaVisionDoc(buffer, options.anthropicClient)
        : await extractViaHaikuCleanup(text, options.anthropicClient)

    return {
      ...parseResult,
      extractionPath: route,
      extractionTelemetry: telemetry,
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
      extractionPath: "CSV",
    }
  }

  const institution = detectInstitution(headers, text)
  const result = dispatchCsvParse(institution, rows, headers)
  return { ...result, extractionPath: "CSV" }
}

/** Kept exported for tests. */
export { pdfPageCount }
