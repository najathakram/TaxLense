/**
 * TaxLens — PDF text extractor
 * Uses pdf-parse (text-selectable PDFs only).
 * Returns text + page count for router scoring (Session 9).
 * Spec §4.2: "If pdf-parse returns empty or gibberish, mark parse_status=FAILED."
 */

// pdf-parse v2 has a default export
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (
  dataBuffer: Buffer,
  options?: { max?: number }
) => Promise<{ text: string; numpages: number }>

/**
 * Extract all text + page count from a PDF buffer.
 * Returns { text: "", numpages: 0 } on error; caller routes to VISION_DOC.
 */
export async function extractPdfText(
  buffer: Buffer,
): Promise<{ text: string; numpages: number }> {
  try {
    const result = await pdfParse(buffer, { max: 0 })
    return { text: result.text ?? "", numpages: result.numpages ?? 0 }
  } catch {
    return { text: "", numpages: 0 }
  }
}

/** Convenience: page count only. */
export async function pdfPageCount(buffer: Buffer): Promise<number> {
  const { numpages } = await extractPdfText(buffer)
  return numpages
}

/** Back-compat for callers that only need a usable-text gate. */
export function isUsableText(text: string): boolean {
  return text.trim().length >= 80
}
