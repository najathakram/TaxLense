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
- [ ] Prompt 4 — Merchant Intelligence
- [ ] Prompt 5 — STOPs + Ledger Review
- [ ] Prompt 6 — Residual AI + Lock
- [ ] Prompt 7 — Output Artifacts
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
