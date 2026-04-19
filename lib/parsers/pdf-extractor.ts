/**
 * TaxLens — PDF text extractor
 * Uses pdf-parse (text-selectable PDFs only).
 * Returns empty string for scanned/image PDFs — caller marks FAILED.
 * Spec §4.2: "If pdf-parse returns empty or gibberish, mark parse_status=FAILED."
 */

// pdf-parse v2 has a default export
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (
  dataBuffer: Buffer,
  options?: { max?: number }
) => Promise<{ text: string; numpages: number }>

/**
 * Extract all text from a PDF buffer.
 * Returns empty string on error (caller decides what to do).
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const result = await pdfParse(buffer, { max: 0 }) // max:0 = all pages
    return result.text ?? ""
  } catch {
    return ""
  }
}

/** Heuristic: fewer than 80 chars almost certainly means scanned / encrypted. */
export function isUsableText(text: string): boolean {
  return text.trim().length >= 80
}
