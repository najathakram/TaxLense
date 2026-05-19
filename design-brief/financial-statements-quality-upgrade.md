# Financial Statements Quality Upgrade

## Source

Reference workbook from a manually-prepared LLC filing:
`C:\Users\nakram\Downloads\Tax2025\To MJ\MaznahMediaGroup_FinancialStatements_2025_v2.xlsx`

Taxpayer: Maznah Media Group LLC (single-member LLC, Sole Proprietorship for tax) — Tax Year 2025 — photography/content business

User intent: "the quality of the final csv file I would like to have... I want the TaxLens to dump a similar file depending on the business type."

---

## Sheet inventory (matches TaxLens current output structure)

| # | Sheet | Rows × Cols | Purpose |
|---|---|---|---|
| 1 | General Ledger | 723 × 10 | Every transaction with full CPA context |
| 2 | Schedule C | 41 × 5 | IRS line-by-line, with sub-detail per line |
| 3 | Profit & Loss Statement | 55 × 5 | Operating-category P&L (NOT line-by-line) |
| 4 | Balance Sheet | 44 × 5 | Assets + Liabilities + Owner's Equity (per-owner) |
| 5 | Schedule C — Detail | 755 × 8 | Transactions grouped under each Sch C line with SUM formulas |

TaxLens already produces these 5 sheets via `lib/reports/financialStatements.ts` + `lib/reports/masterLedger.ts`. The gap is **content quality and formatting**, not sheet count.

---

## Visual design system (extracted from the reference)

### Color palette
| Use | Hex | Where |
|---|---|---|
| Title text | `#1F4E79` (dark navy) | A1 (Sch C, BS), 14pt bold Arial |
| Subtitle text | `#4472C4` (medium blue) | A2, 11pt italic Arial |
| Section header — Income | `#1F4E79` fill + WHITE text | "PART I — INCOME" bands |
| Section header — Expenses | `#2E75B6` fill + WHITE text | "PART II — EXPENSES" bands |
| Line header (e.g. "Line 1") | `#F2F2F2` light gray fill + bold black | Per-line aggregation rows |
| Positive accent | `#E2EFDA` fill + `#375623` dark green text | Gross Profit, positive subtotals |
| Risk/total accent | `#FDECEA` fill + `#C00000` dark red text | Total Expenses |
| Final figure accent | `#FCE4D6` salmon fill + `#C00000` dark red text | Net Profit/(Loss) |
| Footer note | `#7F7F7F` medium gray italic | Italic disclaimers at bottom |

### Code-fill palette (General Ledger row coloring) — **semantic by deductibility character**, not by code-enum
| Class | Hex | Codes that map here |
|---|---|---|
| Content meals 100% (mint) | `#D5E8D4` | `MEALS-100`, `Meal – Content Product (100%)` |
| General write-off 100% (soft green) | `#E2EFDA` | `WRITE-OFF`, `Write-Off (100%)`, `Amazon Direct (100%)`, `Amazon Indirect (13.04%)`, `Business Equipment & Supplies`, `Equipment – Conditional §179`, `Production – Talent/Appearance` |
| Partial deduction 50% (light blue) | `#DDEBF7` | `MEALS-50`, `Meal – Business (50%)`, `Vehicle/Transport – Actual Method` |
| Gray area — review (light yellow) | `#FFF2CC` | `GRAY`, `Gray Area (50% – Documented)` |
| Allocated portion (light pink) | `#EAD1DC` | `Card Fee – 65% Biz`, `Interest – 65% Biz`, `FEE-ALLOC`, `INT-ALLOC` |

> **Critical insight:** the reference colors by **what the row means for the deduction** (full / partial / gray / allocated), not by the underlying code enum. TaxLens's current `CODE_FILL` is keyed by `TransactionCode` (`WRITE_OFF` / `MEALS_50` / etc.) which produces only 4 visual classes. The reference is more meaningful.

### Number formatting
- All money cells: `#,##0.00;\(#,##0.00\);\-` — parens for negatives, dash for zero, 2 decimals
- TaxLens current default is `$#,##0.00` — no parens-for-negatives, no zero-dash. Should match the reference.

### Column widths
| Sheet | Pattern |
|---|---|
| General Ledger | A=12 (date), B=58 (description), C=26 (account), D=14 (amount), E=44 (category long-form), F=28 (code), G=9 (%), H=13 (deductible), I=38 (Schedule C line), J=70 (notes — wide for CPA prose) |
| Schedule C / P&L / Balance Sheet | A=44 (description), B/E=12–18 (values) — focused two-column layout |
| Schedule C — Detail | A=12 (date), B=56 (description), C=26 (account), D=42 (category), E=36 (line), F=22 (sub-category), G/H=13 (amount, deductible) |

### Freeze panes + autofilters
- General Ledger: freeze `A4`, autofilter `A3:J3` (2 title rows + header)
- Schedule C — Detail: freeze `A3`, autofilter `A2:H2`
- Schedule C / P&L / Balance Sheet: no freeze (small enough), no autofilter

### Merged cells
- Title rows (`A1:E1`), subtitle rows (`A2:E2`), section bands (`A4:E4`, `A13:E13`), footer note (`A41:E41`) — all merged across the sheet width
- Maznah's P&L has 18 merged ranges, Balance Sheet 10 — used liberally for section/category banners

### Font
- Arial throughout (10pt body, 11pt italic subtitle, 14pt bold title)
- TaxLens current uses default (Calibri). Should switch to Arial for the professional CPA-deliverable look.

### Footer note pattern
Every summary sheet has an italic gray note at the bottom merged across columns:
- Schedule C: "NOTE: Net loss from Schedule C may be deductible against W-2 salary income on Form 1040 (subject to passive activity and at-risk rules)..."
- P&L: "NOTE: Schedule C net loss may offset W-2 salary income (~$122,020 Airspan Networks) on joint Form 1040, subject to at-risk..."
- Balance Sheet: "NOTES: Balance sheet is approximate. Equipment fully expensed under §179 (book value = $0). Credit card balances are estimates..."

---

## Formulas vs hardcoded values

The reference is a **hybrid**:

| Sheet | Total formulas | Approach |
|---|---|---|
| Schedule C | 0 | All hardcoded (presentation summary) |
| Profit & Loss Statement | 0 | All hardcoded (presentation summary) |
| Balance Sheet | 0 | All hardcoded (presentation summary) |
| General Ledger | 2 | `=SUM(D4:D722)` + `=SUM(H4:H722)` at the very bottom |
| Schedule C — Detail | 9 | One `=SUM(...)` per Schedule C line section (verifies subtotals match) |

**Why this pattern matters:** the formulas live in **the auditability surfaces** (the Detail sheet, where a CPA verifies "do my detail rows sum to the headline line?"). The summary sheets (Sch C, P&L, BS) are presentation-only and don't need to recalc.

TaxLens's `financialStatements.ts` should follow the same pattern: compute totals once in Node, write formulas to the Detail sheet (`=SUM(H{start}:H{end})`) so CPAs can audit, write hardcoded values to the summary sheets.

---

## Content differences (vs current TaxLens output)

### Schedule C sheet
**Reference structure** (single-member LLC / Sole Prop):
```
PART I — INCOME
  Line 1  — Gross Receipts                                  $2,818
    Photography sessions — Deeksha Madapura                 $1,913
    Photography sessions — Ivette Garcia                    $300
    Photography sessions — Yousuf (via Mohamed Sheikh)      $300
    Fall Mini Shoot — Oct 20, 2025 (12 participants)        $305
  Line 4  — Cost of Goods Sold                              $0
  Line 5  — Gross Profit                                    $2,818

PART II — EXPENSES
  Line 8  — Advertising                                     $0
  Line 9  — Car and Truck Expenses                          $656.49
  Line 11 — Contract Labor                                  $506.57
  Line 13 — Depreciation / §179 Equipment                   $2,519.52
  Line 16b— Business Interest on Business Debt              $1,284.47
  Line 17 — Legal and Professional Services                 $3,595
  Line 18 — Office Expense / Software Subscriptions         $265.71
  Line 24a— Travel                                          $2,133.97
  Line 24b— Deductible Meals                                $6,591.21
    Content creation meals (100% deductible)                $5,387.81
    Business meals (50% after §274(n) reduction)            $1,203.40
  Line 27a— Other Expenses                                  $19,495.35
    Travel                                                  $7,750.99
    Subscriptions                                           $2,519.81
    Auto Expense                                            $1,859.70
    Props & Supplies                                        $1,730.50
    Clothing & Grooming                                     $2,261.65
    Robinhood Card                                          $240.43
    Card & Bank Fees                                        $1,245.25
    Other                                                   $1,887.02
  Line 30 — Home Office Deduction (Form 8829)               $0
  Line 28 — Total Expenses                                  $37,048.29
  Line 31 — Net Profit (or Loss)                            ($34,230.29)
```

**Key features TaxLens currently lacks:**
1. **Per-line revenue breakdown** — under "Line 1 Gross Receipts", list every customer/source. TaxLens has the BIZ_INCOME rows in the ledger but doesn't roll them up into "by counterparty" sub-items.
2. **§274(n) split for meals** — "Content creation meals (100% deductible)" vs "Business meals (50% after §274(n) reduction)" as two indented sub-rows under Line 24b.
3. **Line 27a sub-category breakdown** — Travel / Subscriptions / Auto / Props / Clothing / Card Fees / Other named groupings. TaxLens lumps everything into Line 27a as a single number.
4. **Section bands** — "PART I — INCOME" and "PART II — EXPENSES" as wide colored merged headers.
5. **Final tally accent** — Total Expenses + Net Profit/(Loss) rows with the red salmon accent.
6. **Bottom note** — italic disclaimer about Form 1040 deductibility/passive-activity rules.

### Profit & Loss Statement
**Reference structure** — organized by **operating category**, NOT by Schedule C line:
```
REVENUE
  Photography Session Fees
    Deeksha Madapura ... etc.
  Total Revenue                                              $2,818

OPERATING EXPENSES
  Photography & Content Creation
    Equipment — §179 Expensed                                $2,519.52
    Talent / Model Compensation (In-Kind)                    $506.57
  Travel
    Airfare / Hotels / Ground Transport sub-items
  Total Travel (Lines 24a + 27a Travel)                      $9,884.96
  Meals
    Content creation meals (100%)                            $5,387.81
    Business meals (50%)                                     $1,203.40
  Total Meals                                                $6,591.21
  Subscriptions & Software
    Software (Adobe, DaVinci)                                $265.71
    Platforms, Cloud, Other                                  $2,519.81
  Total Subscriptions & Software                             $2,785.52
  Auto Expenses
    Tolls, Gas, Insurance, Maintenance (50–100%)             $2,516.19
  Clothing & Grooming
    On-Camera Wardrobe (50%)
    Grooming & Talent Compensation
  Total Clothing & Grooming                                  $2,261.65
  Legal & Professional Services
    Attorney Fees (Matos & Jawad, Bizee.com)                 $3,595
  Business Interest
    Card interest — 65% business allocation                  $1,284.47
  Card & Bank Fees
    Annual fees & card fees — 65% alloc                      $1,245.25
  Robinhood Card Expenses                                    $240.43
  Home Office (Form 8829)                                    $0
  Advertising (TikTok Ads, Google Ads)                       $0

TOTAL OPERATING EXPENSES                                     $37,048.29
NET PROFIT / (LOSS)                                          ($34,230.29)
```

**Key features:**
1. **Categories cross Schedule C lines** — "Total Travel" combines Line 24a + Line 27a Travel sub-category. This is a real CPA-style P&L not a tax-line dump.
2. **Per-vendor sub-rows** under Legal & Professional (named: Matos & Jawad, Bizee.com).
3. **Allocation labels** — "(50–100%)", "(65% biz allocation)" — disclose the partial-business-pct decision inline.

### Balance Sheet
**Reference structure** — entity-aware (multi-member LLC):
```
ASSETS
  Current Assets
    Cash — Najath Checking 9517 (approx year-end)            $2,000
    Cash — Maznah Checking 8359 (approx year-end)            $600
    Accounts Receivable                                       $0
  Total Current Assets                                       $2,600
  Fixed Assets
    Photography & Video Equipment (cost: ~$4,015)            $4,015
      Nikon 70-200mm f/2.8 VR S Lens (§179 expensed)         $1,731.99
      DJI Mini 4 Pro Fly More Combo with RC2 (§179)          $1,189.67
      Other equipment, lighting, audio (§179)                $1,093.34
    Less: §179 Accumulated Depreciation                      ($4,015)
  Net Fixed Assets                                           $0
TOTAL ASSETS                                                 $2,600

LIABILITIES
  Credit Card Balances (Approx. Year-End)
    Chase Freedom / IHG / United                             $200
    Robinhood Card                                           $300
    Amex Platinum 8-41003                                    $500
    Costco Citi 5513 / Delta Amex                            $400
  Total Liabilities                                          $1,400
TOTAL LIABILITIES                                            $1,400

OWNER'S EQUITY
  Member Contributions — Najath Mohomed                      $0
  Member Contributions — Maznah Amanullah                    $0
  Retained Earnings — Prior Periods                          $0
  Net Income (Loss) — 2025                                  ($34,230.29)
Total Owner's Equity                                         $1,200

TOTAL LIABILITIES + EQUITY                                   $2,600
```

**Key features:**
1. **Per-account cash sub-items** with mask numbers and "approx year-end" caveat.
2. **Per-asset fixed-asset breakdown** with §179 expensed flags — these come from the existing `lib/reports/pdf/documents.tsx` Form 4562 logic, just rendered in the BS.
3. **Per-card liability sub-items** — Chase Freedom, Robinhood, Amex, Costco Citi.
4. **Per-member equity sub-items** — multi-owner aware. For a sole-prop LLC with two spouses listed as members, both appear.
5. **Bottom note** — "Balance sheet is approximate. Equipment fully expensed under §179 (book value = $0). Credit card balances are estimates."

### General Ledger
Differences vs TaxLens current Master Ledger Transactions sheet:

| Column | TaxLens current | Reference |
|---|---|---|
| Code | Enum: `WRITE_OFF`, `MEALS_50`, `GRAY` | Descriptive: `MEALS-100`, `Meal – Business (50%)`, `Vehicle/Transport – Actual Method`, `Amazon Indirect (13.04%)`, `Card Fee – 65% Biz` |
| Schedule C Line | Line key (e.g. "Line 24b Meals") | Line + label (e.g. "Line 24b — Meals") |
| Notes | Reasoning field | **Rich CPA prose** — "Houston food content series", "CONFIRMED RECEIPT: Nikon 70-200mm...", "§280A indirect — replacement parts", "Dine-in / delivery. Maznah/[person]." |
| Category | (does not exist) | Plain-English category — "Vehicle Fuel — Local (Gray)", "Equipment — Photography Lens", "Meals — Content Creation" |
| Code color | 4 classes | 5 classes by deductibility character |

### Schedule C — Detail
**Reference structure:**
- 9 section headers (one per Schedule C line: 9, 11, 13, 16b, 17, 18, 24a, 24b, 27a)
- Each section: transaction rows + `=SUM(H{start}:H{end})` subtotal formula
- Extra column: `Sub-Category (27a)` — for Line 27a row breakdowns (Travel / Subscriptions / etc.)

**TaxLens current** (per Session 7 notes): also produces a "Schedule C Detail" sheet but flat-listed by line. Needs to be grouped with section headers + SUM formulas.

---

## Entity-aware variants (the user's "depending on the business type" requirement)

`lib/forms/registry.ts` already returns a `FormSpec` per `EntityType`. The financial-statements workbook should mirror that:

### SOLE_PROP / LLC_SINGLE (single-member LLC, disregarded)
- **Schedule C** sheet (the structure shown above)
- **P&L** by operating category
- **Balance Sheet** — per-member contributions (even though disregarded, multi-spouse couples often list both)
- **Sch C Detail** with SUM formulas
- Subtitle: "Sole Proprietorship (Schedule C)" + "Cash Method"
- Footer: "Net loss from Schedule C may be deductible against W-2 salary income on Form 1040 (subject to passive activity and at-risk rules)."

### S_CORP
- Replace "Schedule C" with **"Form 1120-S — Income & Deductions"** sheet — same structure but using S-Corp form lines (Line 1a Gross Receipts, Line 8 Compensation of Officers, Line 12 Interest, etc.)
- Add **"Schedule K-1 Summary"** sheet per shareholder (one tab per Owner row with `kind=SHAREHOLDER` or `OFFICER`)
- **Balance Sheet** — Schedule L format with per-shareholder stock + debt basis (`Owner.stockBasis`, `Owner.debtBasis`)
- Footer: "Income/loss passes through to shareholders on Schedule K-1 per §1366; basis tracked on Form 7203."

### LLC_MULTI / PARTNERSHIP
- "Form 1065 — Income & Deductions" sheet
- Per-partner K-1 sheets (one per `Owner.kind in [GENERAL_PARTNER, LIMITED_PARTNER, MEMBER]`)
- **Balance Sheet** — Schedule L format with §704(b) capital account roll-forward per partner (`Owner.partnerCapitalStart`, `Owner.bookTaxDelta`)
- Footer: "Income/loss allocated per partnership agreement § allocation; §704(b) capital accounts maintained."

### C_CORP
- "Form 1120 — Income & Deductions" sheet — C-Corp form lines including officer compensation, retained earnings
- **No K-1** (C-Corp doesn't pass through)
- **Balance Sheet** — Schedule L with retained earnings + paid-in capital (no per-owner breakdown beyond officer comp)
- Footer: "C-Corp pays tax at entity level; dividends to shareholders taxed separately."

The `getFormSpec(entityType)` function already exposes `lineAllowlist`, `k1Required`, `seTaxApplicable`, `payrollPosture` — extend it to include `financialStatementsTemplate: { sheetSet, subtitleTemplate, footerTemplate, k1PerOwner }`.

---

## Implementation plan

### 1. Schema and registry changes (no migration)
- Extend `lib/forms/registry.ts` `FormSpec` interface with:
  ```ts
  financialStatementsTemplate: {
    headlineSheetName: string  // "Schedule C" / "Form 1120-S — Income & Deductions" / ...
    subtitleTemplate: (profile) => string  // entity + method + source
    footerTemplate: (profile) => string  // per-entity disclaimer
    perOwnerK1Sheets: boolean
    balanceSheetVariant: "schedule_c_owners" | "schedule_l_s_corp" | "schedule_l_partnership" | "schedule_l_c_corp"
    line27aSubcategoryBreakdown: boolean  // only true for SOLE_PROP/LLC_SINGLE
    operatingCategoryPnl: boolean  // true everywhere
  }
  ```
- Define one template per entity type.

### 2. Refactor `lib/reports/financialStatements.ts` to entity-aware
- Currently produces 5 hardcoded sheets. Split into:
  - `buildGeneralLedger(ctx)` — universal
  - `buildHeadlineFormSheet(ctx)` — calls template, picks Schedule C vs Form 1120-S vs 1065 vs 1120
  - `buildPnLOperating(ctx)` — by operating category, universal
  - `buildBalanceSheet(ctx)` — calls template variant
  - `buildHeadlineDetail(ctx)` — grouped detail with SUM formulas, universal
- New helper: `lib/reports/financialStatementsStyles.ts` — exports the color palette, font, number format, fill/font helpers (mirroring the reference design system)
- New helper: `lib/reports/codeFillsBySemantics.ts` — replaces the simple `CODE_FILL` map with semantic groupings (full / partial / gray / allocated)

### 3. Per-line revenue + Line 27a sub-category breakdown (Schedule C only)
- For Line 1 Gross Receipts: group `code=BIZ_INCOME` rows by counterparty (`merchantNormalized`) — emit one indented sub-row per counterparty with the total
- For Line 27a Other Expenses: introduce a `subCategory` mapping derived from `merchantNormalized` (Travel keywords → "Travel", "Adobe|Software" → "Subscriptions", "Card Fee" → "Card & Bank Fees", etc.) — emit one indented sub-row per sub-category total
- This mapping should live in `lib/reports/sch_c_subcategories.ts` and be configurable per-client (the user can edit which merchants go to which sub-category)

### 4. §274(n) split for meals (Schedule C + P&L)
- Group `code=MEALS_100` separately from `code=MEALS_50` under Line 24b
- For P&L: also keep them separate as "Content creation meals (100%)" vs "Business meals (50%)"

### 5. Balance Sheet — per-owner equity
- Read `BusinessProfile.owners` (already exists per Phase 3) — emit one equity row per `Owner.name`
- Use `Owner.capitalContribution` + `Owner.distributions` + `prior-year retained earnings` (from PriorYearContext) for the equity roll-forward
- For LLC_SINGLE with multiple members listed (e.g. spouses), show both — even though it's a disregarded entity tax-wise

### 6. Fixed Assets — per-asset breakdown
- `PriorYearContext.depreciationSchedule` Json already holds per-asset basis/method/life — render each asset as an indented sub-row under "Photography & Video Equipment" (or equivalent depending on NAICS)
- For each: show full cost + §179-expensed flag + remaining basis

### 7. Liabilities — per-card breakdown
- Read `FinancialAccount` rows with `type=CREDIT_CARD` — emit one sub-row per card with year-end balance (estimate flag if no formal balance is on file)

### 8. Footer notes (entity-specific)
- Pull from registry template; render as italic gray merged row at the bottom of each summary sheet
- The note text is per-entity (loss-offset rules differ for sole-prop vs S-Corp vs partnership)

### 9. Font + number format
- Switch all sheets to Arial 10pt body / 11pt italic subtitle / 14pt bold title
- All money cells get `#,##0.00;\(#,##0.00\);\-`

### 10. Formulas in Detail sheet
- For each Schedule C line section in the Detail sheet: emit a `=SUM(H{start}:H{end})` formula in the deductible-amount column
- Add total-formulas at the very bottom of the General Ledger (cols D and H)

### 11. Tests
- `tests/reports/financial-statements-quality.test.ts` — verify each entity type produces the correct sheet set, footer text, balance-sheet variant
- `tests/reports/sch_c_subcategories.test.ts` — verify the merchant→sub-category mapping is correct for representative Maznah-style merchants
- `tests/reports/per-owner-equity.test.ts` — verify multi-owner equity rendering for LLC_MULTI, S_CORP

---

## Critical files to modify

**New files:**
- `lib/reports/financialStatementsStyles.ts` — color palette, fonts, number formats, fill helpers
- `lib/reports/codeFillsBySemantics.ts` — semantic code→fill mapping (replaces simple enum lookup)
- `lib/reports/sch_c_subcategories.ts` — merchant→Line 27a sub-category mapping
- `lib/reports/templates/sole_prop.ts` + `s_corp.ts` + `partnership.ts` + `c_corp.ts` — per-entity sheet builders
- `tests/reports/financial-statements-quality.test.ts`
- `tests/reports/sch_c_subcategories.test.ts`

**Modified files:**
- `lib/reports/financialStatements.ts` — refactored to dispatch on entity type
- `lib/reports/masterLedger.ts` — Transactions sheet adopts the same styling/coloring
- `lib/forms/registry.ts` — `FormSpec` gets `financialStatementsTemplate` field
- `lib/reports/auditPacket.ts` — pick up the upgraded financialStatements via existing import

**Configuration:**
- The Line 27a sub-category mapping can be made user-editable later (UI panel on `/years/[year]/finalize`) — not required for V1

---

## Risk / scope

- **No DB schema changes required.** All the data this needs (Owner records, account types, depreciation schedule, prior-year context) already exists.
- **Pure presentation upgrade.** No effect on classifications, IRC citations, evidence tiers, or lock state.
- **Compatible with existing downloads.** The audit-packet ZIP already pulls `financialStatements.ts` output; the change is transparent.
- **Estimated effort:** 600–900 lines across 8–10 files, plus 2–3 tests. ~3–5 hours of focused work.

---

## Verification

1. `pnpm test` — all existing tests pass + new entity-aware tests added.
2. `pnpm build` clean.
3. Re-generate financial statements for Atif 2025 (Sole Prop) — open in Excel, visually compare against the Maznah reference. Should match the design language.
4. If a multi-owner client is available (or seed one), generate for LLC_MULTI / S_CORP entity types — verify per-owner equity rows and K-1 summary sheets appear correctly.
5. Open the audit-packet ZIP from `/years/[year]/download` — confirm the new financialStatements XLSX is the upgraded version.
