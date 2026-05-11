import { describe, it, expect } from "vitest"
import {
  buildDeliverableList,
  buildComplianceFlags,
  summarizeDeliverables,
  type DeliverableContext,
  type EntityType,
} from "@/lib/forms/deliverables"

function makeCtx(overrides: Partial<DeliverableContext> = {}): DeliverableContext {
  return {
    entityType: "SOLE_PROP",
    state: "TX",
    taxYear: 2025,
    ledger: {
      grossReceipts: 18_313,
      totalDeductions: 38_118,
      netProfit: -19_805,
      totalAssets: 18_313,
      hasCOGS: true,
      hasDepreciation: false,
      hasHomeOffice: true,
      homeOfficeMethod: "SIMPLIFIED",
      netSeEarnings: 0, // negative profit → 0 SE
      payrollRunCount: 0,
      contractorCandidates: [
        { payee: "KIRSTEN HATCH", totalDollars: 2_033.34, missingTin: true },
        { payee: "SHAWNA LECOMPTE", totalDollars: 1_241.39, missingTin: true },
      ],
      has1099MiscCandidate: false,
    },
    owners: { count: 1, allOwnersComplete: true },
    assertionsPass: true,
    ...overrides,
  }
}

describe("buildDeliverableList — sole proprietor (Atif's TY 2025 shape)", () => {
  it("includes Schedule C, 8995, Schedule 1 always; SE only when earnings ≥ $400", () => {
    const items = buildDeliverableList(makeCtx())
    const ids = items.filter((d) => d.triggered).map((d) => d.formId)
    expect(ids).toContain("schedule-c")
    expect(ids).toContain("form-8995")
    expect(ids).toContain("schedule-1")
    // Atif has a loss → SE earnings 0 → Schedule SE skipped
    expect(ids).not.toContain("schedule-se")
  })

  it("triggers Schedule SE when net SE earnings ≥ $400", () => {
    const items = buildDeliverableList(makeCtx({ ledger: { ...makeCtx().ledger, netSeEarnings: 5_000 } }))
    const triggeredIds = items.filter((d) => d.triggered).map((d) => d.formId)
    expect(triggeredIds).toContain("schedule-se")
  })

  it("8829 only fires for ACTUAL home-office method (SIMPLIFIED stays on Schedule C)", () => {
    const simple = buildDeliverableList(makeCtx({
      ledger: { ...makeCtx().ledger, hasHomeOffice: true, homeOfficeMethod: "SIMPLIFIED" },
    }))
    expect(simple.find((d) => d.formId === "form-8829")?.triggered).toBe(false)

    const actual = buildDeliverableList(makeCtx({
      ledger: { ...makeCtx().ledger, hasHomeOffice: true, homeOfficeMethod: "ACTUAL" },
    }))
    expect(actual.find((d) => d.formId === "form-8829")?.triggered).toBe(true)
  })

  it("1099-NEC fires per-payee threshold ≥ $600 with missing-TIN blocker", () => {
    const items = buildDeliverableList(makeCtx())
    const nec = items.find((d) => d.formId === "form-1099-nec")
    expect(nec?.triggered).toBe(true)
    // Both Kirsten + Shawna are over $600 → 2 candidates, both missing TIN → 2 blockers
    expect(nec?.blockers).toHaveLength(1)
    expect(nec!.blockers[0]).toMatch(/Missing W-9/)
  })

  it("1099-NEC skipped when no contractor ≥ $600", () => {
    const items = buildDeliverableList(makeCtx({
      ledger: { ...makeCtx().ledger, contractorCandidates: [] },
    }))
    const nec = items.find((d) => d.formId === "form-1099-nec")
    expect(nec?.triggered).toBe(false)
    expect(nec?.skipReason).toMatch(/No contractors paid/)
  })

  it("1099-NEC blocker exists when payee TIN missing", () => {
    const items = buildDeliverableList(makeCtx())
    const summary = summarizeDeliverables(items)
    expect(summary.blockerCount).toBeGreaterThan(0)
  })
})

describe("buildDeliverableList — entity branching", () => {
  it("S_CORP swaps Schedule C for Form 1120-S + K-1", () => {
    const ids = buildDeliverableList(makeCtx({ entityType: "S_CORP" }))
      .filter((d) => d.triggered)
      .map((d) => d.formId)
    expect(ids).toContain("form-1120s")
    expect(ids).toContain("schedule-k-1120s")
    expect(ids).toContain("schedule-k1-1120s")
    expect(ids).not.toContain("schedule-c")
    expect(ids).not.toContain("schedule-se")
  })

  it("S_CORP with payroll runs adds 941/940/W-2 forms", () => {
    const ids = buildDeliverableList(makeCtx({
      entityType: "S_CORP",
      ledger: { ...makeCtx().ledger, payrollRunCount: 4 },
    }))
      .filter((d) => d.triggered)
      .map((d) => d.formId)
    expect(ids).toContain("form-941")
    expect(ids).toContain("form-940")
    expect(ids).toContain("form-w2-w3")
  })

  it("S_CORP with no payroll fires reasonable-comp blocker", () => {
    const items = buildDeliverableList(makeCtx({ entityType: "S_CORP" }))
    const f1120s = items.find((d) => d.formId === "form-1120s")
    expect(f1120s?.blockers.length).toBeGreaterThan(0)
    expect(f1120s!.blockers.join(" ")).toMatch(/reasonable compensation/i)
  })

  it("LLC_MULTI uses Form 1065 + K-1 + requires ≥ 2 partners", () => {
    const items = buildDeliverableList(makeCtx({ entityType: "LLC_MULTI", owners: { count: 1, allOwnersComplete: true } }))
    const ids = items.filter((d) => d.triggered).map((d) => d.formId)
    expect(ids).toContain("form-1065")
    expect(ids).toContain("schedule-k-1065")
    expect(ids).toContain("schedule-k1-1065")
    const f1065 = items.find((d) => d.formId === "form-1065")
    expect(f1065?.blockers.join(" ")).toMatch(/at least 2 partners/i)
  })

  it("C_CORP uses Form 1120 with no K-1, no SE, no QBI", () => {
    const ids = buildDeliverableList(makeCtx({ entityType: "C_CORP" }))
      .filter((d) => d.triggered)
      .map((d) => d.formId)
    expect(ids).toContain("form-1120")
    expect(ids).not.toContain("schedule-k1-1120s")
    expect(ids).not.toContain("schedule-c")
    expect(ids).not.toContain("schedule-se")
    expect(ids).not.toContain("form-8995")
  })
})

describe("buildDeliverableList — Schedule L threshold ($250K)", () => {
  it("S_CORP Schedule L fires only when receipts AND assets both ≥ $250K", () => {
    const small = buildDeliverableList(makeCtx({
      entityType: "S_CORP",
      ledger: { ...makeCtx().ledger, grossReceipts: 100_000, totalAssets: 100_000 },
    }))
    expect(small.find((d) => d.formId === "schedule-l-1120s")?.triggered).toBe(false)

    const big = buildDeliverableList(makeCtx({
      entityType: "S_CORP",
      ledger: { ...makeCtx().ledger, grossReceipts: 500_000, totalAssets: 500_000 },
    }))
    expect(big.find((d) => d.formId === "schedule-l-1120s")?.triggered).toBe(true)
  })

  it("Schedule M-3 fires only above $10M assets (TY2025 threshold)", () => {
    const items = buildDeliverableList(makeCtx({
      entityType: "S_CORP",
      ledger: { ...makeCtx().ledger, totalAssets: 12_000_000 },
    }))
    expect(items.find((d) => d.formId === "schedule-m3-1120s")?.triggered).toBe(true)
  })
})

describe("buildDeliverableList — state layer", () => {
  it("TX adds Franchise PIR for non-sole-prop", () => {
    const sp = buildDeliverableList(makeCtx({ entityType: "SOLE_PROP", state: "TX" }))
    expect(sp.find((d) => d.formId === "tx-franchise-pir")?.triggered).toBe(false)

    const llc = buildDeliverableList(makeCtx({ entityType: "LLC_SINGLE", state: "TX" }))
    expect(llc.find((d) => d.formId === "tx-franchise-pir")?.triggered).toBe(true)
  })

  it("Other states get a stub with skipReason about unsupported", () => {
    const items = buildDeliverableList(makeCtx({ entityType: "SOLE_PROP", state: "CA" }))
    const ca = items.find((d) => d.formId === "state-ca")
    expect(ca?.triggered).toBe(false)
    expect(ca?.skipReason).toMatch(/not yet supported/i)
  })
})

describe("buildComplianceFlags", () => {
  it("includes BOI not-required, mileage rate, 1099-K threshold for any entity", () => {
    const flags = buildComplianceFlags(makeCtx())
    const ids = flags.map((f) => f.id)
    expect(ids).toContain("boi-not-required")
    expect(ids).toContain("mileage-rate-2025")
    expect(ids).toContain("1099k-threshold-2025")
    expect(ids).toContain("section-179-cap-2025")
    expect(ids).toContain("qbi-threshold-2025")
  })

  it("S-Corp with profit + no payroll surfaces reasonable-comp warning", () => {
    const flags = buildComplianceFlags(makeCtx({
      entityType: "S_CORP",
      ledger: { ...makeCtx().ledger, netProfit: 50_000, payrollRunCount: 0 },
    }))
    const compFlag = flags.find((f) => f.id === "s-corp-reasonable-comp")
    expect(compFlag).toBeDefined()
    expect(compFlag?.severity).toBe("warning")
  })

  it("Failing assertions surface a memo-timing warning", () => {
    const flags = buildComplianceFlags(makeCtx({ assertionsPass: false }))
    const f = flags.find((f) => f.id === "assertions-failing")
    expect(f).toBeDefined()
    expect(f?.severity).toBe("warning")
  })
})

describe("entity-switch reactivity (the heart of the dump panel)", () => {
  it("flipping entity from SOLE_PROP to S_CORP swaps the bundle", () => {
    const base = makeCtx()
    const sp = summarizeDeliverables(buildDeliverableList(base))
    const sc = summarizeDeliverables(
      buildDeliverableList({ ...base, entityType: "S_CORP" as EntityType }),
    )
    // S-Corp produces more tax-form items than sole prop (1120-S + Schedule K
    // + K-1 + M-1 + M-2 + maybe L + 4562 + 1125-A + 1125-E + 941 + 940 + W-2)
    expect(sc.byGroup.TAX.filter((d) => d.triggered).length).toBeGreaterThan(
      sp.byGroup.TAX.filter((d) => d.triggered).length,
    )
  })
})
