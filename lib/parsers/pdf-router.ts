/**
 * PDF routing (Session 9 §A.1).
 *
 * Scores raw pdf-parse output and decides whether to:
 *  - use the text as-is (PDF_PARSE) — reserved for institutions with deterministic
 *    PDF parsers; none in V1, so this branch is currently unused from index.ts
 *  - cleanup noisy but present text via Haiku (HAIKU_CLEANUP)
 *  - send the PDF itself to Claude as a document block (VISION_DOC) for
 *    scanned / image-only statements
 *
 * Heuristic is deterministic and testable in isolation — see pdf-router.test.ts.
 */

import type { ExtractionPath } from "@/app/generated/prisma/client"

export interface PdfScore {
  charsPerPage: number
  dateHits: number
  dollarHits: number
  ratioAlnum: number
  numpages: number
}

const DATE_RE = /\b\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?\b/g
const DOLLAR_RE = /(?:\$|USD\s*)?\d{1,3}(?:,\d{3})*\.\d{2}\b/g

export function scorePdfText(text: string, numpages: number): PdfScore {
  const totalLen = text.length
  const safePages = Math.max(1, numpages || 1)
  const charsPerPage = totalLen / safePages

  const dateHits = (text.match(DATE_RE) || []).length
  const dollarHits = (text.match(DOLLAR_RE) || []).length

  let alnum = 0
  for (let i = 0; i < totalLen; i++) {
    const c = text.charCodeAt(i)
    // 0-9, A-Z, a-z
    if (
      (c >= 48 && c <= 57) ||
      (c >= 65 && c <= 90) ||
      (c >= 97 && c <= 122)
    ) {
      alnum++
    }
  }
  const ratioAlnum = totalLen > 0 ? alnum / totalLen : 0

  return { charsPerPage, dateHits, dollarHits, ratioAlnum, numpages }
}

export type PdfRoutingPath = Extract<
  ExtractionPath,
  "PDF_PARSE" | "HAIKU_CLEANUP" | "VISION_DOC"
>

/**
 * Decide which extractor to use based on the pdf-parse output score.
 * Order of checks matches the plan in Session 9 §A.1.
 */
export function routePdf(score: PdfScore): PdfRoutingPath {
  if (score.numpages === 0) return "VISION_DOC"
  if (score.charsPerPage < 200) return "VISION_DOC"
  if (score.dateHits < 5 || score.dollarHits < 5) return "VISION_DOC"
  if (score.ratioAlnum < 0.55) return "HAIKU_CLEANUP"
  // Text is clean enough for a deterministic institution parser. None ship in V1;
  // Haiku handles clean text too (just cheaper inputs).
  return "HAIKU_CLEANUP"
}
