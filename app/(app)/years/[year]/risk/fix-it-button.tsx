"use client"

/**
 * Phase J — one-click 'Fix it' deep-links per blocking risk signal.
 * Each signal ID maps to the page where the CPA can resolve it. The
 * mapping below is intentionally explicit (not regex-derived) so future
 * signals MUST be added here — surfaces them as "no fix-it action" if
 * we forget rather than failing silently.
 */

import Link from "next/link"
import { Button } from "@/components/ui/button"

interface FixAction {
  href: (year: number) => string
  label: string
}

const FIX_MAP: Record<string, FixAction> = {
  // A07 unpaired transfers — go to the pipeline so the user can re-run
  // matchTransfers (which now handles money-mover wallets per Phase 1.2).
  A07: { href: (y) => `/years/${y}/pipeline`, label: "Re-run transfer pairing" },
  // A13 deposits reconstruction — STOPs page deposits queue.
  A13: { href: (y) => `/years/${y}/stops?cat=DEPOSIT`, label: "Resolve deposits" },
  // A14 coverage gaps — Coverage page where the CPA can attest months.
  A14: { href: (y) => `/years/${y}/coverage`, label: "Attest inactive months" },
  // A01 unclassified txns — Pipeline (run agent or apply rules).
  A01: { href: (y) => `/years/${y}/pipeline`, label: "Run pipeline" },
  // A08 missing meal substantiation — STOPs §274(d) tab.
  A08: { href: (y) => `/years/${y}/stops?cat=SECTION_274D`, label: "Add meal substantiation" },
  // A05 / A06 misclassified PERSONAL/PAYMENT with biz pct — ledger filter.
  A05: { href: (y) => `/years/${y}/ledger?code=PERSONAL`, label: "Review PERSONAL rows" },
  A06: { href: (y) => `/years/${y}/ledger?code=PAYMENT`, label: "Review PAYMENT rows" },
  // A10 out-of-year txns — ledger with date filter.
  A10: { href: (y) => `/years/${y}/ledger`, label: "Review out-of-year txns" },
  // A09 §274(d) tier — STOPs.
  A09: { href: (y) => `/years/${y}/stops?cat=SECTION_274D`, label: "Bump §274(d) evidence" },
  // Critical signals from computeRiskScore
  UNCLASSIFIED_DEPOSITS: { href: (y) => `/years/${y}/stops?cat=DEPOSIT`, label: "Resolve deposits queue" },
  NEEDS_CONTEXT_HEAVY: { href: (y) => `/years/${y}/stops`, label: "Resolve STOPs queue" },
  PENDING_STOPS: { href: (y) => `/years/${y}/stops`, label: "Open STOPs queue" },
  MEAL_SUB_MISSING: { href: (y) => `/years/${y}/stops?cat=SECTION_274D`, label: "Add meal substantiation" },
  VEHICLE_PCT_HIGH: {
    href: (y) => `/years/${y}/ledger?code=WRITE_OFF_TRAVEL`,
    label: "Review vehicle classifications",
  },
  LINE_27A_HEAVY: { href: (y) => `/years/${y}/ledger?line=Line+27a`, label: "Review Line 27a Other" },
  COGS_OVERSTATED: {
    href: (y) => `/years/${y}/pipeline`,
    label: "Re-run pipeline (money-mover sweep)",
  },
}

export function FixItButton({ year, signalId }: { year: number; signalId: string }) {
  const action = FIX_MAP[signalId]
  if (!action) return null
  return (
    <Link href={action.href(year)}>
      <Button size="sm" variant="outline" className="text-xs">
        {action.label} →
      </Button>
    </Link>
  )
}

export const FIX_IT_AVAILABLE_FOR = new Set(Object.keys(FIX_MAP))
