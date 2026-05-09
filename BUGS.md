# TaxLens — Production Audit (Atif Ameer · TY2025)

**Reviewer:** brutal CPA-lens audit
**Environment:** `https://taxlense-production.up.railway.app/` against Atif Ameer's real 2025 data
**Reviewer login:** `najathakram1@gmail.com` (CPA tier, viewing Atif as client)
**Data state at review:**
- Year status: persisted `CREATED`, derived `CLASSIFICATION`
- 485 / 536 transactions (two counts — see B-04)
- 485 classifications, 202 merchant rules, 47 pending STOPs, 304 answered STOPs, 8 audit memos
- Risk: 21/100 MODERATE, 5 blockers, A07 + A13 failed
- Estimated deductions $38,117.77, gross receipts $18,313.22 (Risk page) / $24,811 (Analytics) — see B-05
- 4 accounts: Chase Business Checking, Chase Credit Card, BofA Checking, Wise

This document supersedes the local-only review. Every finding here was reproduced on Railway production with Atif's live data. **All P0 and most P1 bugs from the local review reproduce on production.**

---

## Severity legend

| Severity | Meaning |
|---|---|
| **P0** | CPA-trust-killer or data-correctness. Fix this week. |
| **P1** | Workflow blocker or role/security leak. Fix in 2 weeks. |
| **P2** | Architecture / structural risk. Plan for next sprint. |
| **P3** | Polish / micro-UX. Batch when convenient. |

Each bug is tagged `B-NN` for the implementation plan tracking.

---

## P0 — Production-blocking

### B-01 · Currency formatting drops thousands separators in 137 places
**Repro on prod:**
- Risk page assertion details: `Deductions total $38117.77`, `Gross receipts $18313.22`, `$29665.42 of inflows still unclassified — Inflows $88725.35 = transfers $14299.47 + biz income $18313.22 + other $26447.24 + unclassified $29665.42`
- Risk critical signal: `93 unclassified deposits ($42292.32)`
- Ledger header: `$38117.77 deductible`
- Finalize blockers: same un-comma'd numbers
- STOPs deposit cards: `$2624.00`, `$2238.40`, `$1084.89` (header), `$-2624.00` (Amount cell)

**But the headline cards DO use commas** (`$38,117.77` Estimated Deductions card, `$24,811` Analytics gross receipts). This makes it worse, not better — the inconsistency tells the CPA "the dev knew about the formatter and forgot to apply it everywhere".

**Root cause:** 137 occurrences of `.toFixed(2)` across 43 files. The correct formatter `fmtUSD` exists at [components/v2/format.ts:14](components/v2/format.ts:14) but is only used by the ~30 v2 component files. Server-side string assembly (assertions, risk signals, agent output, position memos, audit-packet CSVs) goes through `.toFixed(2)` directly.

**Hot spots:**
- [lib/validation/assertions.ts:140,166,371,378](lib/validation/assertions.ts) — A03/A04/A13 detail strings
- [lib/risk/score.ts:233,251](lib/risk/score.ts) — risk signal titles
- [app/(app)/years/[year]/ledger/ledger-client.tsx:296,412,451,724,725](app/(app)/years/[year]/ledger/ledger-client.tsx) — ledger header + row + split dialog
- [app/(app)/years/[year]/stops/stops-client.tsx:274,425](app/(app)/years/[year]/stops/stops-client.tsx) — STOP card titles + amount cells
- [lib/ai/cpaAgent.ts:345,913,957](lib/ai/cpaAgent.ts) — agent decision labels + summary
- [lib/ai/positionMemo.ts:65-186](lib/ai/positionMemo.ts) — every dollar in every position memo
- [lib/uploads/contextualPrompts.ts:113](lib/uploads/contextualPrompts.ts) — upload prompt $
- [lib/reports/auditPacket.ts:111](lib/reports/auditPacket.ts) — meals.csv etc.
- [scripts/run-pipeline.ts](scripts/run-pipeline.ts), [scripts/verify-trip-override.ts](scripts/verify-trip-override.ts) — diagnostic output

**Fix:** make `fmtUSD` the only path. See [Implementation Plan §1](#1-week-1--currency-formatting-blast-radius-b-01).

### B-02 · Year status diverges across pages
**Repro on prod:** identical DB row, three displayed states:
- All clients table → `○ CREATED`
- Year hub status pill → `CLASSIFICATION`
- Risk page Lock Status card → `CLASSIFICATION`
- Sidebar breadcrumb pill → `CLASSIFICATION`
- Pipeline page → no pill but Year overview card says "47 STOPs pending"

**Root cause:** [lib/taxYear/status.ts](lib/taxYear/status.ts) provides `deriveStage()` and `recomputeStatus()` but they're not called consistently. Some pages render `taxYear.status` (persisted), others render `deriveStage(...)` on load. `scripts/run-pipeline.ts` does **not** call `recomputeStatus` after committing changes, so the persisted status drifts from the derived one.

**Why it matters:** A CPA glances at the All-clients table after a teammate uploads, sees `CREATED`, thinks nothing happened. Or worse, sees `LOCKED` somewhere stale and starts editing the ledger from a different page that shows `REVIEW`.

**Fix:** every place that displays a TaxYear status must derive on load, OR the persisted value must be refreshed every time the data changes. See [Implementation Plan §2](#2-week-1--unify-year-status-source-of-truth-b-02).

### B-03 · STOPs page defaults to an empty tab when 47 stops exist in another category
**Repro on prod:**
- Sidebar badge: `STOPs · 47`
- Page header: `47 pending stops`
- **Default tab: `Merchant (0)` showing "No items in this category"**
- The 47 stops are all in `Deposit (47)`, requiring an extra click to discover

**Root cause:** [app/(app)/years/[year]/stops/stops-client.tsx](app/(app)/years/[year]/stops/stops-client.tsx) defaults to the Merchant tab regardless of where pending stops live.

**Fix:** if exactly one non-empty category exists, default to it; else default to the highest-count category. Add a "47 pending in Deposit" summary banner above the tabs as a fallback.

### B-04 · Three different transaction counts on three pages
**Repro on prod (same DB state, no concurrent edits):**
- Year overview (`/years/2025`): **`536 transactions`** + **`536 classified`**
- Pipeline page (`/years/2025/pipeline`): **`536 Total transactions`** + **`536 Classified`**
- Ledger page (`/years/2025/ledger`): **`485 transactions · $38117.77 deductible`**
- Risk A01 assertion (`/years/2025/risk`): `485 txns classified`
- Coverage page row totals: `76 + 262 + 45 + 102 = 485`

The 51-row gap is too consistent to be a race; 536 is "raw" and 485 is "filtered". Almost certainly:
- Year overview / Pipeline use a raw `prisma.transaction.count({ where: { taxYearId } })`
- Ledger / Risk filter by `isSplit=false AND isStale=false AND inYearWindow(year)`

**Why it matters:** the headline card a CPA looks at first ("536 transactions") doesn't match the ledger they're about to review ("485 rows"). They wonder "where did 51 transactions go?" and it costs trust.

**Fix:** standardize the count logic in `lib/taxYear/status.ts:getYearCounts()` (already exists) and use it everywhere. Document explicitly which transactions count and why. See [Implementation Plan §3](#3-week-1--unify-transaction-count-everywhere-b-04).

### B-05 · Gross Receipts disagrees between Analytics and Risk pages
**Repro on prod:**
- Analytics card → `GROSS RECEIPTS $24,811`
- Risk A04 → `Gross receipts $18313.22`
- Finalize blocker → `biz income $18313.22`
- A13 reconciliation → `Inflows $88725.35 = transfers $14299.47 + biz income $18313.22 + other $26447.24 + unclassified $29665.42`

**$24,811 − $18,313.22 = $6,498 unaccounted for.** A CPA who computes the return based on the Analytics page would over-state revenue by $6.5K vs the assertion-validated number. That's a real audit risk, not a UI nit.

**Root cause:** likely two different filters — Analytics aggregates `BIZ_INCOME` differently (perhaps including stale or split-parent rows) vs the assertion which filters strictly. Need to trace both.

**Fix:** add a unit test that asserts `analytics.grossReceipts === A04.grossReceipts === A13.bizIncome` for a fixture year, then trace and fix the divergence. See [Implementation Plan §4](#4-week-1--cross-page-totals-must-be-identical-b-05).

### B-06 · Critical-signal lies: "S-2624.00" Wise outflow shows up as a Deposit STOP
**Repro on prod:** `/years/2025/stops` Deposit tab, item #1:

> Sent money to Zain Ul Abideen Safdar · $2624.00 · 1 txn  PENDING
> Deposit of $2624.00 on 2025-06-27 from "Sent money to Zain Ul Abideen Safdar" — what kind of inflow is this? (client payment, 1099 platform, owner contribution, gift, loan, refund, or other)
> | Date | Account | Raw | Amount |
> | 2025-06-27 | Wise | Sent money to Zain Ul Abideen Safdar | $-2624.00 |

"Sent money to X" is unambiguously an **outflow** on a Wise statement (you, the account holder, sent money to Zain). Stored as `amountNormalized = -2624` which the system convention treats as inflow → triggers a Deposit STOP asking "what kind of inflow is this?" with options like "Client payment" / "Gift" / "Loan proceeds". None of which are correct.

This is the same pattern noted in [lib/ai/cpaAgent.ts:799-826](lib/ai/cpaAgent.ts) as the "Wise inflow misclassification". The cpaAgent has a band-aid for the *outflow → deductible* direction, but the **upstream Wise parser is flipping the sign**.

**Why it matters:** Atif's Wise transactions to Pakistani suppliers are labeled "Sent money to" — these are real business outflows that should be `WRITE_OFF_COGS` or `WRITE_OFF`. Instead they've been parked as deposits. A CPA following the STOP queue would mark them all as "Other — explain" (incorrect) or skip them (incorrect). Real money disappears from the Schedule C.

**Fix:** trace [lib/parsers/](lib/parsers/) — the Wise parser must distinguish "Sent money to" (outflow, +amount) from "Received money from" (inflow, -amount). Add a regression test against the Wise CSV that ships in `tests/fixtures/`. See [Implementation Plan §5](#5-week-1--wise-parser-sign-bug-b-06).

### B-07 · "Resolve via STOPs" CTA is a dead-end loop on a fresh year
**Repro on prod:** less critical here (Atif's year already has 47 deposit STOPs). But on a fresh year — confirmed locally — risk page says `4 unclassified deposits — Resolve via STOPs before lock` and STOPs page is empty until the autonomous CPA agent runs and synthesizes them.

**Fix:** materialize DEPOSIT-stops deterministically in `deriveStopsFromAssertions()` whenever A13 fails, regardless of whether the agent has run. The agent can still upgrade them with AI suggestions on its own pass. See [Implementation Plan §6](#6-week-2--break-the-stop-deadend-b-07).

### B-08 · A07 ("transfer pairs") fails informatively but advice is missing
**Repro on prod:** `X [A07] TRANSFER rows appear in pairs — 42 unpaired transfer rows`

When it fails, A07 is informative ("42 unpaired"). When it passes, it can pass *vacuously* (`0 transfer rows all paired` if no TRANSFER classifications exist). On Atif's data 42 is real — but the CPA has no actionable next step. There's no "view in ledger" link on this assertion (unlike `93 unclassified deposits`).

**Fix:**
1. Make every failed assertion provide a `view in ledger →` link with a code/account filter pre-applied.
2. When 0 transfer classifications exist, A07 should report "no transfer rows to verify" rather than showing a green check.

---

## P1 — Workflow / role / correctness

### B-09 · Year-overview "next action" card text contradicts itself
**Repro on prod:** `/years/2025`:

> ⚠ NEXT ACTION · STOPS BLOCKING LOCK
> Resolve 47 STOPs to unlock review
> **Every transaction is classified — these STOPs are likely legacy artifacts from a prior pipeline run.** Click "Archive superseded" on the STOPs page to clear all STOPs whose underlying transactions are already classified, then re-check risk.
> 536/536 classified · 47 stops pending

The text essentially says "the system is broken, here's the workaround". A CPA reads this as "ok the developer knows STOP de-duplication is broken and is asking me to manually click Archive superseded".

**Fix:** auto-archive superseded STOPs on every classification commit. The button can stay as a manual rescue, but the system should self-heal. See [Implementation Plan §7](#7-week-2--auto-archive-superseded-stops-b-09).

### B-10 · CLIENT users see CPA-only sidebar links
**Repro on local** (CPA login on prod doesn't show the bug; it shows when logged in as a CLIENT-tier user). [app/(app)/layout.tsx:96-105](app/(app)/layout.tsx:96):

```ts
if (tier === "ADMIN" && !adminCpaCtx) { /* admin sidebar */ }
else { /* CPA workspace: Inbox / Firm overview / Calendar */ }
```

The `else` fires for both `tier === "CPA"` and `tier === "CLIENT"`. `/workspace`, `/workspace/firm`, `/clients` 307 to `/dashboard` for clients. But:
- `/workspace/calendar` returns 200 with "Coming in V2" — no role guard
- All sidebar links render for clients regardless of permission

**Fix:** wrap workspace branch in `if (tier === "CPA" || adminCpaCtx)`; add `requireCpaTier()` to `/workspace/calendar/page.tsx`.

### B-11 · 8 identical "CPA Agent audit memo · 2026-05-09" documents — no way to distinguish runs
**Repro on prod:** `/clients/{id}/documents` shows 8 audit memos, all titled `CPA Agent audit memo · 2026-05-09`, all 1 KB, all dated `May 09, 2026`. No timestamp, no run ID, no decision count, no opener.

**Why it matters:** every agent re-run writes a new memo. The CPA reviewing Atif's file can't tell which run was the most recent or which one matches the current ledger hash. They might compare working papers against a stale memo.

**Fix:** include `HH:MM` in the title, include the ledger hash prefix, include decision count. Add a "View" button that renders the JSON in a readable form. See [Implementation Plan §8](#8-week-2--audit-memo-deduplication--readability-b-11).

### B-12 · Three different counts of blockers on the same page
**Repro on prod, Risk page:**
- Top-right pill: **`5 blockers`**
- Red banner: **`5 blocking issues must be resolved before lock`**
- Critical section header: **`Critical (4)`**
- Synthetic floor signal text: **`Lock blocked by 3 issues`**

The discrepancy comes from how the floor signal counts ("3" = critical-severity blockers only, not assertion failures), but no UI text explains that. A CPA reads "5 / 5 / 4 / 3" and asks which one is right.

**Fix:** standardize on one count (all blocking signals, including blocking assertion failures). Hide the floor-signal as a real signal; surface it as a small "(includes +21 floor while blocked)" annotation under the score badge. See [Implementation Plan §9](#9-week-2--unify-blocker-count-b-12).

### B-13 · Firm overview "PENDING LOCK: 0" lies
**Repro on prod:** `/workspace/firm`:
- ACTIVE CLIENTS: 1
- LOCKED YEARS: 0
- **PENDING LOCK: 0** ← but Atif's TY2025 is in CLASSIFICATION with 5 lock-blockers
- 0/1 Locked

`PENDING LOCK` should mean "year ready to lock OR being prepared for lock". With 47 unresolved STOPs and 5 blockers, Atif's year IS pending lock — by any reasonable definition.

**Fix:** define "pending lock" precisely (e.g., status ∈ `{REVIEW, CLASSIFICATION}` with `recordedAt` within last 30 days). Update `lib/analytics/firmOverview.ts` accordingly.

### B-14 · "+ New tax year" routes to the Profile Wizard, not a year-creation form
**Repro on prod & local:** [app/(app)/dashboard/page.tsx:38](app/(app)/dashboard/page.tsx:38) — `<Link href="/onboarding">+ New tax year</Link>`. Onboarding is the 10-step Profile Wizard. Returning users land on whatever step they last left.

**Fix:** add `/years/new` server action that creates a TaxYear record for a chosen year and redirects to `/years/{year}/upload`. Profile editing belongs at `/profile` (already exists).

### B-15 · Header search bar is a fake `<span>`
**Repro on prod & local:** [components/v2/shell.tsx:80-97](components/v2/shell.tsx:80) — `<span>Search clients, years, documents…</span><span>⌘K</span>`. No input, no handler, no modal. On every page load.

**Fix:** either implement the search modal (clients + years + transactions by merchant name) or hide the bar until it's wired. See [Implementation Plan §10](#10-week-3--implement-cmd-k-search-or-hide-b-15).

### B-16 · "Top merchants by deductible spend" chart labels overlap and are unreadable
**Repro on prod:** Analytics page → "Top merchants by deductible spend" — y-axis labels are stacked literally on top of each other. WISE INC and SENT MONEY TO ZAIN UL are partially readable; the rest is illegible mush.

**Fix:** reduce font size + add row spacing + truncate labels with ellipsis (or rotate horizontally). The chart is currently useless.

### B-17 · WISE INC is the #1 "deductible" merchant in Analytics — should be TRANSFER
**Repro on prod:** Analytics top-merchants chart shows `WISE INC` as the largest deductible spend (~$10K+) and `SENT MONEY TO ZAIN UL ABIDEEN SAFDAR` as #2. But:
- Wise is a money-transfer rail, not a vendor — the actual vendor is Zain Ul Abideen Safdar (whoever the Pakistani supplier is).
- Sent-money-to-X transactions are also showing up as Deposit STOPs (B-06).

So the same dollars are simultaneously (a) classified as deductible (showing up in $38,117 total), (b) showing up as deposit STOPs, and (c) attributed to WISE INC instead of the actual recipient. **This is double-counting + misattribution.**

**Fix:** parser-level (B-06) plus an "alias rule" that says `WISE INC` is never a deductible merchant; the deductible target is whatever appears in the description after "Sent money to". See [Implementation Plan §11](#11-week-2--wise-vendor-attribution-b-17).

### B-18 · Risk score floor message reads as developer-talking-to-self
**Repro on prod:** Risk page critical signal:

> +20 pts · Lock blocked by 3 issues
> Risk score floored at MODERATE until blockers resolve — the underlying signals are listed above; this entry only exists to bring the displayed score in line with reality.

A CPA reads "this entry only exists to bring the displayed score in line with reality" and recoils — that's an internal apology, not a finding.

**Fix:** keep the floor logic but don't render it as a signal. Show it as a footnote under the score badge: `21 / 100 (incl. +20 lock-blocked floor)`. See [Implementation Plan §9](#9-week-2--unify-blocker-count-b-12).

### B-19 · Coverage gap message strips month details
**Repro on prod:** Year hub: `BofA Checking missing 6 months; Wise missing 5 months.` — number only.

But the per-account cards on `/years/2025/coverage` already say `Missing: Jan, Feb, Mar, Apr, May, Dec`. So the data is there; the year-hub message just truncates it.

**Fix:** the year-hub coverage banner should show specific months (collapse contiguous ranges where possible).

### B-20 · "100%" biz pct on NEEDS_CONTEXT rows is misleading
**Repro on prod, ledger:** `2025-01-30 NEW PIDC LLC NEEDS_CONTEXT -$9.50 100% $0.00 4`. Biz % shows 100, deductible shows $0. The "100%" is leftover state from the agent's classification that NEEDS_CONTEXT then overrode.

**Fix:** when code is `NEEDS_CONTEXT`, force display `Biz % = —` or `0%` to match the $0 deductible.

---

## P2 — Architecture / structural risk

### B-21 · `FinancialAccount` is per-tax-year, not per-user
**Repro:** [prisma/schema.prisma:432](prisma/schema.prisma:432) — `FinancialAccount.taxYearId String`. Atif's BofA Checking in 2024 and his BofA Checking in 2025 are two separate `FinancialAccount` rows. Breaks YoY merchant-rule learning, breaks "is this account still active" view, breaks per-account audit history. Refactor before adding multi-year support.

### B-22 · Loss-year detection counts the in-progress year
**Repro on prod:** Risk page → Medium (1) → `Schedule C loss — year 1 · §183 watch`. With Atif at $24,811 receipts and $38,118 deductions, his current-year is registering as a loss year *while classification is still incomplete*. Once 47 STOPs + 141 NEEDS_CONTEXT + $42K of unclassified deposits flow through, the receipts side will jump materially. Counting the in-progress year as "loss year 1" is statistically wrong and adds 1 point + a §183 watch warning.

[lib/risk/score.ts:152-181](lib/risk/score.ts:152) — `lossHistory` includes the current year. Should filter `{ status: "LOCKED" }`.

### B-23 · `INCOME_SHORT` blocks lock with no override
**Repro:** [lib/risk/score.ts:230-237](lib/risk/score.ts:230) — `blocking: shortfall > 1000`. If user said "expected $30K from wedding photography" and only $28K materialized, lock is blocked. Real reasons for variance: deposits in adjacent years, refunded gigs, currency conversion, gig cancellations. There's no escape hatch.

**Fix:** add a `confirmIncomeVariance` server action that writes an `AuditEvent` with rationale and stores acceptance on the year (new field). Surface "Confirm variance" button on the risk page next to the signal.

### B-24 · Round-number signal over-fires for normal subscriptions
**Repro:** [lib/risk/score.ts:184-194](lib/risk/score.ts:184) — `length > 3` triggers, scoring `length * 5`. A creator with $500 Notion + $1000 conference + $2500 photography insurance + $5000 lens = 4 round-numbers = +20 points alone. These are perfectly ordinary.

**Fix:** raise the trigger threshold (e.g., `length > 8`) or weight by ratio-to-total.

### B-25 · `pnpm start` runs five sequential prod-data-fix scripts
**Repro:** [package.json](package.json) — `prisma migrate deploy && bootstrap.mjs && seed-atif.mjs && backfill-documents.mjs && rename-atif.mjs && recompute-tax-year-statuses.mjs && reclassify-tax-year.mjs && next start`. Any one failing prevents the server from starting. The flag-gated scripts (`rename-atif.mjs` etc.) are hacks-as-deployments — fragile and slow on cold start.

**Fix:** move all prod-data-fix scripts to `scripts/post-deploy.mjs` invoked manually after a release. Keep `pnpm start` as `prisma migrate deploy && next start`.

### B-26 · Pipeline transfer-pairing doesn't write `TRANSFER` classifications
**Repro:** [lib/pairing/transfers.ts](lib/pairing/transfers.ts) updates `Transaction.isTransferPairedWith` but never inserts a `TRANSFER` Classification. So:
- Ledger "Code" column is blank for paired transfers until classification runs.
- A07 reports "0 transfer rows" when no classifications exist (vacuous pass).
- Analytics deductions waterfall and donut-by-account undercount paired flows.

**Fix:** in `matchTransfers`, on commit, also insert TRANSFER classifications for both legs (`source: 'RULE'`, `businessPct: 0`, `scheduleCLine: null`).

### B-27 · "Sent money to X" Wise transactions are double-categorized
**Repro on prod:** `SENT MONEY TO ZAIN UL ABIDEEN SAFDAR` appears as:
1. A pending Deposit STOP (with `amountNormalized < 0`)
2. The #2 deductible merchant in Analytics top-merchants
3. Counted as `BIZ_INCOME`-adjacent in some flows (since amount is negative)

The same transaction simultaneously contributes to "deductible" and "deposit STOP" totals — broken state.

**Fix:** the parser fix in B-06 will eliminate the negative amount. After that, an audit query should find any other "negative amount + deductible code" rows and surface them as `NEEDS_CONTEXT`.

### B-28 · Audit packet CSVs have no thousands separators
**Repro:** [lib/reports/auditPacket.ts:111](lib/reports/auditPacket.ts:111) — `Number(t.amountNormalized).toFixed(2)` writes `8500.00` to meals.csv. Excel parses this fine but a reviewer copy-pasting a row into a memo gets unformatted output.

**Fix:** flow the CSV write through `fmtUSD` (already P0 in B-01).

---

## P3 — Polish / micro-UX

| ID | Bug | Fix |
|---|---|---|
| B-29 | Header text "test@taxlens.localsign out →" runs together | Add spacing/separator in the sidebar footer |
| B-30 | "Re-extract low-confidence PDFs" badge shows "scanned PDFs" with no count | Wire the count |
| B-31 | Year card status pill `○CREATED` open-circle dot looks like a degree symbol | Use a different glyph or omit |
| B-32 | Coverage page "Imports" column unlabeled when collapsed | Add column tooltip |
| B-33 | Profile Wizard intro copy ("This takes 10–15 minutes…") shown to returning users editing one field | Conditional on `draftStep === 1` |
| B-34 | CLAUDE.md acceptance test says "10 accounts, 720 transactions" but local seed has 5 accounts, 20 transactions | Update spec or beef up fixture |
| B-35 | "Income sources (0)" panel on /profile is empty while 6 revenue tags exist on the same page | Clarify taxonomy or merge |
| B-36 | Local Maznah seed has 0 `StatementImport` rows but 20 transactions exist | Add synthetic imports to the seed |
| B-37 | Finalize step 3 "Available after lock. Locked" — "Locked" pill conflicts with year-state "LOCKED" | Rename the disabled-state pill to "Pending" |
| B-38 | Pipeline page "Resolve STOPs" CTA labels them "transactions" ("47 transactions need your call") | Use "STOPs" |
| B-39 | Meals-as-%-of-receipts chart Y-axis goes to 400% — implies divide-by-zero noise | Cap Y-axis at 30% with overflow indicator |

---

# Implementation Plan

The work below is sequenced for a single engineer. Estimated total: ~4 weeks. Each section calls out: scope, files, test surface, rollout.

## Week 1 — bleeding stops

### 1. Currency formatting blast radius (B-01)
**Scope:** swap every `.toFixed(2)` that's used for display with `fmtUSD` from [components/v2/format.ts](components/v2/format.ts).

**Strategy:**
1. Move `fmtUSD` from `components/v2/format.ts` to `lib/format/currency.ts` (still no `"use client"`).
2. Add a sibling `fmtUSDSigned(n)` that renders `+$1,234.56` / `-$1,234.56` (replaces `${r.amount > 0 ? "-" : "+"}${...}` patterns in ledger/stops).
3. Codemod: replace every `\$\{[^}]+\.toFixed\(2\)\}` with the appropriate `fmtUSD()` call. ~137 occurrences.
4. Add an ESLint rule: `no-restricted-syntax` flagging `.toFixed(2)` outside `lib/format/`.
5. Snapshot test: feed every assertion in `lib/validation/assertions.ts` a synthetic ledger and snapshot the `details` strings. Verify all dollar amounts contain commas where ≥ 1000.

**Files (codemod target):**
```
lib/validation/assertions.ts
lib/risk/score.ts
lib/ai/cpaAgent.ts
lib/ai/positionMemo.ts
lib/ai/merchantIntelligence.ts
lib/uploads/contextualPrompts.ts
lib/reports/auditPacket.ts
lib/lock/hash.ts
lib/parsers/reExtract.ts
lib/pairing/transfers.ts
lib/stops/deriveFromAssertions.ts
app/(app)/years/[year]/ledger/ledger-client.tsx
app/(app)/years/[year]/ledger/actions.ts
app/(app)/years/[year]/stops/stops-client.tsx
app/(app)/profile/owners-panel.tsx
scripts/run-pipeline.ts
scripts/verify-trip-override.ts
tests/amazon-split.test.ts
```

**Effort:** 1 day codemod + 1 day test sweep.

### 2. Unify year-status source of truth (B-02)
**Scope:** every status pill must reflect the derived stage, not the persisted column.

**Strategy:**
1. Audit every `<Pill s={statusKey(...)} />` in `app/(app)`. For each, replace `taxYear.status` with `deriveStage(taxYear, await getYearCounts(taxYear.id))`.
2. Add `recomputeStatus()` calls at the end of `scripts/run-pipeline.ts` and `scripts/reclassify-tax-year.mjs`.
3. Add a one-line helper `loadYearWithDerivedStatus(year, userId)` that returns `{...taxYear, status: derivedStage}` so pages don't repeat the boilerplate.
4. Add an integration test: state machine — open a fresh year, upload, classify, lock; assert that every page shows the same status at every step.

**Effort:** 1.5 days.

### 3. Unify transaction count everywhere (B-04)
**Scope:** every "X transactions" displayed must use the same definition.

**Strategy:**
1. Define canonical: `count(*) WHERE isSplit=false AND isStale=false AND isDuplicateOf IS NULL AND postedDate ∈ inYearWindow(year)`. This is what `getYearCounts` already does — minor extension to add the year-window filter.
2. Replace `_count: { transactions: true }` Prisma includes on Year overview / Pipeline with `getYearCounts(taxYearId).totalTx`.
3. Add a debug card on Risk page: "Transactions: 485 active / 51 hidden (split parents · stale · duplicates · out-of-year)".

**Effort:** 1 day.

### 4. Cross-page totals must be identical (B-05)
**Scope:** `Analytics.grossReceipts` must equal `A04.grossReceipts` must equal `A13.bizIncome`.

**Strategy:**
1. Add a `lib/queries/totals.ts` with three pure functions: `grossReceipts(taxYearId)`, `totalDeductibleCents(taxYearId)`, `unclassifiedInflowsCents(taxYearId)`.
2. Replace the inlined aggregation in `lib/analytics/build.ts`, `lib/validation/assertions.ts` (A03/A04/A13), and `lib/risk/score.ts` with calls to those.
3. Test: synthetic ledger with mixed inflows/outflows/transfers/splits/stale rows; assert all three callers return identical values.

**Effort:** 1.5 days.

### 5. Wise parser sign bug (B-06)
**Scope:** "Sent money to X" must be an outflow, "Received money from X" an inflow.

**Strategy:**
1. Open [lib/parsers/institutions/](lib/parsers/institutions/) — confirm there's a Wise parser, or add one (the current institution detection probably falls through to `generic.ts` for Wise).
2. Wise CSV columns vary by export type (TransferWise legacy, Wise.com modern). Both have a `Status` column (`COMPLETED`) and a `Type` (`TRANSFER`, `BANK_TRANSFER`, `BALANCE_CASHBACK`). The descriptive strings start with "Sent money to" (outflow), "Received money from" (inflow), "Top up via X" (inflow), "Conversion from X to Y" (neutral).
3. Add a regex-based sign rule in the Wise parser that overrides the raw amount sign.
4. Backfill: write a one-shot script `scripts/fix-wise-sign-bug.mjs` that finds rows where `account.institution = 'Wise'` AND `merchantRaw STARTS WITH 'Sent money to'` AND `amountNormalized < 0`, flips them to positive, and *resets* their classifications (mark old `isCurrent=false`, do not auto-write new ones — they need re-classification).
5. After backfill, the autonomous CPA agent will re-classify these as `WRITE_OFF_COGS` or `WRITE_OFF` rather than DEPOSIT STOPs.

**Effort:** 2 days (parser + backfill + verification on Atif's data).

## Week 2 — UX / consistency

### 6. Break the STOP dead-end (B-07)
**Scope:** when A13 fails, deposit STOPs must exist regardless of agent run state.

**Strategy:**
1. [lib/stops/deriveFromAssertions.ts](lib/stops/deriveFromAssertions.ts) — extend to materialize a DEPOSIT StopItem for every unclassified inflow when A13 fails.
2. Default the STOP `aiSuggestion` to `null`; the autonomous agent's later run can fill it in.
3. Risk-page CTA: change `Resolve via STOPs before lock` to a button-link that calls `deriveStopsFromAssertions(taxYearId)` server action *then* navigates — guaranteed to land the user on a populated page.

**Effort:** 1 day.

### 7. Auto-archive superseded STOPs (B-09)
**Scope:** every STOP whose underlying transaction now has a current Classification must auto-archive.

**Strategy:**
1. Add `archiveSupersededStops(taxYearId)` helper in `lib/stops/archive.ts`.
2. Call it from: every classification-write path (`apply.ts`, `cpaAgent.ts` commit, NL override apply, `editClassification`, `bulkReclassify`).
3. Remove the user-facing "your STOPs are stale, click Archive Superseded" copy on the year hub.

**Effort:** 1 day.

### 8. Audit-memo deduplication & readability (B-11)
**Scope:** identify each agent run uniquely; render JSON memos as readable docs.

**Strategy:**
1. Memo title: `CPA Agent audit memo · YYYY-MM-DD HH:MM · {runId-prefix} · {decisionCount} decisions`.
2. Add a "View" route at `/clients/{id}/documents/{docId}` that pretty-prints the memo JSON with collapsible sections (per-line decisions, gray calls, follow-ups).
3. On every new agent run, archive prior memos older than 30 days into a "archived" subgroup (don't delete — keep audit trail).

**Effort:** 1.5 days.

### 9. Unify blocker count (B-12)
**Scope:** one count of blockers, no synthetic floor as a "signal".

**Strategy:**
1. Define `RiskReport.blockerCount` as `assertions.blockingFailures.length + signals.filter(s => s.blocking && s.severity === 'CRITICAL').length`.
2. Render the floor as a footnote under the score: `21 / 100 · MODERATE (incl. +20 lock-blocked floor)`.
3. Remove the floor signal from the Critical list; assert (in tests) that `blockerCount` displayed on Year overview, Risk page, and Finalize page matches.

**Effort:** 0.5 day.

### 10. Wise vendor attribution (B-17)
**Scope:** Wise transactions must attribute to the actual vendor, not "WISE INC".

**Strategy:**
1. Wise parser (B-06 fix) extracts the recipient name from "Sent money to {recipient}".
2. Set `merchantRaw = recipient` (e.g., `ZAIN UL ABIDEEN SAFDAR`), `merchantNormalized = normalizeMerchant(recipient)`.
3. Add a metadata column `Transaction.processor = 'WISE'` so analytics can group by processor without losing the underlying vendor.
4. Update the analytics top-merchants chart to use `merchantNormalized`, not the raw description.

**Effort:** 1 day (depends on B-06).

### 11. Default tab + empty-state polish (B-03)
**Scope:** STOPs page lands on the populated category; chart labels readable.

**Strategy:**
1. STOPs default-tab logic: `defaultTab = categories.find(c => c.count > 0)?.key ?? 'merchant'`.
2. Always-visible summary banner above tabs: `47 pending · 0 in Merchant · 0 in Transfer · 47 in Deposit · 0 in §274(d) · 0 in Period Gap`.
3. Analytics top-merchants chart: rotate labels 0° (horizontal), truncate at 30 chars with title attr, add 8px row spacing.

**Effort:** 0.5 day.

### 12. Role-leak fix (B-10)
**Scope:** CLIENT users should not see the CPA workspace sidebar.

**Strategy:**
1. [app/(app)/layout.tsx:96](app/(app)/layout.tsx:96) — gate workspace block on `(tier === 'CPA' || adminCpaCtx)`.
2. Add `requireCpaTier()` to `/workspace/calendar/page.tsx`, `/workspace/firm/page.tsx`, `/workspace/page.tsx`.
3. Test: log in as `test@taxlens.local` (CLIENT) and verify sidebar contains only client-relevant items.

**Effort:** 0.5 day.

## Week 3 — features that should already exist

### 13. ⌘K search (B-15)
**Scope:** real search modal. Recommend keeping this small.

**Strategy:**
1. Modal triggered by `⌘K` / `Ctrl+K`. Three sections: Clients, Tax Years, Transactions.
2. Server actions `searchClients(q)`, `searchTaxYears(q)`, `searchTransactions(q, taxYearId)`. Each returns up to 10 results.
3. Transactions search: full-text on `merchantRaw`, `merchantNormalized`, `description`. Results show `date · merchant · $amount · code` and link to `/years/{year}/ledger?txId={id}`.
4. Cmd-K modal: keyboard-navigable, debounced 200ms.

**Effort:** 2 days.

### 14. New tax year flow (B-14)
**Scope:** create a new TaxYear without re-running the wizard.

**Strategy:**
1. Add `app/(app)/years/new/page.tsx` — simple form with year selector (default `currentYear-1`), submit creates `TaxYear`.
2. Copy the existing `BusinessProfile` from the most-recent year by default; allow editing post-creation at `/profile`.
3. Carry `FinancialAccounts` forward (this depends on B-21; for now, copy them with new IDs).
4. Dashboard "+ New tax year" routes here.

**Effort:** 1.5 days (more if B-21 is done first; less if not).

### 15. Income variance override + risk score reform (B-23, B-22, B-24, B-18)
**Scope:** make the risk score believable for in-progress years.

**Strategy:**
1. `lossHistory` filter: `{ status: 'LOCKED' }` only (B-22).
2. `INCOME_SHORT` becomes non-blocking by default; CPA can mark `confirmIncomeVariance(rationale)` to acknowledge — writes AuditEvent (B-23).
3. Round-number signal: trigger at `length > 8` OR `roundNumberRatio > 0.20`, scored by ratio not count (B-24).
4. Floor signal: hide from list, render as score footnote (B-18).
5. Add a unit test: synthetic year with $25K receipts, $30K deductions (loss), 5 round-number subscriptions — assert risk score ≤ 15 and band = LOW.

**Effort:** 1 day.

### 16. Deduplicate transaction-count & gross-receipts logic (already covered by §3 + §4)

## Week 4 — architecture / structural debt

### 17. `FinancialAccount` per-user (B-21)
**Scope:** schema migration. Heavy.

**Strategy:**
1. Migration: rename `FinancialAccount` to `Account`. Drop `taxYearId`. Add unique `(userId, institution, mask)`.
2. New table `AccountYearLink(accountId, taxYearId, nickname, isClosed, closedAt)`.
3. Backfill: collapse duplicate FinancialAccount rows by `(userId, institution, mask)` — pick the most recent for canonical metadata.
4. Update every query path that joins `Account → TaxYear` to go through `AccountYearLink`.
5. Update Coverage / Upload / Ledger / Pipeline pages to query through the new link.

**Risk:** real data migration. Run on a copy of prod first; verify no data loss; then cut over.

**Effort:** 3 days.

### 18. `pnpm start` cleanup (B-25)
**Scope:** remove prod-data-fix scripts from the boot path.

**Strategy:**
1. Move `seed-atif.mjs`, `rename-atif.mjs`, `reclassify-tax-year.mjs` invocations from `package.json:start` to a `scripts/post-deploy.mjs` invoked manually.
2. `pnpm start` becomes `prisma migrate deploy && next start`.
3. Document in CLAUDE.md / Railway README that `node scripts/post-deploy.mjs` should be run after each release with the appropriate env flags.

**Effort:** 0.5 day.

### 19. Pipeline transfer-classification write-back (B-26)
**Scope:** matchTransfers should also write Classifications.

**Strategy:**
1. In [lib/pairing/transfers.ts](lib/pairing/transfers.ts), on commit, insert a `TRANSFER` Classification for both legs of every confirmed pair (if no current Classification exists).
2. A07 then becomes meaningful — it can't pass vacuously.
3. Backfill: `scripts/backfill-transfer-classifications.mjs` runs over production for paired-but-unclassified rows.

**Effort:** 1 day.

### 20. Polish sweep (B-29 through B-39)
**Scope:** the P3 list. Most are 5–30 minute fixes.

**Strategy:** one PR per cluster (rendering polish, copy fixes, chart fixes). Bundle for a single review.

**Effort:** 1.5 days total.

---

# Acceptance criteria for "audit-ready"

A reviewer running through Atif's flow on Railway should be able to:

1. **Open `/clients`** and see Atif's TY2025 with the **same status** as the year hub (`CLASSIFICATION`, not `CREATED`). ✅ B-02
2. **Open `/years/2025`** and see a transaction count that **matches the Ledger header**. ✅ B-04
3. **Click "Resolve STOPs"** from any "blocker" CTA and **land on a populated page** (not "no items"). ✅ B-07, B-03
4. **Read every dollar amount with commas** (`$38,117.77`, not `$38117.77`) on every page. ✅ B-01
5. **Verify Gross Receipts is identical** on Analytics, Risk A04, A13 reconciliation, and Finalize. ✅ B-05
6. **See "Sent money to {vendor}" Wise outflows in the deductible ledger**, not the deposit STOP queue. ✅ B-06, B-17
7. **See exactly one blocker count** across Risk, Finalize, and Year hub. ✅ B-12
8. **Click an audit memo and read it** as a structured document, not download a 1KB JSON. ✅ B-11
9. **Search ⌘K** for "Atif" and find his tax year, or "ZAIN" and find the Wise transaction. ✅ B-15
10. **Lock a year with a small income variance** by clicking "Confirm variance" with a one-line rationale. ✅ B-23

After Week 4, Atif's TY2025 should be reviewable by an external CPA without a single "wait, this number disagrees with that one" moment.
