# TaxLens — Application Specification v6

**Authored from two hats:** a CPA preparing defensible Schedule Cs, and an ex-IRS revenue agent turned bookkeeper who knows what gets flagged and what survives examination.

**Lineage:**
- v5 (AI-first classification) is the **foundation**. Keep.
- The April-2026 panel spec (scenario-heavy, 9 agents, 23 artifacts, 33 intake questions) is a **reference map**, not a replacement. Its scope would repeat the v4→v5 overscoping lesson.
- v6 = v5 foundation + five hardening imports from the panel spec + ruthless V1 scope discipline.

**Status:** Implementation-ready. Build in 8 sessions.

---

## PART 1 — WHAT YOU'RE BUILDING

### 1.1 One-line definition

A web application that takes a self-employed person's raw bank/card statements (PDF, CSV) and produces a locked master transaction ledger, a 5-sheet financial statements workbook (General Ledger, Schedule C, P&L, Balance Sheet, Schedule C Detail), and an audit defense packet — with every deductible dollar carrying an IRC citation, an evidence tier, and a confidence score.

### 1.2 What it IS

- An AI-first **bookkeeping reconstruction** engine. The AI does the reasoning; the user confirms or corrects; the app writes the defensible output.
- A **single-taxpayer, single-tax-year** tool in V1. Multi-entity, multi-year is V2.
- **Federal Schedule C–focused** in V1. State tax, partnerships, S-Corps are V2+.
- A **CPA handoff** tool. The user (or their CPA) files the return. The app never files anything.
- **An audit defense system** — every artifact is produced as if an IRS agent will read it next week.

### 1.3 What it IS NOT

- **Not tax preparation.** No 1040, no Form 8995-A, no filed returns.
- **Not a general accounting package.** No accounts payable, no payroll, no invoicing. QuickBooks/Xero own that surface.
- **Not a chatbot.** The AI drives the pipeline; chat exists only for one-off clarification on a specific transaction.
- **Not an open-ended rules engine.** The user doesn't author classification rules. The app classifies; the user confirms.
- **Not a "maximum deduction" tool.** The app prefers the *better-documented* position over the bigger number. A defensible $30K beats a flimsy $40K every day of the week in an exam.

### 1.4 The ten non-negotiable principles

These are the design rails. If a future change violates one of these, the change is wrong.

1. **Single source of truth.** The master locked transaction ledger is the only input to every report. Per-account workbooks may exist as views, never as sources. (This rule was paid for in real double-counting pain.)
2. **Deductions travel as triples.** Every deductible line carries three things together or zero things: IRC citation, evidence tier, confidence. Strip any of the three and the deduction is not claimable.
3. **Silence is a bug.** If the AI lacks data to classify, it escalates — it does not guess. STOP is a feature, not a failure.
4. **Append-only at the DB level.** Transactions and classifications are never mutated in place. Reclassification is a new row; prior rows persist. A locked year is reproducible forever.
5. **Rule library is versioned and pinned per tax year.** A 2025 report regenerated in 2027 applies 2025 rules. OBBBA rewrote §168(k) and §179 mid-2025; this is not theoretical.
6. **The CPA signs the return, not the AI.** Every gray-zone position (100% meals, Augusta, wardrobe %, §475(f), QBI aggregation) ships as a position memo with facts/law/analysis/conclusion. The user or their CPA decides.
7. **Cohan is a rescue, not a strategy.** §274(d) categories (meals, travel, vehicle, gifts, listed property) require contemporaneous substantiation. The app never labels reconstructed §274(d) evidence as contemporaneous.
8. **No fabrication, ever.** The AI writes templates the user fills in. It doesn't invent meeting attendees, client names, or business purposes. If a meal has no attendee record, the app demotes it — it doesn't make one up.
9. **Bounded autonomy.** The app produces documents. It does not file anything, share anything externally, or modify permissions on any user system.
10. **V1 scope is sacred.** Three output artifacts, eight build sessions, one entity type (sole prop / SMLLC disregarded), one federal return (Schedule C), one tax year. Everything else is V2+.

---

## PART 2 — THE TWO MENTAL MODELS

### 2.1 The CPA's view

What matters to a CPA preparing this return:

- **Every line on Schedule C ties to a general ledger with transaction-level drill-down.** A line 18 Office Expense of $4,127 better sum from specific rows.
- **The category mix is plausible for the NAICS.** A wedding photographer with $12K in Line 11 Contract Labor (second shooters) is normal. A tutor with the same is a red flag.
- **§274(d) evidence is complete.** Meals, travel, vehicle, gifts, listed property — amount, time, place, business purpose, business relationship. Four out of five fails the test; the IRS knows it; the Tax Court knows it.
- **Gross receipts are defensible.** Deposits have to reconcile to 1099-Ks, platform payouts, and invoice records. The CPA's biggest fear isn't deductions — it's unreported income from a payment app the client forgot to mention.
- **Depreciation decisions are optimized with awareness of consequences.** §179 burns future depreciation if current income is low; §168(k) 100% bonus (permanent post-OBBBA for post-Jan-19-2025 acquisitions) recaptures under §1245 on disposal. State decoupling matters if the taxpayer is in a state that doesn't conform.
- **Home office §280A is either watertight or omitted.** Exclusive + regular + principal place or separate structure. If any of those is doubtful, the $1,500 simplified deduction is not worth the §1250 recapture exposure on sale of the home.
- **The return looks like one done with contemporaneous books.** Round-number deductions, generic memos, identical meal purposes across 40 restaurants — all signal reconstruction, and reconstruction signals risk.

### 2.2 The ex-IRS agent's view

What an agent looks at when an envelope lands on their desk:

- **Deposits vs. reported income.** First move, always. Every deposit into every known account is reconstructed. If deposits exceed reported gross receipts and the taxpayer can't explain the difference (transfers, gifts, loans, refunds), the delta is income. Burden is on the taxpayer.
- **DIF score triggers** (Discriminant Inventory Function). Schedule C with a loss combined with W-2 wages from an unrelated field. Meals ratio >5% of gross. Vehicle at 100% business. Home office with W-2 in same trade. Three consecutive loss years (§183 hobby).
- **Category outliers.** Line 27a "Other" exceeding 10% of expenses with no detail. Line 22 Supplies that dwarf a services business. Contract labor with no 1099s issued.
- **Round numbers.** A deduction of exactly $5,000 tells the agent no one counted; they estimated. Numbers ending in zeros at unusual frequency are a tell.
- **Consistency over time.** A taxpayer claiming 80% vehicle business use this year who claimed 40% last year better have a story.
- **Commingled accounts.** Personal and business in one account with no allocation methodology is a field-audit invitation.
- **Timing anomalies.** Year-end acceleration of expenses, January income deferral, suspiciously clustered round-number charges at 11:59 PM December 31.
- **Documents that look fabricated.** Meal memos written in identical phrasing. Mileage logs with no odd numbers. Receipts dated before the merchant started doing business. Handwritten notes in too-fresh ink.

### 2.3 How the two views converge

Both perspectives agree on the same operational rules:

- Records must be **complete** — every dollar in and out of every known account.
- Records must be **consistent** — same methodology throughout, prior-year patterns explained when they break.
- Records must be **contemporaneous** where the code demands it (§274(d)), and **honestly labeled** as reconstructed where they're not.
- Records must be **specific** — "business meeting" is a generic memo that loses; "Sarah C., prospective client, discussed Q1 brand photography package, 2hr" is a specific memo that wins.
- Round numbers are a tell; precision is defense.

The app must produce output that satisfies both views simultaneously. This is the design brief.

---

## PART 3 — THE CATEGORIZATION PROCESS

This is the core of the application. Everything else exists to support this.

### 3.1 The classification vocabulary (the 9 codes)

Every transaction ends up in one of nine codes. There are no others. This is the vocabulary constraint the AI operates under.

| Code | Meaning | Deductible amount rule | Appears on Sch C? |
|------|---------|------------------------|-------------------|
| `WRITE-OFF` | 100% business expense | Full amount | Yes |
| `WRITE-OFF-TRAVEL` | 100% business travel (trip-window match) | Full amount | Yes (24a) |
| `WRITE-OFF-COGS` | Cost of goods sold (inventory / materials for products) | Full amount | Yes (Part III → Line 4) |
| `MEALS-50` | Business meal, client/prospect/travel | 50% of amount | Yes (24b) |
| `MEALS-100` | Meal as content product (deliverable linked) | Full amount | Yes (24b, with §274(n)(2) position memo) |
| `GRAY` | Mixed personal/business | `amount × biz_pct` | Yes (per allocation) |
| `PERSONAL` | Not deductible | $0 | No |
| `TRANSFER` | Movement between owned accounts | $0 (excluded from P&L) | No |
| `PAYMENT` | Credit card payment from checking | $0 (excluded from P&L) | No |

Two supplementary codes exist outside the deduction vocabulary:

| Code | Meaning |
|------|---------|
| `BIZ-INCOME` | Client payment, platform payout, 1099-recipient deposit — contributes to gross receipts |
| `NEEDS_CONTEXT` | Transitional state — AI flagged for user input; cannot appear in a locked ledger |

The categorization process is: **every transaction gets exactly one code + a Schedule C line (if applicable) + an IRC citation + a business percentage (0–100) + a confidence score + an evidence tier.**

### 3.2 The categorization decision tree

The AI runs this tree per merchant (not per transaction — see §3.4):

```
Is this a movement between the owner's own accounts?
├── YES → TRANSFER (match source + destination)
└── NO ↓
Is this a credit-card payment from a checking account?
├── YES → PAYMENT (match to the card's statement)
└── NO ↓
Is this a client/platform deposit?
├── YES → BIZ-INCOME (classify source; reconcile to 1099)
└── NO ↓
Is the merchant category clearly personal for this NAICS + profile?
(groceries, personal clothing retail, streaming services not used for work,
personal beauty, residential utility in non-home-office scenario)
├── YES → PERSONAL
└── NO ↓
Is the merchant a restaurant/bar?
├── YES → does a trip window cover this date?
│         ├── YES, and business % on trip = 100 → MEALS-50 (trip meal)
│         └── NO  → MEALS-50 by default; STOP for §274(d) context
└── NO ↓
Is the merchant clearly business for this NAICS + profile?
(professional software, industry supplies, biz travel vendors)
├── YES → WRITE-OFF; check if trip window applies for WRITE-OFF-TRAVEL
└── NO ↓
Is the merchant mixed-use (fuel, phone, internet, Amazon, warehouse club)?
├── YES → GRAY with default biz_pct from profile; STOP if amount > threshold
└── NO ↓
NEEDS_CONTEXT — generate a STOP question specific to this merchant
```

Notes on the tree:

- **Trip windows are authoritative.** If a user confirms a trip to Alaska from 2025-08-02 through 2025-08-13, every otherwise-ambiguous merchant in that window gets promoted to `WRITE-OFF-TRAVEL` (and restaurants become `MEALS-50` trip meals). A car wash appearing in Alaska ≠ a car wash appearing in Houston.
- **Default business percentage for GRAY codes comes from the profile** (e.g., user says vehicle is 60% business — fuel, car washes, maintenance all start at 60%). The user can override per-transaction or per-merchant.
- **STOP is reachable from three paths:** unknown merchant, trip-ambiguous date, high-dollar GRAY. The AI generates the STOP question with specific context (merchant, amount, date, count of similar charges) — not a generic "is this business?".

### 3.3 How the AI actually reasons (Merchant Intelligence)

Foundational insight from v5 data: **419 unique merchant strings, 81% appearing once.** Regex patterns would miss 4 of 5 merchants. Per-transaction classification burns 4× the tokens for worse accuracy. The right unit is the **unique merchant**.

**The Merchant Intelligence pass works like this:**

1. After ingestion, the app extracts unique merchant strings (normalized — strip reference numbers, PayPal/SQ prefixes, trailing city/state, phone numbers).
2. Unique merchants are batched (25 per Claude Sonnet 4.6 call).
3. Each batch is sent with the full business profile as system context: NAICS, business description, owner names, spouse/family names, trip date ranges, known income sources, known excluded patterns (Zelle-to-partner, Merrill Lynch personal loan, Remitbee gifts from sister, HSMCA donations).
4. Claude returns a `MerchantRule` per merchant:

```json
{
  "merchant_key": "BLUEWAVE CAR WASH",
  "code": "GRAY",
  "schedule_c_line": "Line 9 / 27a Auto",
  "irc_citation": "§162, §280F",
  "business_pct_default": 60,
  "applies_trip_override": true,
  "confidence": 0.82,
  "evidence_tier": 3,
  "reasoning": "Car wash; owner has confirmed vehicle at 60% biz. During trips, car is being used exclusively for content work — promote to 100% trip travel.",
  "requires_human_input": false,
  "human_question": null
}
```

5. Rules are applied to every transaction with that merchant. Where `applies_trip_override=true` and the transaction date is within a confirmed trip, the code promotes to `WRITE-OFF-TRAVEL` and pct to 100.

6. Merchants where `requires_human_input=true` generate STOP items with Claude's specific question.

**Why this architecture beats regex:**

- Handles the 81% of merchants seen once — no pattern to match, reasoning works anyway.
- Same merchant, different contexts (BlueWave Car Wash local vs. Alaska) classified correctly without writing a rule.
- Full business profile as context means "Amazon" is understood as the e-commerce owner's inventory vendor, not as personal shopping.
- Zero rule maintenance. New merchants onboard automatically.
- Token cost: ~12K tokens for 419 merchants vs. ~57K for 720 transactions. 78% cheaper AND more accurate.

**Why per-transaction AI is still needed (Phase 4 residual pass):**

A small set of transactions can't be classified at the merchant level because the classification depends on the specific date + amount + trip context together. Examples:
- A Delta charge — could be a business flight for a content trip, could be a personal family flight. Date + trip calendar determines it.
- A $2,400 Costco charge — $50 of groceries is personal, $150 of print media is biz supplies, a $2,200 camera is a §179 asset. Amount signals the composition; user splits.
- An "amazon.com/bill" entry that might be a refund to a prior purchase — requires matching to the prior transaction by amount.

Phase 4 runs AI classification on just these residual items (typically <10% of transactions) with full per-transaction context.

### 3.4 Confidence and evidence tiers

**Confidence** is a 0–1 score from Claude based on: merchant clarity × profile match × amount plausibility × trip alignment × absence of contradicting signals.

- ≥ 0.85 → classify autonomously.
- 0.60 – 0.85 → classify but flag for user confirmation in Phase 5.
- < 0.60 → STOP (generate user question).
- §274(d) categories (meals, travel, vehicle, gifts, listed property) → always solicit user input, regardless of confidence. The code demands it.

**Evidence tier** is a 1–5 documentation strength score applied to every deductible transaction. Tiers and what triggers each:

| Tier | Name | Elements present | §274(d) safe? |
|------|------|------------------|---------------|
| **1** | Strongest | Receipt + calendar entry + trip context + deliverable link | Yes |
| **2** | Strong | Statement + 1 corroborating source (receipt image, email, order confirmation, trip-window match, calendar entry) | Yes for travel/vehicle; tenuous for meals without attendee list |
| **3** | Adequate | Statement + plausible business nexus from merchant category + profile | Safe for §162 general; NOT for §274(d) |
| **4** | Weak | Statement line alone, no corroboration; merchant category fits business | Cohan-eligible for §162; disallowed for §274(d) |
| **5** | Indefensible | Cash or generic description, no corroboration, no calendar match | Demoted to PERSONAL |

The app stores the tier. The audit defense packet groups items by tier. Tier-4 §162 items carry a "Cohan estimate" label explicitly. Tier-5 items never make it to a deduction.

### 3.5 What the user actually sees during categorization

The ledger view is a TanStack Table with per-row:

```
[2025-08-10] Stan Stephens Glacier Cruise $855.50  Amex Platinum
├─ Code:           WRITE-OFF-TRAVEL          [▼ change]
├─ Sch C line:     24a Travel                [▼ change]
├─ Biz %:          100                       [slider — locked for travel code]
├─ IRC:            §162, §274(d)             [auto]
├─ Evidence tier:  2 (trip window + amount + itinerary)
├─ Confidence:     0.91
├─ Reasoning:      "Glacier cruise is the content deliverable for Alaska content trip
│                   (Aug 2–13 confirmed in profile). For a travel content creator,
│                   the cruise IS the subject of the business output — 100% deductible
│                   under §162 as a business activity directly producing content."
├─ [ ] Confirm     [ ] Reclassify     [ ] Add receipt     [ ] Link deliverable
```

Power features:
- **Bulk actions.** Select N transactions → set code / pct / confirm in one click.
- **Natural-language override.** A text field: "All Zelle payments to Francisco A. are lawn care, personal." On save, Claude reclassifies every matching row as PERSONAL and creates/updates a MerchantRule.
- **Explain.** A "Why this classification?" button calls the Explanation hook (same Sonnet call with transaction + rule context) and displays the reasoning.
- **Locking.** Confirmed rows are immutable until the user explicitly unlocks with a reason (logged).

---

## PART 4 — THE RECONSTRUCTION PROCESS

How the app rebuilds books from raw statements. Seven phases. Each phase produces a named artifact. Users can exit and resume at phase boundaries.

```
PHASE 0 → PHASE 1 → PHASE 2 → PHASE 3 → PHASE 4 → PHASE 5 → PHASE 6
Profile    Ingest    Normalize  Merchant  Residual  Ledger    Lock
wizard     files     & dedupe   Intel AI  Pass AI   Review    & Output
```

### 4.1 Phase 0 — Profile Capture

**Purpose:** collect everything the AI needs to reason about this specific business. This is the single most leveraged phase — poor profile data poisons everything downstream.

**Output:** `profile.json` — structured owner data persisted in the `BusinessProfile` table.

**What's asked** (the 12 universal questions — more on the cut from 33 in §8):

1. Tax year (year picker)
2. Primary business activity (1 sentence, free text)
3. NAICS code (dropdown, top 50 common + search)
4. Entity type (Sole prop, SMLLC disregarded, SMLLC S-Corp elected, Other→escalate)
5. Primary state of operation
6. Revenue streams (multi-select: services / physical products / digital products / ad revenue / brand deals / affiliate / subscriptions / gifts-PR)
7. Estimated gross receipts for the year
8. Accounting method (cash / accrual — default cash)
9. Home office? (No / Dedicated space / Separate structure — if yes, collect sq ft of office and total home sq ft)
10. Vehicle for business? (No / Mixed-use personal vehicle / Dedicated biz vehicle — if yes, collect estimated business %)
11. Hold inventory? (No / Physical / Dropship no hold)
12. Started this year? (first-year flag for §195 startup costs)

**Plus three structured lists always captured in Phase 0:**

- **Confirmed business trips:** name, destination, start date, end date, business purpose, expected deliverable(s). The trip window drives Phase 3 automation.
- **Known people and entities:** spouse, business partner, children, close family (those whose names appearing in Zelle/Venmo descriptions indicate personal transfers); contractors (those ≥$600 trigger 1099-NEC list); clients (for income reconciliation).
- **Known excluded patterns:** specific Zelle recipients that are personal (spouse, household help with personal context); specific loan payments (Merrill Lynch personal loan — not investment); specific gift senders (Remitbee from sister); donations (HSMCA). Capturing these prevents the AI from misclassifying and saves a dozen STOP questions.

**What's conditional (shown only if triggered):**

- Partnership/S-Corp partner split, QJV eligibility — only if entity type is Other (in V1, this triggers a "Not supported in V1" wall with a suggestion to use their CPA).
- Sales tax jurisdictions — only if U20 yes (V1 flags; V2 computes).
- Losses prior years — only if entity is established and gross receipts are below a hobby-risk threshold.

**UX contract:** Phase 0 takes 10–15 minutes. It's finished once, reused forever. Next year's Phase 0 is a "confirm or edit" review — not a re-entry.

### 4.2 Phase 1 — File Ingestion

**Purpose:** accept bank/card statements and produce a raw transaction table per account with period coverage verified.

**Inputs accepted:**
- CSV / OFX / QFX (preferred — already structured)
- PDF (text-selectable, parsed with pdfplumber)
- PDF (scanned — Claude Vision fallback with page-level OCR)

**Outputs:**
- `raw_transactions` table rows per uploaded file
- Per-account coverage report: start date, end date, period gaps, total inflows, total outflows, transaction count

**Critical validations (must pass before Phase 2):**

1. **Period coverage.** For each account, every month of the tax year is represented. Gaps generate a STOP: "We don't have January 2025 for Chase Freedom ...1234. Upload it, or confirm the card was inactive."
2. **Statement total reconciliation.** For PDF statements, the parser sums transaction amounts and compares to the statement's own "Total Payments and Credits" / "Total Fees and Charges" totals. Mismatch >$0.01 flags the statement for re-parse or manual review. (This catches OCR errors before they poison the ledger.)
3. **Idempotency on re-upload.** Each file is hashed (SHA-256 on bytes). Re-uploading the same file is a no-op. Uploading a file with overlapping dates triggers transaction-level deduplication (hash of account + posted_date + amount + merchant_raw).
4. **Sign normalization.** Different accounts sign transactions differently (Chase CSV: charges negative, credits positive. Robinhood: charges positive, payments negative. Amex: depends on export). Normalize all to: **outflows positive, inflows negative.** Store the original + normalized.

**What Phase 1 does NOT do:**
- Classification. Raw transactions only.
- Merchant normalization. That's Phase 2.
- Transfer matching. That's Phase 2.

### 4.3 Phase 2 — Normalization & Deduplication

**Purpose:** clean the raw transactions and identify cross-account relationships before classification.

**Operations:**

1. **Merchant normalization.** Deterministic regex strips reference numbers, processor prefixes (SQ *, PAYPAL *, TST*), trailing phone/ZIP, and trailing city/state abbreviations. "SQ *GYRO KING 512-555-0123" → "GYRO KING". "PAYPAL *ADOBE 402-9357733" → "ADOBE".
2. **Duplicate detection.** Same idempotency key appearing in two uploads → one retained, the duplicate linked.
3. **Transfer matching.** For each outflow between owned accounts, search other accounts for an inflow of the same absolute amount within a ±5 day window. Matched pairs both marked `TRANSFER`. Unmatched outflows labeled as potential transfers pending user confirmation generate a STOP.
4. **Card payment matching.** For each "Payment Thank You" / similar on a credit card, match to an outflow from checking of the same amount within ±5 days. Matched → both labeled `PAYMENT`, both excluded from P&L. (A card payment counted as an expense is a $37K error waiting to happen — this was literally the v4 project's hardest error to catch.)
5. **Refund detection.** Negative charges (inflows) on credit cards are candidates for refunds. Match to prior-dated positive charges at same merchant. Mark both as paired; the refund offsets the original at the deductible-amount level.

**Outputs:**
- `staged_transactions` with normalized merchant, dedupe flags, transfer links, payment links, refund links
- Reconciliation report (counts: normalized / duplicates / transfers matched / transfers unmatched / payments matched / refunds linked)

### 4.4 Phase 3 — Merchant Intelligence (AI)

**Purpose:** classify every transaction by classifying every unique merchant once, with full business context.

**Process** (detailed in §3.3):
1. Extract unique merchants from `staged_transactions`.
2. Batch 25 merchants per call.
3. Call Claude Sonnet 4.6 with full profile + trip list + known-excluded patterns as system context.
4. Persist `MerchantRule` per merchant.
5. Apply rules to every matching transaction, writing a `Classification` row.
6. For `requires_human_input=true` rules, create a `StopItem` with Claude's specific question.

**Output:**
- Every transaction has a current `Classification` row
- `merchant_rules` table is populated
- `stop_items` queue is populated

### 4.5 Phase 4 — STOP Review (User)

**Purpose:** resolve all AI-flagged ambiguities with owner input before finalizing the ledger.

**What shows up in STOP:**
- Merchants where confidence < 0.60
- Every `GRAY`-coded merchant above a dollar threshold (default: any single transaction >$500, or any merchant aggregating >$1,000)
- Every potential §274(d) category transaction without substantiation (meal without attendee/purpose, vehicle expense without mileage, travel to non-trip-window destination)
- Unmatched transfers from Phase 2
- Period gaps from Phase 1
- Deposits of ≥$250 that didn't auto-classify as a known income source (reconcile to 1099 / client / platform / gift / loan / refund)

**The UX contract:**
- STOPs are grouped by merchant (one question covers N transactions).
- Each STOP has Claude's specific question in the user's voice ("We see 6 Delta charges in March–May totaling $3,240, but no trip window in your profile covers these dates. Are these business flights? If yes, what was the trip?").
- Answers apply to the current transactions AND update the merchant rule for future similar charges (user confirms with a "apply to similar" toggle, default on).
- Natural-language override text box: "These three charges are all for my daughter's ballet lessons, personal." → Claude reclassifies.

**Output:**
- Every STOP resolved or explicitly deferred
- Updated `Classification` and `MerchantRule` rows

### 4.6 Phase 5 — Ledger Review & Corrections

**Purpose:** the user reviews the full classified ledger and makes final corrections before lock.

**The ledger view:**
- TanStack Table, virtualized, ~700 rows target
- Column filters: account, code, Schedule C line, business %, evidence tier, confidence, merchant, date range
- Color coding: green (WRITE-OFF / COGS), amber (MEALS / GRAY), red (PERSONAL), blue (TRANSFER / PAYMENT), gray (NEEDS_CONTEXT — blocks lock if any remain)
- Row-level: code dropdown, pct slider, line dropdown, reasoning popover, evidence tier pill, confidence bar, "explain this classification" button

**Bulk actions:**
- Reclassify N selected transactions as one code
- Set biz % across N selected
- Confirm N selected
- Split one transaction into multiple (for mixed Costco charges, Amazon line-item splits)

**Amazon handling specifically:**
Amazon charges are a known pain point. A single $247 Amazon Business charge could be 3 items: $8 USB hub (Line 18), $199 camera battery (Line 13 §179), $40 kids' toys (Personal). The app offers a per-charge "split" action: user provides up to 5 line splits with code + pct + reasoning each. If the user uploads an Amazon order export, the app matches by amount + date and pre-populates the split.

**Output:**
- Ledger reviewed, corrections applied
- Every row's `is_user_confirmed` = true OR the user explicitly bulk-confirms "everything else"
- Ready for lock

### 4.7 Phase 6 — Lock & Output

**Purpose:** freeze the ledger and generate the three V1 deliverables.

**Lock sequence:**

1. Run the 10 QA assertions (see §12). If any fail, lock is blocked and the user is directed to the failing transactions.
2. If all pass, `TaxYear.status = LOCKED`, timestamp captured, hash of the current ledger stored.
3. Generate the three artifacts (see §10).
4. `present_files` the artifacts.

**Unlock:**
- Explicit user action with a required rationale
- Logs `AuditEvent` with rationale
- All derived artifacts marked STALE (kept for history, UI shows as superseded)
- Subsequent re-lock produces new artifacts with a version number

---

## PART 5 — DATA MODEL

Minimal. Sixteen entities in the panel spec is overengineered. Ten is enough for V1.

### 5.1 Entities

**User**
- id, email, auth fields (NextAuth v5), created_at, updated_at

**BusinessProfile** (one per user per tax year; answers to universal questions)
- id, user_id, tax_year, naics_code, entity_type, primary_state, business_description, gross_receipts_estimate, accounting_method, home_office_config (JSONB: has/dedicated/structure, office_sqft, home_sqft), vehicle_config (JSONB: has/biz_pct), inventory_config, revenue_streams (string[]), first_year (bool), created_at, updated_at

**KnownEntity** (the "people and patterns" list)
- id, profile_id, kind (PERSON_PERSONAL / PERSON_CONTRACTOR / PERSON_CLIENT / PATTERN_EXCLUDED / PATTERN_INCOME), display_name, match_keywords (string[]), default_code (optional), notes

**Trip**
- id, profile_id, name, destination, start_date, end_date, purpose, deliverable_description, is_confirmed

**TaxYear**
- id, user_id, year, status (CREATED / INGESTION / CLASSIFICATION / REVIEW / LOCKED / ARCHIVED), rule_version_id, locked_at, locked_snapshot_hash, created_at

**Account**
- id, user_id, tax_year_id, type (checking / savings / credit_card / brokerage / payment_processor), institution, mask, nickname, is_primarily_business (bool)

**StatementImport**
- id, account_id, tax_year_id, file_path, file_type, period_start, period_end, source_hash (SHA-256, UNIQUE), parse_status, parse_confidence, uploaded_at
- Unique constraint on (account_id, source_hash)

**Transaction** (immutable — INSERT only)
- id, statement_import_id, account_id, tax_year_id, posted_date, transaction_date, amount_original (signed), amount_normalized (outflow+), merchant_raw, merchant_normalized, description_raw, idempotency_key (UNIQUE), is_duplicate_of (self-FK), is_transfer_paired_with (self-FK), is_payment_paired_with (self-FK), is_refund_pairs_with (self-FK), created_at
- Index: (tax_year_id, posted_date), (account_id, posted_date)
- DB-level: deny UPDATE and DELETE

**Classification** (append-only; latest is_current=true wins)
- id, transaction_id, code, schedule_c_line, business_pct, irc_citations (string[]), confidence, evidence_tier (1–5), source (AI / USER / AI_USER_CONFIRMED), reasoning, is_current (bool), created_at, created_by (User or AI)
- Trigger: on INSERT with is_current=true, flip prior is_current to false
- Index: (transaction_id, is_current)

**MerchantRule**
- id, tax_year_id, merchant_key, code, schedule_c_line, business_pct_default, applies_trip_override (bool), irc_citations, evidence_tier_default, confidence, reasoning, requires_human_input (bool), human_question, is_confirmed (bool by user), original_sample, total_transactions, total_amount

**StopItem**
- id, tax_year_id, merchant_rule_id (nullable, for merchant stops), category (merchant / transfer / period_gap / deposit / 274d), question, context (JSONB), transaction_ids (UUID[]), state (PENDING / ANSWERED / DEFERRED), user_answer (JSONB), answered_at

**AuditEvent** (INSERT only; DB-level role enforcement)
- id, user_id, actor_type (USER / AI / SYSTEM), event_type, entity_type, entity_id, before_state (JSONB), after_state (JSONB), rationale, occurred_at
- Index: (user_id, occurred_at DESC)

**RuleVersion**
- id, effective_date, rule_set (JSONB — see Part 7), summary, superseded_by_id

**Report**
- id, tax_year_id, kind (MASTER_LEDGER / FINANCIAL_STATEMENTS / AUDIT_PACKET), file_path, rule_version_id, transaction_snapshot_hash, generated_at, is_current

### 5.2 The immutability rules

- **Transaction** table: GRANT INSERT, SELECT; DENY UPDATE, DELETE at application role level.
- **Classification** table: GRANT INSERT, SELECT; flip of is_current via trigger. Prior rows never touched.
- **AuditEvent** table: GRANT INSERT, SELECT; no mutation path.
- **Correcting a parse error** = creating a reversing transaction + corrected transaction, both linked to the original. Never edit.

This is non-negotiable. It's what makes "regenerate the 2025 report in 2027 and get the same numbers" actually true.

### 5.3 What's NOT in the data model (V1)

- No Document / Receipt entity in V1. Receipts as file attachments are V2. V1 treats statement lines as Tier 3 by default, Tier 2 when corroborated by trip windows or profile data.
- No WardrobeLog / MealLog / MileageLog as first-class entities. They're derived views on classified transactions. V1 outputs them as artifacts (§10); the source of truth is the master ledger.
- No Multi-tenant sharing. V1 is owner-only. CPA-share link is V2.
- No CPA role / entity. Send link to CPA's email is V2.

---

## PART 6 — AI ARCHITECTURE

Two agents. Not nine. The panel spec's agent proliferation is premature.

### 6.1 Agent 1: Merchant Intelligence Agent

**Purpose:** classify unique merchants with full business context.
**Model:** claude-sonnet-4-6 (primary), claude-haiku-4-5 (retry on timeout).
**Input:** batch of 25 unique merchants + full business profile + confirmed trips + known entities + rule library version.
**Output:** `MerchantRule` per merchant with code, line, pct, citations, confidence, reasoning, STOP question if ambiguous.
**Token budget:** ~12K per batch. Caching: per-merchant keyed on (merchant_key, naics, entity_type, rule_version) with 30-day TTL, bust on rule-version change.
**Failure modes:** (1) Low confidence returns `requires_human_input=true` with specific question. (2) API error queues with exponential backoff. (3) Never invents citations — returns `"[VERIFY]"` placeholder if uncertain.

### 6.2 Agent 2: Residual Transaction Agent

**Purpose:** per-transaction classification for the small set Phase 3 couldn't resolve at merchant level.
**Model:** claude-sonnet-4-6.
**Input:** single transaction + merchant rule (multi-candidate or low-confidence) + profile + neighboring transactions (5 before, 5 after, same account).
**Output:** Classification with code, line, pct, citations, confidence, reasoning, optional STOP.
**Token budget:** ~2K per call; typically <50 calls per tax year.
**Failure modes:** STOP if still ambiguous.

### 6.3 What is NOT an AI agent

- **Merchant normalization.** Deterministic regex. If regex fails on an exotic merchant, the raw string passes through unchanged and Agent 1 handles it.
- **Transfer/payment matching.** Deterministic: amount + date window + account-pair + raw-description-contains-"transfer"/"payment". Only ambiguous cases escalate.
- **Report generation.** Deterministic code (openpyxl, exceljs). No AI. Values come from the locked ledger. (Exception: narrative sections of position memos use Sonnet 4.6 — e.g., §183 hobby defense memo, Augusta meeting agenda template — but only with [VERIFY] flagging for unverified citations.)
- **Explanation.** The reasoning snippet from the original Classification row is what the UI shows. If the user hits "explain," the UI shows the stored reasoning — no live LLM call needed 90% of the time. Live regeneration only if the user specifically requests it.

This keeps V1's AI surface narrow, auditable, and cheap. Agent sprawl (9 agents in the panel spec) is a maintenance burden and an unpredictable cost surface.

### 6.4 Guardrails on all AI output

- **Never invent IRC citations.** Uncertain → `"[VERIFY]"` in citation array. The rule library has the authoritative citations (Part 7); the agent's job is to select from that library, not generate new ones.
- **Never invent facts about the taxpayer.** No made-up meeting attendees, clients, purposes.
- **Fall back to stored reasoning.** If the API fails mid-session, prior Classification rows remain usable. The pipeline degrades gracefully.
- **Every agent call produces an AuditEvent** with input hash, output hash, model used, token count, duration. Reproducibility is a feature.

---

## PART 7 — TAX RULE LIBRARY

### 7.1 Why versioned

Tax law changes. The OBBBA (P.L. 119-21, enacted July 4, 2025) rewrote §168(k) and §179 with effective dates that cut mid-year. A 2025 return being prepared in March 2026 must apply the 2025 rule set. A 2025 return regenerated in October 2027 must still apply the 2025 rules — not whatever rules are current in 2027.

The rule library is a database-backed, JSON-encoded, versioned artifact. Each `TaxYear` pins a `rule_version_id` at creation. Regeneration uses the pinned version.

### 7.2 Rule schema

```json
{
  "effective_date": "2025-01-01",
  "superseded_by": null,
  "rules": [
    {
      "id": "R-168k-2025",
      "irc_section": "§168(k)",
      "effective_from": "2025-01-20",
      "effective_to": null,
      "summary": "100% bonus depreciation permanent post-OBBBA for property acquired and placed in service after Jan 19, 2025",
      "decision_effect": "Assets with class life ≤20 yrs → 100% year-one expensing option",
      "transition": "Binding contracts pre-Jan 20, 2025 fall under TCJA phase-down (40% bonus for 2025)",
      "authorities": ["IRC §168(k) as amended by OBBBA P.L. 119-21"],
      "needs_search_verification": false
    }
  ]
}
```

### 7.3 V1 minimum rule set

These are the rules the classifier must know for Schedule C Sole prop / SMLLC disregarded. Every one is cited on the transactions it applies to.

| Rule ID | IRC | Summary | Classification effect |
|---------|-----|---------|----------------------|
| R-162-001 | §162(a) | Ordinary and necessary business expenses deductible | WRITE-OFF baseline |
| R-262-001 | §262 | Personal, living, family expenses not deductible | PERSONAL |
| R-274d-001 | §274(d) | Meals, travel, vehicle, gifts, listed property require contemporaneous substantiation: amount, time, place, business purpose, relationship | Mandatory STOP for these categories; tier ≥2 required |
| R-274n-001 | §274(n)(1) | Business meals 50% deductible | MEALS-50 default |
| R-274n-002 | §274(n)(2) | 100% exceptions: meals sold to customers, items provided to the public (food content creator argument traces through §274(e)(8)/(9), not §274(n)(2)(A)); the TCJA restaurant exception expired 12/31/2022 | MEALS-100 only with deliverable link + position memo |
| R-280Ac-001 | §280A(c) | Home office: exclusive + regular use + (principal place OR meeting place OR separate structure). Simplified method $5/sqft up to 300 sqft = $1,500 cap. Separate structure does NOT require principal-place test | Home office deduction qualified with profile affirmation |
| R-183-001 | §183 | Hobby: 3-of-5 profit presumption; post-TCJA hobby expenses non-deductible above the line | Risk flag if 3+ consecutive loss years; escalate to position memo |
| R-263a-001 | Reg. 1.263(a)-1(f) | De minimis safe harbor: items ≤$2,500 per invoice can be expensed immediately (requires written policy — app provides template) | Purchases ≤$2,500 → WRITE-OFF; >$2,500 → depreciation decision |
| R-168k-2025 | §168(k) | 100% bonus depreciation permanent for property acquired after Jan 19, 2025 (OBBBA) | Depreciable assets → §168(k) election available |
| R-179-2025 | §179 | $2.5M deduction limit / $4M phaseout for TY beginning after 12/31/2024 (OBBBA; figures subject to verification against current Rev. Proc.) | §179 election available; limited by taxable income |
| R-280F-001 | §280F | Listed property (including vehicles) substantiation under §274(d); luxury auto depreciation caps | Vehicle depreciation capped |
| R-274d-veh-001 | §274(d) / Rev. Proc. current | Standard mileage rate (current-year IRS Notice; must be verified annually) applies unless actual-expense method elected; first-year choice locks future years for that vehicle | Vehicle: standard vs. actual choice |
| R-195-001 | §195 | Startup costs: $5,000 immediate + remainder amortized over 180 months; phase-out if startup costs >$50,000 | First-year only |
| R-6001-001 | §6001 | Records sufficient to establish amount, source, purpose | Underlies evidence tier enforcement |
| R-Cohan-001 | Cohan v. Commissioner (2d Cir. 1930) | Estimates permissible for §162 where records incomplete; inapplicable to §274(d) categories | Tier-4 §162 → Cohan-labeled; Tier-4 §274(d) → disallowed |
| R-1402-001 | §1402 | Self-employment tax on net SE earnings ≥$400 | Auto-computed on Sch C net (informational) |
| R-6662-001 | §6662 | 20% accuracy penalty for substantial understatement | Drives conservative default on gray-zone positions |

### 7.4 The [VERIFY] protocol

Several figures require verification against the current Rev. Proc. / IRS Notice before shipping production:

- 2025 standard mileage rate (IRS Notice for tax year 2025)
- 2025 §448(c) gross receipts threshold (for §263A / §471(c) small-taxpayer exemption)
- 2025 §199A threshold amounts (indexed; Rev. Proc. 2024-40 range)
- 2025 §179 limits (OBBBA-set, but confirm indexed figures match published Rev. Proc.)
- 2025 simplified home office cap (confirm still $1,500 / $5 per sqft / 300 sqft max)

**The protocol:** the rule set ships with these values populated by the product owner + CPA review. Every classification that depends on a [VERIFY] value carries the flag. CI check: no [VERIFY] flag in the production rule set.

---

## PART 8 — UNIVERSAL QUESTIONS (ONBOARDING)

The panel spec specified 33 universal questions (26–28 conditional). Too many. For V1, 12 is enough for a sole-prop / SMLLC user. Conditional questions live in Phase 4 STOPs, not onboarding.

### 8.1 The 12 questions

Listed in Phase 0 (§4.1). Restated here with rationale:

| # | Question | Why it matters |
|---|----------|----------------|
| U1 | Tax year | Pins rule version |
| U2 | Business description (1 sentence) | Seeds Merchant Intelligence context |
| U3 | NAICS code | Sch C line 1; industry-specific categorization |
| U4 | Entity type | Sole prop / SMLLC disregarded only in V1; other → wall |
| U5 | Primary state | Flags state tax as V2-escalate |
| U6 | Revenue streams | Activates inventory module, content-creator rules, etc. |
| U7 | Estimated gross receipts | §448(c) threshold check; sanity check on classification |
| U8 | Accounting method | Revenue recognition timing |
| U9 | Home office (if yes: office sqft, home sqft) | §280A qualification; 8829 worksheet |
| U10 | Vehicle (if yes: biz %) | §274(d) mileage requirement; GRAY default pct for fuel/etc. |
| U11 | Inventory (if yes: physical / dropship) | Activates COGS / §471(c) |
| U12 | First year of business | §195 startup cost treatment |

### 8.2 Three structured lists (also captured in Phase 0)

These aren't questions; they're data capture UIs.

**Known Trips:**
- Name, destination, start date, end date, purpose, deliverable description
- Every entry is a trip window that drives classification in Phase 3

**Known Entities (People & Patterns):**
- Family / household personal (triggers auto-PERSONAL on Zelle/Venmo match)
- Contractors / talent (triggers 1099-NEC tracking + classification as Line 11)
- Clients (triggers auto-INCOME on deposit match)
- Excluded patterns (Merrill Lynch personal loan, Remitbee gifts from sister, HSMCA donations — text search string + disposition)

**Income Sources Expected:**
- Platform name (Stripe, Square, PayPal, Venmo-business, direct bank deposit, Zelle-business)
- Approximate total expected
- Enables Phase 4 deposit reconciliation

### 8.3 What's NOT asked in onboarding

- Spouse involvement, community property, S-Corp election — V1 is sole-prop/SMLLC only.
- Tips, payroll, sales tax — V1 flags these if detected in transactions and escalates.
- MTM election, trader status, crypto — V1 doesn't attempt these. Trading activity is flagged as "out of V1 scope — handle via broker 1099 + CPA."
- Prior-year tax data — V1 doesn't import prior returns. Year-over-year is a V2 feature.

---

## PART 9 — DYNAMIC QUESTIONS (STOP MECHANISM)

### 9.1 Who generates a STOP

- **Agent 1 (Merchant Intelligence)** — when a merchant can't be classified with sufficient confidence.
- **Phase 1 ingestion** — period gaps.
- **Phase 2 normalization** — unmatched transfers, orphan card payments.
- **Phase 4 deposit reconciliation** — inflows not matching any expected income source (see §11.2).
- **Deterministic rules** — any §274(d) category with missing substantiation elements.

### 9.2 Anatomy of a STOP question

Each StopItem contains:

- **Category** — merchant / transfer / period_gap / deposit / 274d
- **Question** — user-voice, specific, context-loaded
- **Context** — merchant name + count of affected txns + total dollar amount + date range + similar-merchant comparison
- **Affected transactions** — list of transaction IDs
- **Answer options** — structured for the category (see below)

### 9.3 STOP templates by category

**Merchant STOP:**
```
Merchant: BLUEWAVE CAR WASH
Appears 6 times (4 local dates, 2 during Alaska Content Trip Aug 8–12)
Total: $143
Claude's question: "Is this a car wash you use for your vehicle, and do you
use it mostly before content shoots? Or is it personal hygiene-type spend?"
Options: [ All business 100% ] [ Business-only during trips ]
         [ Mixed 50/50 ] [ Personal ] [ Other / explain → free text ]
```

**Transfer STOP:**
```
Unmatched outflow: $2,500 from Chase Freedom ...1234 on 2025-04-12
Raw description: "ZELLE TO RANDI"
No matching inflow found in your other accounts.
Question: "This Zelle of $2,500 to RANDI — who is this?"
Options: [ Personal: household/family ] [ Contractor payment ]
         [ Loan to someone else ] [ Other → free text ]
```

**Deposit STOP:**
```
Inflow: $4,200 on 2025-06-15 into Chase Checking ...9517
Raw description: "REMOTE CHECK DEPOSIT"
No matching expected income source in your profile.
Question: "Where did this deposit come from?"
Options: [ Client payment ] [ 1099 platform payout ] [ W-2 paycheck ]
         [ Owner contribution ] [ Gift ] [ Loan ] [ Refund ]
         [ Other → free text ]
```

**§274(d) STOP:**
```
Meal: $127 at PAPPAS BROTHERS STEAKHOUSE on 2025-11-06
Currently classified MEALS-50.
§274(d) requires: attendee(s), business relationship, purpose.
Question: "Who was this with and what was discussed?"
Fields:  Attendee(s) (required): ___________________________
         Business relationship: [ ▼ client / prospect / contractor / collaborator ]
         Purpose: ___________________________
         Outcome (optional): ___________________________
Save [ ] Apply same attendee+purpose to other meals this date
```

### 9.4 Answer application

After a STOP is answered:
1. The answered transactions update their Classification (new row, prior is_current=false).
2. If the category is merchant-level AND the user confirms "apply to all similar" (default on), the MerchantRule updates and all historical + future transactions with that merchant_key reclassify.
3. An AuditEvent logs the user answer with the transaction IDs affected and the rationale.

---

## PART 10 — OUTPUT ARTIFACTS (V1: THREE DELIVERABLES)

V1 ships three artifacts. Not 23. The panel spec's 23-artifact V1 would take a year to build and test.

### 10.1 Artifact 1: Master Ledger (XLSX)

The single source of truth. Every transaction, every classification, every piece of metadata needed to regenerate any other report.

**Sheets:**
- **Transactions** — every row, columns: id, date, account, merchant_raw, merchant_normalized, amount_original, amount_normalized, code, schedule_c_line, biz_pct, deductible_amt, irc_citations, evidence_tier, confidence, reasoning, is_transfer_paired_with, is_payment_paired_with, is_refund_pairs_with, is_locked
- **Merchant Rules** — every unique merchant, its rule, count of transactions, total amount
- **Stop Resolutions** — every STOP, the question, the answer, affected transactions, timestamp
- **Profile Snapshot** — the business profile as of lock
- **Metadata** — rule version, lock timestamp, ledger hash, app version

**Color coding:**
- Green background: WRITE-OFF / WRITE-OFF-TRAVEL / WRITE-OFF-COGS
- Amber: MEALS-50 / MEALS-100 / GRAY
- Red: PERSONAL
- Blue: TRANSFER / PAYMENT
- Gray italic: reconstructed evidence (Tier 3–4)

### 10.2 Artifact 2: Financial Statements Workbook (XLSX)

**Sheet 1: General Ledger** — all transactions sorted by date, color-coded, every column the CPA needs to trace a line item.

**Sheet 2: Schedule C** — line-by-line, with subtotals per line and IRC citation column. Lines populated:
- Line 1 Gross Receipts (from BIZ-INCOME)
- Line 4 COGS (from WRITE-OFF-COGS + Part III if inventory)
- Line 8 Advertising
- Line 9 Car & Truck (actual method rows OR standard mileage × confirmed biz miles)
- Line 11 Contract Labor (with 1099-NEC recipient pre-list)
- Line 13 Depreciation / §179 elections
- Line 15 Insurance
- Line 16b Interest (pro-rata business share of mixed-use card interest)
- Line 17 Legal & Professional
- Line 18 Office Expense
- Line 20b Rent — Other
- Line 21 Repairs & Maintenance
- Line 22 Supplies
- Line 23 Taxes & Licenses
- Line 24a Travel (with trip ledger sub-schedule)
- Line 24b Meals at 50% and 100% sub-totals
- Line 25 Utilities (with home-office allocation if applicable)
- Line 27a Other Expenses — sub-lined: software subscriptions, auto GRAY items, content props, clothing GRAY items, card fees, etc.
- Line 30 Home Office (via Form 8829 worksheet OR simplified)

**Sheet 3: Profit & Loss** — standard format: Revenue / COGS / Gross Profit / Operating Expenses (grouped) / Net Profit.

**Sheet 4: Balance Sheet** — cash-method sole prop version: year-end cash balances, equipment net of §179 (typically $0 if fully expensed), credit card balances, owner equity plug. Informational; not required for Schedule C filing.

**Sheet 5: Schedule C Detail** — every transaction that contributed to a Schedule C line, with its deductible amount, IRC citation, and evidence tier. This is what a CPA clicks through to verify each line.

### 10.3 Artifact 3: Audit Defense Packet (ZIP)

A handleable packet for if the return is examined.

**Contents:**

1. **Transaction Ledger (PDF export of Master Ledger Sheet 1)** — immutable record.

2. **§274(d) Substantiation Packet** — every meals / travel / vehicle / gifts / listed property transaction with its Tier evidence grouped:
   - Meals log: date, merchant, amount, attendees, relationship, purpose (populated from Phase 4 STOP answers; transactions with incomplete §274(d) fields do NOT appear and are demoted to PERSONAL at lock).
   - Travel log: trip-by-trip, dates, destinations, purpose, deliverables linked, total amount per trip.
   - Vehicle log: mileage log template populated from confirmed trip dates + odometer readings at year-end (user fills in missing daily entries). Clearly labeled "Reconstructed — not contemporaneous" on any cells the user enters post-hoc.
   - Gifts log (if any items ≥ $25 per recipient per year per §274(b)).

3. **Cohan Labels** — a list of every Tier-4 §162 row that relies on Cohan estimation, with rationale and corroborating evidence per row (trip window? calendar entry? merchant category?). Makes the Cohan position explicit rather than hidden.

4. **Position Memos** (only for applicable gray zones; generated only when the facts trigger them):
   - **§183 Hobby Defense Memo** — if loss and this is 3rd+ consecutive loss year. 9-factor analysis from profile + transaction evidence.
   - **§274(n)(2) 100% Meal Position Memo** — only if MEALS-100 items exist. Traces the argument through §274(e)(8) or §274(n)(2)(D) for food content creators with deliverable links. Both aggressive and conservative positions presented; user chooses filing position.
   - **Home Office §280A(c) Affirmation** — if home office claimed. Exclusive-use + principal-place affirmation, sq ft calc, simplified-vs-actual comparison.
   - **Wardrobe Memo** — if any wardrobe claimed. Three-tier analysis per item: costume/uniform 100% or general retail 0%, with the 50% middle tier explicitly flagged as aggressive and requiring per-item content log (reiterated: Pevsner-strict law default is 0% on general clothing).

5. **Income Reconciliation** — deposits reconciled to 1099s, platform payouts, explained transfers, gifts, loans. Any unexplained deposit still in the ledger at lock → STOP earlier; this packet confirms closure.

6. **Source Documents Inventory** — list of every uploaded statement with period coverage, parse confidence, reconciliation status. (Actual file storage and retrieval is V2; V1 lists the manifest.)

### 10.4 What's NOT in V1 output

- Individual reconciliation PDFs, mileage-only workbooks, wardrobe-only workbooks, per-trip packets. These live as sub-sheets or sub-sections inside the three artifacts. No separate files.
- Interactive audit risk dashboard as exported artifact (the dashboard exists in the app — see §11).
- Form 8829 / 1099-NEC / 4562 populated forms. V1 produces the *inputs* for those forms; the CPA or tax software fills them.
- 1120-S / 1065 / K-1 artifacts — out of V1 entity scope entirely.

---

## PART 11 — AUDIT RISK LAYER

### 11.1 The in-app risk dashboard (Phase 5)

Before lock, the user sees:

```
AUDIT RISK DASHBOARD — [Business Name] — TY [Year]

  Overall Risk Score: 42 / 100 — MODERATE

  CRITICAL (block lock):
  • 3 meals without §274(d) attendees (auto-demoted to PERSONAL at lock)
  • $1,840 in deposits unclassified (needs STOP resolution)

  HIGH:
  • Meal ratio: 6.8% of gross receipts (industry norm ≈ 3%)
  • Vehicle claimed at 82% business (>75% triggers agent scrutiny)
  • Schedule C loss — 2nd consecutive year (§183 watch; 3rd year triggers memo)

  MEDIUM:
  • 14 Tier-4 Cohan estimates totaling $2,100 (acceptable but flagged)
  • Home office at 12.5% with no photo of space — recommend taking photos
  • 4 round-number deductions ($500, $1,000, $2,500, $5,000) — verify not estimates

  LOW / INFORMATIONAL:
  • 1099-NEC list: 2 recipients ≥$600 (Francisco A. $4,800, Talent Name $1,200)
  • Documentation completeness: 89%

  ESTIMATED: $34,200 total deductions, ~$8,500 federal tax impact
```

### 11.2 What drives the risk score

Deterministic formula, not AI. Transparent to the user.

| Signal | Points |
|--------|--------|
| Meal ratio >5% of gross | +15 |
| Vehicle >75% business | +10 |
| Vehicle =100% business | +20 (statistically implausible) |
| Home office + W-2 in same trade | +15 (if future-year applicable) |
| Schedule C loss year N | N² (1 = 1 pt, 2 = 4 pts, 3 = 9 pts — §183 watch) |
| Round-number deductions >3 | +5 per |
| Line 27a "Other" >10% of total expenses | +10 |
| Any Tier-4 §274(d) row | +3 per (shouldn't exist at lock — CRITICAL) |
| Gross receipts < sum of known 1099-K-able platforms | +25 (unreported income suspicion) |
| Unclassified deposits at lock attempt | CRITICAL block |
| §274(d) substantiation missing at lock | CRITICAL block |

The score never filters or hides deductions. It surfaces what an auditor would notice. User decides what to do.

### 11.3 Hard blocks

Lock is blocked if:
- Any transaction with code `NEEDS_CONTEXT` remains
- Any meal with `MEALS-50` or `MEALS-100` has incomplete §274(d) fields
- Period gaps in any account
- Gross receipts reconciliation failure (deposits vs. expected income sources >$500 unreconciled)

---

## PART 12 — QA / VALIDATION ASSERTIONS

Run at Phase 6 lock. Written as executable assertions. Each is a hard block.

```
1. Every transaction has a current Classification (no nulls)
2. transaction_id uniqueness across the ledger
3. Sum(deductible_amt for code IN [WRITE-OFF*, MEALS-*, GRAY])
   == Schedule C Sheet total expenses
4. Sum(amount_normalized WHERE code = BIZ-INCOME) == P&L gross revenue
5. PERSONAL rows have deductible_amt == 0
6. PAYMENT rows have deductible_amt == 0
7. TRANSFER rows appear in pairs (source + destination); excluded from P&L
8. Every MEALS-* row has attendees + purpose filled (non-null, non-generic)
9. Every row with IRC §274(d) citation has evidence_tier ≤ 3 (1 better than 4)
10. No transactions dated outside the tax year boundaries appear as current-year
    classifications without an explicit "accrual adjustment" flag
11. Refund pairs net to $0 deductible (charge + refund sum to zero)
12. Home office sqft × $5 == Form 8829 simplified amount (if simplified elected)
```

### 12.1 Completeness audit

Specific to the ex-IRS-agent view: deposits reconstruction.

Before lock:
- Sum all inflows across all accounts
- Subtract: TRANSFERs between owned accounts (paired), confirmed gifts, confirmed loans, refunds, W-2 payroll deposits
- Remainder == "explained business income"
- If this remainder deviates from BIZ-INCOME total by >$500 → CRITICAL block, STOP generated

This is the single most important check. An IRS agent's first move. The app does it first too.

---

## PART 13 — V1 SCOPE DISCIPLINE

### 13.1 What's IN V1

- Sole prop + SMLLC disregarded only
- One tax year
- Federal Schedule C only
- 10–15 supported account types (Chase, Amex, Costco Citi, Discover, Capital One, Bank of America checking, Wells Fargo, Chase Business, Robinhood, Amazon Business) — the ones actually in the test fixture set from v4 data
- PDF + CSV ingestion
- Three output artifacts (§10)
- Merchant Intelligence AI + Residual Transaction AI
- 12 universal questions + trips + known entities + income sources
- Rule versioning infrastructure (seeded with the V1 rule set in §7.3)
- Audit trail (DB-level append-only)
- Audit risk dashboard
- Lock / unlock / re-lock with versioned reports

### 13.2 What's OUT of V1 (explicitly)

| Feature | Deferred to | Why |
|---------|------------|-----|
| Multi-year | V2 | Scope; single-year first |
| S-Corp / Partnership / QJV | V3 | Different return types; basis tracking |
| State tax / apportionment | V2 flag, V3 compute | 50-state variance is a product in itself |
| Crypto basis / DeFi | V2 | CoinTracker / Koinly dominate; don't rebuild |
| §475(f) MTM election | Never build; always flag + escalate | Irrevocable; CPA-only |
| IOLTA (attorney trust) | V3 or never | Separate bar-association rules |
| Form generation (1040, 1120-S, 8829, 4562) | Never | Tax prep is regulated; we're not prep |
| Payroll / W-2 / accountable plan | V3 | Entity-scope dependent |
| Sales tax filing | V2 reporting only | TaxJar/Avalara own this |
| Audit response letter drafting | V2 | Represent-the-user boundary |
| CPA marketplace | V3 | Legal/regulatory (referral fees under AICPA rules) |
| Plaid / live bank feeds | V2 | Batch upload is sufficient |
| Mobile native app | V3 | Responsive web covers |
| QuickBooks / Xero import | V2 | CSV/PDF covers |
| Receipt attachment storage | V2 | V1 uses statement-line as Tier-3 evidence |
| CPA read-only share link | V2 | Single-user V1 |

### 13.3 The V1 user

One archetype. Design for them; ignore the rest.

- Self-employed, 2+ years operating
- Sole prop or SMLLC disregarded
- 300–1,500 transactions/year across 3–10 accounts
- $20K–$250K gross receipts
- Federal Schedule C filer
- Has a CPA or will get one to review before filing
- Has never kept contemporaneous books and is reconstructing at tax time

Explicitly NOT served by V1: W-2 employees with no 1099 income, multi-state operators, S-Corp owners, attorneys, restaurateurs with tip income, day traders, inventory resellers with >$1M gross. These are V2+.

---

## PART 14 — BUILD SEQUENCE (8 SESSIONS)

Vertical slices. Each session produces working, tested code. CLAUDE.md updated at the end of each.

**Session 1: Foundation**
- Next.js 15 scaffold, Prisma schema (all entities from §5), migrations
- NextAuth v5 auth
- Empty routes: `/`, `/onboarding`, `/dashboard`, `/years/[year]`
- Seed data: one user, one tax year, sample profile, 50 synthetic transactions
- Vitest + testing-library setup
- CLAUDE.md locked with scope boundary
- End of session: user can sign up, sign in, land on empty dashboard

**Session 2: Phase 0 Profile Wizard**
- 12-question onboarding form (multi-step, saves progress)
- Trips / known entities / income sources structured lists
- `BusinessProfile` persistence
- Basic profile edit page
- End of session: complete a profile, persist it, reload and edit

**Session 3: Phase 1 Ingestion**
- File upload (R2 or local in dev) with drag-drop multi-file
- PDF text parser (pdfplumber → Python worker, or pdf-parse in Node — pick one; recommendation: pdf-parse + reserve Claude Vision worker for fallback)
- CSV parser (papaparse)
- Sign normalization rules per institution
- Duplicate detection, idempotency key, period coverage report
- Statement total reconciliation check
- End of session: upload a Chase statement PDF, see parsed transactions, coverage report shows no gaps

**Session 4: Phase 2 + 3 Normalization & Merchant Intelligence**
- Deterministic merchant normalization regex set
- Transfer matching (amount + date + account-pair)
- Card payment matching
- Refund detection
- Merchant Intelligence Agent: batch call to Sonnet 4.6 with profile context, store MerchantRule, apply to transactions, write Classification rows
- End of session: a clean profile + uploaded statements → ledger populated with AI classifications + STOPs generated

**Session 5: Phase 4 STOP Review + Phase 5 Ledger**
- StopItem queue UI
- Answer application (single + rule-update + auditEvent)
- Natural-language override reclassification
- TanStack Table ledger with filters, bulk actions, inline edit, row confirm
- "Explain this" popover
- Amazon order split UI (up to 5 splits per transaction)
- End of session: answer STOPs, edit ledger, bulk-reclassify, confirm rows

**Session 6: Phase 4 Residual AI Pass + Phase 6 Validation**
- Residual Transaction Agent call for per-transaction items that need date/amount/trip context
- The 12 QA assertions as executable validators
- Audit risk dashboard computation (§11)
- Hard-block locks if CRITICAL items remain
- End of session: can successfully lock a clean ledger; lock is blocked on synthetic broken data

**Session 7: Output Artifacts**
- Master Ledger XLSX generator (openpyxl in Python worker OR exceljs in Node — pick the runtime you used in Session 3)
- Financial Statements Workbook (5 sheets)
- Audit Defense Packet (ZIP with PDFs + CSVs + templates)
- Position memo generator (Sonnet 4.6 call for memo narrative only, with rule-library citations)
- `present_files` integration for download
- End of session: locked ledger produces all 3 artifacts, CPA-reviewable

**Session 8: Polish + Harden**
- DB-level triggers for Classification append-only, Transaction immutability, AuditEvent insert-only
- Rule library seed data loader (with the V1 rule set from §7.3)
- [VERIFY] check in CI — fail build if production rule set has [VERIFY] placeholders
- Error boundaries, loading states, empty states
- End-to-end test: fresh user → profile → upload real Maznah Media fixture → lock → artifacts match hand-verified output
- Sentry + Posthog
- CLAUDE.md finalized for V1 ship

---

## PART 15 — OPEN DECISIONS (NAJATH)

Only these. Nothing else blocks Session 1.

**D1. Runtime.** Next.js API routes (Node) for everything, or Next.js frontend + Python FastAPI worker for PDF parsing and XLSX generation? Earlier v5 history shows a preference for all-TypeScript, but pdfplumber and openpyxl are genuinely better than JS equivalents for complex statements. Recommendation: **Node everywhere, reserve a Python microservice on Railway for PDF OCR fallback only.** Matches v5 decision; simplest.

**D2. Model selection per agent.**
- Merchant Intelligence: claude-sonnet-4-6. (Locked; cost-efficient, quality sufficient.)
- Residual Transaction: claude-sonnet-4-6.
- Position Memos: **claude-opus-4-7** for gray-zone memos where exposure >$5K, sonnet-4-6 otherwise. Your call whether the cost delta is worth it.

**D3. OBBBA [VERIFY] items.** Who verifies the rule-library figures against current IRS publications before production? (Best path: CPA review of the seed rule set before first paying customer. If no CPA yet, a web_search pass at launch time.)

**D4. Pricing.** Per-tax-year flat, tiered by transaction volume, or subscription? Architecture is agnostic but Stripe integration timing differs. V1 can launch with Stripe-later + manual invoicing if that's faster. Not blocking.

**D5. The V1 user's state.** Keeping it federal-only in V1 means TX/FL/other-no-state-income users get a cleaner experience. CA/NY/etc. users get a "V1 handles federal only, escalate state to your CPA" message. Acceptable trade for shipping? Recommendation: **yes, ship.**

**D6. Wardrobe default.** V1 default tier for general retail clothing: 0% (Pevsner-strict) or 50% (aggressive-with-log)? Panel spec said 50% cap; my recommendation is **0% default with a "I have an on-camera content log for this item" override that routes it to 50% + a Wardrobe Position Memo**. Your call — this affects the Maznah Media filing.

**D7. The first paying user.** You, for TY2025. Which means V1 needs to handle the fixture that v5 processed: 10 accounts, 720 transactions, the 2025 trips (Tucson, WI/MI road trip, Canada ×2, Alaska, Sri Lanka, NJ/NYC, San Antonio/Surfside, Colorado). If Session 8's E2E test is "reprocess the 2025 Maznah Media fixture and match the locked numbers from the Excel deliverable in /mnt/project/," that's the acceptance bar. **Use that.**

---

## PART 16 — NON-NEGOTIABLES SUMMARY

One page. Post above the monitor.

1. The master locked ledger is the only source of truth. Period.
2. Transactions and classifications are append-only at the DB level.
3. Every deduction carries IRC citation + evidence tier + confidence, together or not at all.
4. Silence ≠ classification. Missing data → STOP, never guess.
5. §274(d) categories have no Cohan rescue. Evidence Tier ≥2 or the deduction dies.
6. Rule library is versioned and pinned per tax year.
7. The AI never invents citations or facts. [VERIFY] placeholders or nothing.
8. V1 = 3 artifacts, 8 sessions, 1 entity type, 1 tax year, 1 return type. No exceptions.
9. The app produces documents. It does not file. The user/CPA files.
10. "Maximum deduction" is not the goal. "Better-documented position" is.

---

**End v6 Spec.**

**Lineage note.** This spec extends TaxLens v5's AI-first merchant intelligence engine (the foundation you built) with five imports from the April-2026 panel spec: rule library versioning (Part 7), DB-level append-only audit trail (Part 5), the gray-zone position memo pattern (Part 10 §4), the universal + dynamic question catalog structure (Parts 8–9), and the trust/escalation boundary as it appears in the V1 scope table (Part 13). It explicitly rejects the panel spec's 15-scenario / 23-artifact / 9-agent V1 scope as a relearning of the v4-→v5 overscoping lesson.

**Next action.** Resolve D1–D7 above, then Session 1.
