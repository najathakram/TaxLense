/**
 * Financial Statements CSV-bundle tests.
 *
 * Same approach as audit-packet.test.ts: inspect ZIP magic bytes + the Central
 * Directory entry names as latin1 substrings, without adding an unzipper dep.
 * Content-level checks decompress just the CSV / README / manifest entries
 * via the synchronous zlib raw-inflate path (each archiver entry uses deflate-
 * raw by default, and `archiver` writes the entry size into the local file
 * header so we can locate + inflate without a full parser).
 */

import "dotenv/config"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { inflateRawSync } from "node:zlib"
import { buildFinancialStatementsCsvZip } from "../../lib/reports/financialStatementsCsv"
import { createReportFixture, destroyReportFixture, type ReportFixture } from "./fixture"

/**
 * Walk local file headers in a ZIP buffer and return the decompressed bytes
 * for each entry. Supports stored (method 0) and deflate-raw (method 8) only —
 * both used by `archiver` for our content.
 */
function readZipEntries(buf: Buffer): Map<string, Buffer> {
  const result = new Map<string, Buffer>()
  let offset = 0
  while (offset < buf.length - 4) {
    // Local file header signature 0x04034b50
    if (buf.readUInt32LE(offset) !== 0x04034b50) {
      // Reached Central Directory or End of CD record.
      break
    }
    const compMethod = buf.readUInt16LE(offset + 8)
    const compSize = buf.readUInt32LE(offset + 18)
    const uncompSize = buf.readUInt32LE(offset + 22)
    const nameLen = buf.readUInt16LE(offset + 26)
    const extraLen = buf.readUInt16LE(offset + 28)
    const name = buf.slice(offset + 30, offset + 30 + nameLen).toString("utf8")
    const dataStart = offset + 30 + nameLen + extraLen

    let data: Buffer
    if (compMethod === 0) {
      data = buf.slice(dataStart, dataStart + compSize)
    } else if (compMethod === 8) {
      // archiver writes streamed entries with a data-descriptor; in that case
      // compSize is 0 in the local header. Fall back to a heuristic: find the
      // descriptor signature 0x08074b50 to bound the compressed data.
      let endOffset = dataStart + compSize
      if (compSize === 0) {
        const descSig = 0x08074b50
        let scan = dataStart
        while (scan < buf.length - 16) {
          if (buf.readUInt32LE(scan) === descSig) break
          scan++
        }
        endOffset = scan
      }
      try {
        data = inflateRawSync(buf.slice(dataStart, endOffset))
      } catch {
        data = Buffer.alloc(0)
      }
    } else {
      data = Buffer.alloc(0)
    }
    result.set(name, data)

    // Advance past the entry. If we used a data descriptor, compSize was 0 so
    // we need to scan to next local-file-header signature.
    if (compSize === 0 && compMethod === 8) {
      // Skip data + 16-byte data descriptor
      let scan = dataStart
      while (scan < buf.length - 4) {
        if (buf.readUInt32LE(scan) === 0x04034b50) break
        scan++
      }
      offset = scan
    } else {
      offset = dataStart + compSize
    }
    if (uncompSize === 0 && compSize === 0) break
  }
  return result
}

describe("buildFinancialStatementsCsvZip", () => {
  let fix: ReportFixture
  let buf: Buffer

  beforeAll(async () => {
    fix = await createReportFixture()
    buf = await buildFinancialStatementsCsvZip(fix.taxYearId)
  })

  afterAll(async () => {
    await destroyReportFixture(fix)
  })

  it("returns a non-empty ZIP Buffer", () => {
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.length).toBeGreaterThan(1000)
    // ZIP magic
    expect(buf[0]).toBe(0x50) // 'P'
    expect(buf[1]).toBe(0x4b) // 'K'
  })

  it("Central Directory lists README, manifest, and numbered CSVs", () => {
    const cd = buf.toString("latin1")
    expect(cd).toContain("00_README.md")
    expect(cd).toContain("manifest.json")
    expect(cd).toContain("01_general_ledger.csv")
    expect(cd).toContain("03_p_and_l.csv") // P&L sheet → safeFilename → "p_and_l"
    expect(cd).toContain("04_balance_sheet.csv")
    // 02_ and 05_ vary by entity type (Schedule C vs Form 1120-S etc.) —
    // assert the prefix shape only.
    expect(cd).toMatch(/02_[a-z0-9_]+\.csv/)
    expect(cd).toMatch(/05_[a-z0-9_]+\.csv/)
  })

  it("manifest.json is valid JSON with the expected shape", () => {
    const entries = readZipEntries(buf)
    const manifestBuf = entries.get("manifest.json")
    expect(manifestBuf).toBeTruthy()
    expect(manifestBuf!.length).toBeGreaterThan(0)
    const data = JSON.parse(manifestBuf!.toString("utf8"))
    expect(data.taxYear).toBe(2024)
    expect(data.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(Array.isArray(data.sheets)).toBe(true)
    expect(data.sheets).toHaveLength(5)
    for (const s of data.sheets) {
      expect(s.filename).toMatch(/\.csv$/)
      expect(typeof s.sheetName).toBe("string")
      expect(typeof s.rowCount).toBe("number")
    }
  })

  it("README.md is human-readable and references the snapshot hash", () => {
    const entries = readZipEntries(buf)
    const readme = entries.get("00_README.md")
    expect(readme).toBeTruthy()
    const text = readme!.toString("utf8")
    expect(text).toMatch(/Financial Statements/i)
    expect(text).toMatch(/snapshot hash/i)
  })

  it("01_general_ledger.csv has a header row with expected columns", () => {
    const entries = readZipEntries(buf)
    const gl = entries.get("01_general_ledger.csv")
    expect(gl).toBeTruthy()
    const firstLine = gl!.toString("utf8").split(/\r?\n/)[0]
    expect(firstLine).toMatch(/Date/)
    expect(firstLine).toMatch(/Account/)
    expect(firstLine).toMatch(/Merchant/)
    expect(firstLine).toMatch(/Deductible/)
  })

  it("CSV values are RFC-4180 escaped (no orphaned quotes per line)", () => {
    const entries = readZipEntries(buf)
    const gl = entries.get("01_general_ledger.csv")!
    const lines = gl.toString("utf8").split(/\r?\n/)
    for (const ln of lines) {
      const quoteCount = (ln.match(/"/g) || []).length
      expect(quoteCount % 2).toBe(0)
    }
  })

  it("CSV uses CRLF line endings (RFC 4180)", () => {
    const entries = readZipEntries(buf)
    const gl = entries.get("01_general_ledger.csv")!
    const text = gl.toString("utf8")
    expect(text).toContain("\r\n")
  })
})
