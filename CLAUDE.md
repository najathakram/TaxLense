@AGENTS.md

# TaxLens — Project Context for Claude Code

## What this project is

A web application that takes a self-employed person's raw bank/card statements (PDF, CSV) and produces a locked master transaction ledger, a 5-sheet financial statements workbook (General Ledger, Schedule C, P&L, Balance Sheet, Schedule C Detail), and an audit defense packet — with every deductible dollar carrying an IRC citation, an evidence tier, and a confidence score.

TaxLens is an AI-first **bookkeeping reconstruction** engine. The AI does the reasoning; the user confirms or corrects; the app writes the defensible output. It is a **single-taxpayer, single-tax-year** tool in V1, **Federal Schedule C–focused**, and a **CPA handoff** tool — the user (or their CPA) files the return. The app never files anything. It is **an audit defense system** — every artifact is produced as if an IRS agent will read it next week.

TaxLens is NOT tax preparation, NOT a general accounting package, NOT a chatbot, NOT an open-ended rules engine, and NOT a "maximum deduction" tool. The app prefers the *better-documented* position over the bigger number. A defensible $30K beats a flimsy $40K every day of the week in an exam.

---

## The ten non-negotiable principles

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

## Tech stack

| Layer | Spec version | Actual installed | Notes |
|---|---|---|---|
| Next.js | 15 | **16.2.4** | Upgraded — see Implementation Notes below |
| React | 19 | 19.2.4 | |
| TypeScript | 5.x strict | 5.x | |
| Tailwind | v4 | v4 | CSS-variable config in `app/globals.css`; no `tailwind.config.js` |
| shadcn/ui | latest | manual | CLI v4.3.0 is fully interactive; components hand-written |
| Prisma | 5/7 | **v7.7.0** | See Implementation Notes; `@prisma/adapter-pg` required |
| NextAuth | v5 beta | v5.0.0-beta.31 | JWT strategy; PrismaAdapter |
| Anthropic SDK | latest | 0.90.x | claude-sonnet-4-6 (classification); claude-opus-4-7 (position memos >$5K) |
| TanStack Query | v5 | v5 | |
| TanStack Table | v8 | v8 | |
| Zustand | v5 | v5 | |
| Vitest | latest | v4.x | |
| zod | v4 | v4 | |
| bcryptjs | 3.x | 3.x | 12 rounds |
| papaparse | 5.x | 5.x | CSV parsing |
| exceljs | 4.x | 4.x | XLSX output artifacts |

---

## Build progress

- [x] Prompt 0 — Environment verified, CLAUDE.md, .env.example in place
- [x] Prompt 1 — Foundation (Next.js scaffold, Prisma schema, NextAuth, seed, route stubs, smoke tests)
- [x] Prompt 2 — Profile Wizard
- [x] Prompt 3 — Ingestion
- [x] Prompt 4 — Merchant Intelligence
- [x] Prompt 5 — STOPs + Ledger Review
- [x] Prompt 6 — Residual AI + Lock
- [x] Prompt 7 — Output Artifacts
- [ ] Prompt 8 — Polish + E2E

---

## Decisions locked

- **Runtime: Node everywhere.** No Python service in V1. pdf-parse in Node; exceljs in Node.
- **AI models:** claude-sonnet-4-6 for Merchant Intelligence Agent + Residual Transaction Agent; claude-opus-4-7 for Position Memos on gray-zone items with >$5K exposure; claude-haiku-4-5 as retry fallback for Merchant Intelligence.
- **Entity scope V1:** Sole prop / SMLLC disregarded only. S-Corp, Partnership, QJV deferred to V3.
- **Tax year V1:** One year at a time. Multi-year is V2.
- **Wardrobe default:** 0% (Pevsner-strict); 50% is opt-in with position memo.
- **Acceptance test for V1:** Reprocess the Maznah Media 2025 fixture (10 accounts, 720 transactions, multiple trips) and match locked numbers from the Excel deliverable.
- **EvidenceTier = Int (1–5)** not enum — numeric range comparisons in classification logic.
- **businessPct = Int (0–100)** — never Float.
- **FinancialAccount** not Account — avoids NextAuth adapter conflict.
- **JWT session strategy** (not database sessions) — avoids lock contention with PrismaAdapter.
- **No `src/` directory** — `@/*` alias maps directly to project root.
- **`prisma.config.ts`** holds DATABASE_URL for Prisma CLI; runtime uses `PrismaPg` adapter.
- **`proxy.ts`** not `middleware.ts` — deprecated in Next.js 16 (see Implementation Notes).
- **Transaction self-relations** use 4 named relations: TxDuplicate, TxTransfer, TxPayment, TxRefund.
- **Railway PostgreSQL** deferred — provisioning failed (account credit limit $1.85). Using local Docker Postgres (`localhost:5433`) until credits are topped up.

---

## What NOT to do

- ❌ Do NOT introduce Python. Node only for V1.
- ❌ Do NOT add features beyond V1 scope (see spec Part 13.2 — the explicit exclusion table).
- ❌ Do NOT modify Transaction, Classification, or AuditEvent rows in-place — append-only always.
- ❌ Do NOT invent IRC citations. Use the rule library only. Use `[VERIFY]` placeholders if unsure.
- ❌ Do NOT file anything, share anything externally, or modify any system permissions.
- ❌ Do NOT commit secrets or real `.env` / `.env.local` files.
- ❌ Do NOT run `npx shadcn@latest` — it's fully interactive at v4.3.0 and will hang; write components by hand.
- ❌ Do NOT use `@prisma/client` as import path — use `@/app/generated/prisma/client`.
- ❌ Do NOT add `datasourceUrl` to PrismaClient constructor — it doesn't exist in Prisma v7; use `adapter`.
- ❌ Do NOT create `middleware.ts` — use `proxy.ts` (Next.js 16).
- ❌ Do NOT use `export const runtime = 'edge'` anywhere — Prisma v7 adapter requires Node.js.
- ❌ Do NOT use `params.year` directly — `params` is a Promise in Next.js 16; always `await params` first.
- ❌ Do NOT add `@updatedAt` to Transaction, Classification, or AuditEvent.
- ❌ Do NOT use Float for businessPct or evidenceTier.

---

## Session handoff protocol

Every prompt ends by:
1. Running `pnpm test` — all tests must still pass.
2. Updating the "Build progress" checklist above.
3. Writing a `## Prompt N notes` section below with: what changed, how to verify, any open issues for next session.
4. `git add -A && git commit -m "feat(prompt-N): description"`

At the start of each prompt:
1. Run `pnpm test` — all tests must pass before writing new code.
2. Read this CLAUDE.md and the relevant spec parts for the session.
3. Read the current files you'll modify (never write from memory).
4. Present a step-by-step plan and wait for approval.

---

## Implementation Notes (Next.js 16 + Prisma v7 breaking changes)

These were discovered during Prompt 1 and must be respected in all future sessions:

### Next.js 16
- **`middleware.ts` is deprecated** → use `proxy.ts` at project root; export `function proxy(request)` + `config`
- **Proxy defaults to Node.js runtime** (not Edge) — no `export const runtime` needed or allowed
- **Route params are async**: `params: Promise<{ year: string }>` — always `await params` before destructuring
- **`cookies()` is async** in Next.js 16 server components

### Prisma v7
- **Generator**: `provider = "prisma-client"` (not `prisma-client-js`)
- **Output**: `output = "../app/generated/prisma"` — entry point is `client.ts`, not `index.ts`
- **Import path**: `import { PrismaClient } from "@/app/generated/prisma/client"` (the `/client` suffix is required)
- **URL config**: moved from schema to `prisma.config.ts`; runtime requires `@prisma/adapter-pg`
- **Constructor**: `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })` — no `datasourceUrl`

---

## Prompt 0 notes

- Environment verified: Node v24.14.0, pnpm 9.15.9, Docker Postgres on port 5433
- Git initialized; `.env.example` and `.env.local` in place (gitignored)
- `prompts/` and `tests/fixtures/` directories created
- `CLAUDE.md` written from spec verbatim (Parts 1.1–1.4, decisions from Part 13/16)
- Railway PostgreSQL provisioning failed ("Unknown error") — $1.85 credit remaining; deferred

## Prompt 1 / Session 1 notes

- Scaffolded in `taxlens-init/` subdir (pnpm create forbids capital letters in cwd name), moved files
- shadcn CLI is fully interactive at v4.3.0 — components written by hand (Button, Card, Input, Label, Badge)
- Docker Desktop not running; used `docker -H npipe:////./pipe/docker_engine` for local Postgres on port 5433
- Prisma v7 breaking changes discovered and documented above
- Next.js 16 breaking changes discovered and documented above
- Dev database: `postgresql://taxlens:taxlens_dev@localhost:5433/taxlens`
- 8/8 Vitest smoke tests passing; dev server 200 OK on `/login`

## Prompt 2 notes

- **Migration**: `add_wizard_fields` — BusinessProfile gets `draftStep Int @default(1)`, `incomeSources Json?`; `naicsCode`/`businessDescription`/`grossReceiptsEstimate` made nullable for progressive wizard capture
- **10-step wizard** at `/app/(app)/onboarding/` — client wizard shell + individual step components (steps 1–10)
- **Server actions** at `app/(app)/onboarding/actions.ts` — `saveStep1`–`saveStep9` + `finalizeOnboarding` + `saveProfileEdit`; all Zod-validated server-side
- **Progress persistence** — `draftStep` on BusinessProfile; wizard resumes at saved step on reload
- **Edit flow** at `/app/(app)/profile/` — read-only summary with per-section Edit → Dialog; calls `saveProfileEdit` which writes AuditEvent
- **Key UX details**: V1 entity wall (OTHER entity type), §280A simplified-method preview (Step 4), §274(d) vehicle warnings at 75%+/90%+ (Step 5), §471(c) V2 notice (Step 6), keyword-tag UI for known entities (Step 8)
- **Auth route fix**: `app/api/auth/[...nextauth]/route.ts` — was `export { GET, POST } from "@/auth"` (wrong); now `import { handlers } from "@/auth"; export const { GET, POST } = handlers`
- **14/14 tests passing** (8 smoke + 6 onboarding); clean `pnpm build`; dev server 200 OK

## Prompt 1 gap-fill notes

- **Missing shadcn components added** (16 total): separator, progress, textarea, alert, checkbox, slider, tabs, dialog, popover, select, dropdown-menu, table, toast, use-toast, toaster, form — all hand-written in `components/ui/`
- **Seed rewritten** with spec-correct Maznah Media fixture: `test@taxlens.local` / `test123`, NAICS 711510, TX, wedding photography/travel content, 5 accounts (Chase Freedom CC, Amex Platinum CC, Costco Citi CC, Chase Checking 9517, Robinhood), 3 trips (Alaska Aug 2–13, Sri Lanka Sep 15–Nov 3, Colorado Dec 4–12), 3 KnownEntities, 20 transactions, 0 classifications
- **Seed is idempotent** — cleans up FK-dependent rows (Classification → Transaction) before re-creating fixture IDs
- **Smoke tests updated** to use `test@taxlens.local`; query via userId to avoid collision with old fixture rows; tx transfer pair now tx_019/tx_020; asserts 0 classifications (not 20)
- **8/8 tests passing**; dev server 200 OK on `/login`

## Prompt 3 notes

- **Schema migration**: `add_ingestion_fields` — `StatementImport` gets `originalFilename`, `institution`, nullable `periodStart`/`periodEnd`, `totalInflows`, `totalOutflows`, `transactionCount`, `reconciliationOk`, `reconciliationDelta`, `parseError`; `sourceHash` uniqueness moved to `@@unique([accountId, sourceHash])`
- **Parser layer** (`lib/parsers/`):
  - `types.ts` — `RawTx`, `ReconciliationResult`, `ParseResult`
  - `dedup.ts` — `fileHash()` (SHA-256 on bytes), `transactionKey()` (SHA-256 on accountId|date|cents|merchantRaw)
  - `pdf-extractor.ts` — pdf-parse wrapper; `isUsableText()` heuristic (≥80 chars)
  - `csv-extractor.ts` — papaparse wrapper; `parseDollar()`, `parseDateFlex()`
  - `institutions/chase-cc.ts` — charges negative → flip; parseConfidence 0.95
  - `institutions/chase-checking.ts` — debits negative → flip; parseConfidence 0.95
  - `institutions/amex.ts` — charges positive, no flip; parseConfidence 0.95
  - `institutions/costco-citi.ts` — Debit/Credit split columns or single Amount (Amex-style); parseConfidence 0.95
  - `institutions/robinhood.ts` — withdrawals/purchases negative → flip; builds merchantRaw from Instrument+Description+TransCode
  - `institutions/generic.ts` — header heuristic detection; confidence capped at 0.6
  - `institutions/ofx-generic.ts` — SGML + XML OFX block extraction; TRNAMT flip; confidence 0.9
  - `institutions/index.ts` — `detectInstitution()` + `dispatchCsvParse()` + `INSTITUTION_DISPLAY` map
  - `index.ts` — `parseStatement(buffer, filename)` dispatcher; OFX/PDF/CSV routing; PDF returns structured failure in V1
- **Upload UX** (`app/(app)/years/[year]/upload/`):
  - `actions.ts` — `uploadStatement()`, `deleteImport()`, `createAccount()`, `reparseImport()`; file-level dedup on SHA-256; transaction-level dedup on idempotencyKey; bumps TaxYear status to INGESTION on first upload
  - `page.tsx` — server component; serialises Decimals/Dates for client
  - `upload-client.tsx` — account cards with drag-to-upload area, import history with status badges, reparse/remove actions
- **Coverage grid** (`app/(app)/years/[year]/coverage/`):
  - `page.tsx` — server component; computes txByMonth for each account; counts totalGaps
  - `coverage-grid.tsx` — 12-column heat-map table (green/yellow/red/muted cells); gap alert; per-account detail cards
- **Fixture CSVs** in `tests/fixtures/`: `chase-cc-sample.csv`, `chase-checking-sample.csv`, `amex-sample.csv`, `costco-citi-sample.csv`, `robinhood-sample.csv`
- **Tests** (69 total, all passing): `parsers.test.ts` (sign normalisation for all 7 parsers), `dedup.test.ts`, `reconciliation.test.ts` (totals/periodStart/error handling), `coverage.test.ts` (gap detection logic)
- **Build**: clean `pnpm build` — 12 routes; TypeScript strict; no errors
- **Verify**: `pnpm test` (69 passing); `pnpm build` (clean); upload page at `/years/2025/upload`; coverage at `/years/2025/coverage`

## Prompt 4 notes

- **No schema migration** — all required fields existed from Prompt 1 schema
- **Merchant normalization** (`lib/merchants/normalize.ts`): deterministic 11-step pipeline; key insight — single-word city strip requires ≥6 char minimum to avoid eating brand words like "KING" (4), "ROOM" (4); 32/32 unit tests
- **Pairing modules** (`lib/pairing/`): transfers (±5 day, same-abs-cents, cross-account, scored), payments (PAYMENT_PATTERNS regex → card inflow matched to checking outflow), refunds (90-day window, same merchant, smallest-amount-delta preference)
- **Merchant Intelligence Agent** (`lib/ai/merchantIntelligence.ts`):
  - Model string: `claude-sonnet-4-6` — verified present in `@anthropic-ai/sdk ^0.90.0`
  - Temperature: 0; max_tokens: 4096; batch: 25 merchants/call
  - System prompt includes: NAICS, biz description, trips with dates, known entities + keywords, rule library IDs (R-162-001 through R-Cohan-001), 11-code vocabulary, evidence tier definitions, §274(d) guardrail
  - Cross-field invariants enforced post-Zod: confidence < 0.60 → requires_human_input; unknown citations coerced to [VERIFY]; §274(d) codes without trip override → STOP
  - On JSON parse fail: retry once with fix instruction → if still bad, all batch merchants → NEEDS_CONTEXT + StopItem
  - Every run logged to AuditEvent: MERCHANT_AI_CALL / MERCHANT_AI_PARSE_FAIL / MERCHANT_AI_RUN_COMPLETE
- **Rule application** (`lib/classification/apply.ts`): trip override — non-restaurant in trip → WRITE_OFF_TRAVEL 100%; restaurant in trip → MEALS_50 100%; tier bumped to 2; idempotent (skips existing current classifications unless force=true)
- **StopItems**: one per requires_human_input MerchantRule; TRANSFER stops for unmatched outflows > $500 with keyword hints
- **Pipeline page** (`app/(app)/years/[year]/pipeline/page.tsx`): 6 trigger buttons (normalize, transfers, payments, refunds, AI, apply rules); 4 stat cards; run log
- **Token cost estimate** (Maznah 419-merchant fixture): ~17 batches × ~8,300 tokens = ~$1.34/run; ~$1.20 with system-prompt caching
- **`@prisma/client/runtime/library`** does NOT exist in Prisma v7 — use `{ toString(): string }` for Decimal parameter types
- **Tests**: 153 total (69 original + 84 new); clean `pnpm build` — 13 routes
- **Verify**: `pnpm test` (153 passing); `pnpm build` (clean); pipeline at `/years/2025/pipeline`

### Prompt 4 seed/pipeline fixes (discovered during verification)
- **Seed `amountNormalized` bug fixed**: was stripping minus signs (all amounts positive) → fixed to `tx.amount` (inflows negative, outflows positive per spec convention)
- **Seed `merchantNormalized` fixed**: was storing `lowercase_underscore` format → now `null`; `normalizeMerchantsForYear` sets correct `UPPER CASE SPACES` format matching Merchant Intelligence rule keys
- **Seed cleanup expanded**: `prisma.stopItem.deleteMany` + `prisma.merchantRule.deleteMany` added before fixture recreation so re-seed produces a clean state
- **Verification scripts**: `scripts/run-pipeline.ts` (deterministic steps + report), `scripts/verify-trip-override.ts` (3 test MerchantRules, trip override assertions, cleanup)

### Human verification checklist results (no ANTHROPIC_API_KEY; AI step skipped)
- ✓ **Transfer pair**: tx_019/tx_020 (ONLINE TRANSFER TO AMEX ↔ PAYMENT THANK YOU, $3000, Feb 28) — pre-seeded pair shown in TRANSFER PAIRS report; excluded from P&L
- ✓ **Income correctly identified as inflows**: THEKNOT WEDDING WIRE $8500/$12000 are negative (inflows) — NOT flagged as transfer outflows after sign fix
- ✓ **STOP question**: ZELLE RANDI $2200 (checking outflow, matches /zelle/i, no matching inflow in other accounts) — STOP includes date, amount, account, merchant
- ✓ **Card payments not double-counted**: tx_020 (PAYMENT THANK YOU) excluded from matchCardPayments because it carries `isTransferPairedWith`
- ✓ **Trip override verified**: RUSTIC GOAT ANCHORAGE Aug 5 (inside Alaska trip Aug 2–13) → MEALS_50 @ 100% pct, tier 2, reasoning includes trip name+dates+destination; §274(d) citation added
- ✓ **Non-trip transaction unaffected**: ADOBE SYSTEMS (Jan 5, no active trip) → WRITE_OFF 100%, no override
- ✓ **requiresHumanInput → NEEDS_CONTEXT**: BLUEWAVE CAR WASH (requires vehicle %) → code=NEEDS_CONTEXT, pct=0
- ⚠ **AI-dependent items deferred**: full 20-classification sample, live IRC citation verification, and 3-merchant AI batch require ANTHROPIC_API_KEY; verified by unit tests (merchant-ai.test.ts) and test MerchantRules above

## Prompt 5 notes

- **Migration**: `add_split_support` — Transaction gets `isSplit Boolean @default(false)` + `splitOfId String?` with `TxSplit` self-relation. Parent is flagged `isSplit=true`; children carry their own Classifications. **Session 7 reports MUST filter `WHERE isSplit=false`** to exclude parents and include children.
- **STOP queue** (`/years/[year]/stops`): server page + `stops-client.tsx` tabs (merchant / transfer / deposit / §274(d) / period_gap) with per-category forms from spec §9.3. Cards sorted by context.totalAmount desc. "Apply to similar merchants" toggle default ON for MERCHANT category.
- **`lib/stops/derive.ts`** — pure `deriveFromAnswer(answer, fallback)` split out of actions.ts so server-action files don't export non-async fns and so it's unit-testable. Returns `{code, businessPct, scheduleCLine, ircCitations, evidenceTier, reasoning, source}`. Source is `AI_USER_CONFIRMED` when user picks what AI suggested, else `USER`.
- **`/stops/actions.ts`** — `resolveStop(stopId, answer, applyToSimilar)` wraps in `$transaction`: flips prior `isCurrent=true` classifications to false, inserts new classification per affected txn, optionally updates MerchantRule + re-runs `applyMerchantRules({ merchantKey, tx })`, writes `AuditEvent{ eventType: "STOP_RESOLVED" }`, sets StopItem.state=ANSWERED. `deferStop` writes `STOP_DEFERRED`.
- **`lib/classification/apply.ts`** gained a `{ force?, merchantKey?, tx? }` option bag so the STOP resolver can re-apply a single merchant rule inside the outer Prisma transaction.
- **Virtualized ledger** (`/years/[year]/ledger`): TanStack Virtual windowed list (~30 rows in DOM for a 2000-row set). Columns per spec §4.6; color coding per §10.1 (`codeColorClass` in `lib/classification/constants.ts`). Inline edits go through `editClassification`; bulk actions through `bulkReclassify` — both use the same flip-and-insert pattern and write one AuditEvent per affected txn (`LEDGER_EDIT` / `LEDGER_BULK`).
- **Amazon split** (`components/splits/amazon-split-dialog.tsx` + `splitTransaction` action): threshold + regex in `lib/splits/config.ts` (`AMAZON_MERCHANT_PATTERN`, `AMAZON_SPLIT_THRESHOLD=50`, `MAX_SPLITS_PER_TRANSACTION=5`). Children get `idempotencyKey = ${parent.id}|split|${idx}|${cents}`, inherit accountId/taxYearId/postedDate/merchant. Parent classifications flipped to `isCurrent=false`, `isSplit=true`. Sum validated in cents; mismatch → throws, no DB writes. AuditEvent `TXN_SPLIT`.
- **Natural-language override** — `POST /api/reclassify` calls `lib/ai/reclassifyNL.ts` (claude-sonnet-4-6, temperature 0, Zod-validated with retry-once, fenced-JSON tolerant). Returns `{matches, rule_updates}` **without writing**. Client shows preview Dialog; `applyReclassification` then does flip-and-insert + MerchantRule upserts + `AuditEvent{ eventType: "NL_OVERRIDE" }`.
- **`vitest.config.ts`** — added `fileParallelism: false` so DB-backed tests don't step on each other's fixture counts (seed smoke was seeing 21 txns when split test's synthetic parent was alive).
- **Tests**: 177 passing (153 original + 24 new across stops-resolve / amazon-split / nl-override / ledger-perf). `pnpm build` clean — 3 new routes registered.
- **Verify**: `pnpm test`; `pnpm build`; `/years/2025/stops` walks PENDING items; `/years/2025/ledger` virtualizes + NL override + split.

## Prompt 6 notes

- **Migration**: `add_substantiation` — `Classification.substantiation Json?` for §274(d) attendees/purpose (required by assertion A08 and risk signal MEAL_SUB_MISSING). STOP resolution for MEALS_* already writes `substantiation` via `derive.ts` (added; existing callers unaffected).
- **Residual Agent** (`lib/ai/residualTransaction.ts`): claude-sonnet-4-6, temp 0, max_tokens 1024. Input = one txn + its MerchantRule + 5-before/5-after neighbors + active trip. Output = Classification or StopItem. Retry once on JSON parse fail; second failure → escalate to StopItem. AuditEvents: `RESIDUAL_AI_CALL` / `RESIDUAL_AI_PARSE_FAIL` / `RESIDUAL_AI_RUN_COMPLETE`. Invariants mirror Merchant Agent (confidence < 0.60, §274(d) off-trip, citation whitelist).
- **Residual candidates** (`lib/ai/residualCandidates.ts`): three deterministic gates — (a) GRAY rule with confidence < 0.85, (b) amount > 3σ outlier (needs ≥5 same-merchant samples), (c) GRAY + |amount| > $500 + within ±2 days of trip boundary. Excludes PERSONAL/TRANSFER/PAYMENT and anything the user already decided (source USER/AI_USER_CONFIRMED).
- **QA Assertions** (`lib/validation/assertions.ts`): all 12 from spec §12 + A13 deposits reconstruction (spec §12.1). Each returns `{ id, name, passed, details, blocking, offendingTransactionIds? }`. `runLockAssertions` returns `{ passed, failed, blockingFailures }`. A11 (refund pairs) is advisory-only in V1 (pairing may be partial); everything else is blocking. All filter `isSplit=false` and `isCurrent=true`.
- **Risk Score** (`lib/risk/score.ts`): pure function, no AI. Signals from spec §11.2 (meal ratio >5%, vehicle 75%/100%, loss year N², round numbers, Line 27a >10%, tier-4 §274(d), income short, unclassified deposits, meal sub missing, NEEDS_CONTEXT, pending STOPs). Bands: ≤20 LOW, 21–40 MODERATE, 41–70 HIGH, >70 CRITICAL. Tax impact = deductions × 0.25 with explicit "informational estimate" note.
- **Ledger hash** (`lib/lock/hash.ts`): SHA-256 over canonical JSON of `[{id, postedDate, amountNormalized, merchantNormalized, code, scheduleCLine, businessPct, evidenceTier, ircCitations}]` sorted by txn id. Stored in `TaxYear.lockedSnapshotHash`.
- **Lock flow** (`/years/[year]/lock/actions.ts`): `attemptLock` returns `{ blocked, reasons[], assertions, risk }`. `confirmLock` re-checks, throws if blocked, otherwise `$transaction`: sets `TaxYear.status=LOCKED`, `lockedAt=now`, stores hash, writes AuditEvent `TAXYEAR_LOCKED`. Redirects back to the page (now in LOCKED state).
- **Unlock** (same `actions.ts`): `unlockTaxYear(year, rationale)` — rationale must be ≥10 chars. `TaxYear.status → REVIEW`, marks all `Report` rows `isCurrent=false`, writes AuditEvent `TAXYEAR_UNLOCKED` with rationale + prior hash preserved in `beforeState`.
- **Risk dashboard** (`/years/[year]/risk/page.tsx`): server-computes risk + assertions in parallel. Big score badge with band color, deductions/tax-impact/lock-status cards, grouped signals (Critical/High/Medium/Low) with per-signal border colors, assertions panel with pass/fail icons. Disabled "Attempt lock" button when blockers exist.
- **Lock page** (`/years/[year]/lock/page.tsx`): locked state shows timestamp + hash + unlock form; unlocked+blocked shows blocker list with deep links to STOPs/ledger/risk; unlocked+clean shows confirm dialog with two-step "I understand" → "Confirm lock" interaction.
- **Anthropic SDK content-block typing**: use `(b as { text: string }).text` after a `.filter((b) => b.type === "text")` — the typed `TextBlock` shape in `@anthropic-ai/sdk ^0.90.0` now requires `citations`, so the old user-defined type predicate `b is { type: "text"; text: string }` fails the `is-assignable-to-parameter` check.
- **Tests**: 193 passing (177 original + 16 new across residual-candidates / assertions / risk-score / lock-flow). `pnpm build` clean — 15 routes total (2 new: `/risk`, `/lock`).
- **Dev server gotcha**: after `prisma generate`, an already-running Turbopack dev server can cache the old client bundle and throw `Unknown argument \`isSplit\`` at runtime even though types are fine. Restart the preview server after schema migrations.
- **Verify**: `pnpm test` (193 passing); `pnpm build` (clean); preview-verified `/years/2025/risk` renders dashboard with score/signals/assertions and `/years/2025/lock` correctly blocks the seed fixture (20 unclassified + 4 unclassified deposits).

## Prompt 7 notes

- **No schema migration** — `Report` model already had all required fields (`kind`, `filePath`, `transactionSnapshotHash`, `isCurrent`, `ruleVersionId`).
- **New package**: `archiver@7.0.1` + `@types/archiver@7.0.0` for ZIP assembly.
- **`lib/rules/memoRules.ts`**: static citation lookup for all four memo types (§183_hobby, §274n2_100pct_meals, §280A_home_office, wardrobe). AI may only use these citations; must write `[VERIFY]` for anything not in the list.
- **`lib/reports/masterLedger.ts`**: `buildMasterLedger(taxYearId)` → 5-sheet XLSX (Transactions, Merchant Rules, Stop Resolutions, Profile Snapshot, Metadata). Transactions sheet: row fill colors per `CODE_FILL` ARGB map matching spec §10.1, freeze row 1, autofilter.
- **`lib/reports/financialStatements.ts`**: `buildFinancialStatements(taxYearId)` → 5-sheet XLSX (General Ledger, Schedule C, P&L, Balance Sheet, Schedule C Detail). Schedule C grand total = Σ(deductible) where MEALS_50 applies ×0.5 multiplier. Assertion: this total matches A03.
- **`lib/ai/positionMemo.ts`**: `generatePositionMemo(type, taxYearId)` and `detectNeededMemos(taxYearId)`. Model: `claude-sonnet-4-6` when exposure < $5 000, `claude-opus-4-7` when ≥ $5 000. Requires four labeled sections (FACTS/LAW/ANALYSIS/CONCLUSION); adds stub if any missing. AuditEvent `POSITION_MEMO_GENERATED`.
- **`lib/reports/auditPacket.ts`**: `buildAuditPacket(taxYearId, skipMemos?)` → ZIP Buffer. Uses `archiver` piped to a `PassThrough` stream collected as Buffer. Contents: 01_transaction_ledger.xlsx, 02_274d_substantiation/*.csv, 03_cohan_labels.csv, 04_position_memos/*.txt, 05_income_reconciliation.csv, 06_source_documents_inventory.csv, README.md. `skipMemos=true` bypasses AI calls in tests.
- **PDF decision**: V1 delivers XLSX + CSV + TXT instead of PDF. PDF generation requires Puppeteer/headless browser which conflicts with Node-only constraint. Documented in README.md inside the ZIP.
- **Download UI** (`/years/[year]/download/page.tsx` + `download-client.tsx`): three cards with "Generate & Download" buttons. Disabled unless `TaxYear.status === 'LOCKED'`. Shows last-generated timestamp from `Report` row.
- **API route** (`/api/years/[year]/download/[kind]`): GET route, generates on-the-fly, upserts `Report` row (marks prior `isCurrent=false`), writes AuditEvent `REPORT_GENERATED`, returns `Response(new Uint8Array(buf), ...)`. Kind slugs: `master-ledger`, `financial-statements`, `audit-packet`.
- **TypeScript fixes**: `Buffer` not assignable to `BodyInit` → use `new Uint8Array(buf)`; `NodeJS.ReadableStream` not assignable to archiver's `Readable` → import `Readable` from `node:stream` and type the return explicitly; `null` not assignable to `InputJsonValue` in Prisma → use `undefined` instead.
- **Vitest mock gotcha**: `vi.mock` factory is hoisted above all `const` declarations — inline string literals directly in the factory; do NOT reference module-level variables.
- **Tests**: 223 passing (193 original + 30 new across master-ledger / financial-statements / audit-packet / position-memo / report-route). `pnpm build` clean — 20 routes total (2 new: `/years/[year]/download`, `/api/years/[year]/download/[kind]`).
- **Verify**: `pnpm test` (223 passing); `pnpm build` (clean); lock the fixture year, visit `/years/2025/download`, click "Generate & Download" for each artifact, open in Excel, confirm 5 sheets on each XLSX and valid ZIP.
