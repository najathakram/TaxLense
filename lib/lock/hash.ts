/**
 * Deterministic ledger snapshot hash for lock (spec §4.7).
 *
 * The hash is a SHA-256 over a canonical JSON representation of the ledger:
 * every non-split transaction + its current classification, sorted by txn id.
 * Enables reproducibility — a locked year produces the same hash on re-run.
 */

import { createHash } from "node:crypto"
import { prisma } from "@/lib/db"

export async function computeLedgerHash(taxYearId: string): Promise<string> {
  const rows = await prisma.transaction.findMany({
    where: { taxYearId, isSplit: false },
    orderBy: { id: "asc" },
    include: { classifications: { where: { isCurrent: true }, take: 1 } },
  })

  const canonical = rows.map((r) => {
    const c = r.classifications[0]
    return {
      id: r.id,
      postedDate: r.postedDate.toISOString().slice(0, 10),
      amountNormalized: Number(r.amountNormalized).toFixed(2),
      merchantNormalized: r.merchantNormalized,
      code: c?.code ?? null,
      scheduleCLine: c?.scheduleCLine ?? null,
      businessPct: c?.businessPct ?? null,
      evidenceTier: c?.evidenceTier ?? null,
      ircCitations: c?.ircCitations ?? [],
    }
  })

  const json = JSON.stringify(canonical)
  return createHash("sha256").update(json).digest("hex")
}
