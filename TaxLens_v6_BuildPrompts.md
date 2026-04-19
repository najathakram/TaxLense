# TaxLens v6 — Claude Code Build Prompts

**Target model:** Claude Opus 4.7 (via Claude Code CLI)
**Pattern:** Plan-first, execute-second, verify-third. Each prompt ends with a pause for human review.
**Total:** 9 prompts (Prompt 0 setup + Prompts 1–8 from the v6 spec's build sequence).

---

## How to use this file

1. Ensure `TaxLens_v6_Spec.md` is at your project root — every prompt references it.
2. Open Claude Code in the project directory.
3. Copy **Prompt 0** in full into Claude Code. Paste, hit enter.
4. Claude Code will first produce a **PLAN**. Read it. If anything looks wrong, reply with corrections. Do not approve a bad plan.
5. Once you approve the plan, Claude Code executes.
6. Run the **VERIFICATION CHECKLIST** at the end of each prompt. All items must pass before proceeding.
7. Commit to git. Then move to the next prompt.

**If a plan is bad:** reply with specific corrections before approval. Do not let Claude Code execute a plan you don't understand.

**If execution fails mid-task:** reply with the exact error. Do not proceed to the next prompt until the current one is green.

**Context preservation:** CLAUDE.md is the persistent memory between sessions. Prompt 0 creates it; every subsequent prompt ends by updating it. If you start a fresh Claude Code session, the new session reads CLAUDE.md first and picks up where the previous left off.

---

# ═══════════════════════════════════════════════════════════════════════
# PROMPT 0 — ENVIRONMENT + CLAUDE.md + PROJECT SCAFFOLD
# ═══════════════════════════════════════════════════════════════════════

**Prerequisites:** Node 20+, pnpm, PostgreSQL (local Docker or Neon URL), an `ANTHROPIC_API_KEY`.
**What this does:** verifies the machine, creates CLAUDE.md, sets up `.env.example`, initializes git. No application code yet.
**Duration:** 5–10 minutes.

--- COPY BELOW INTO CLAUDE CODE ---

```
You are starting a new project called TaxLens. Read the file TaxLens_v6_Spec.md in the current directory — that is the authoritative specification. Do not skim. Read Parts 1, 13, 14, and 16 in full.

BEFORE WRITING ANY CODE OR CREATING ANY FILES, use extended thinking to produce a PLAN for Prompt 0 only. The plan must:

1. Confirm the intended outcome of Prompt 0 in your own words (2–3 sentences).
2. List every file you will create, with purpose.
3. List every shell command you will run, with purpose.
4. Identify anything in the environment that must be verified before you proceed (Node version, pnpm, Postgres reachability, Anthropic API key presence).
5. State what is explicitly out of scope for this prompt (application code, schema, auth, UI — all deferred to Prompt 1).

Present the plan. Stop. Wait for my approval.

On approval, execute the plan:

A. Verify environment:
   - Run: node --version (must be >=20)
   - Run: pnpm --version (install if missing: corepack enable && corepack prepare pnpm@latest --activate)
   - Check for ANTHROPIC_API_KEY in environment; if missing, instruct user to export it, do not embed keys in files
   - Check for DATABASE_URL; if missing, instruct user to either run local Postgres in Docker or provide a Neon URL
   - If any check fails, STOP and print a clear remediation message. Do not continue.

B. Initialize the project directory (do not run npx create-next-app yet — that is Prompt 1):
   - git init (if not initialized)
   - Create .gitignore with Node/Next.js/Prisma/env defaults
   - Create .env.example listing ALL env vars the project will eventually need:
       DATABASE_URL, ANTHROPIC_API_KEY, AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET,
       NEXTAUTH_URL, NODE_ENV, LOG_LEVEL
     Each with a one-line comment describing its purpose. No real values.
   - Copy .env.example to .env.local (local-only; gitignored)

C. Create CLAUDE.md at project root. Content:
   - # TaxLens — Project Context for Claude Code
   - ## What this project is (2–3 paragraphs pulling from v6 spec Part 1)
   - ## The ten non-negotiable principles (verbatim from v6 Part 1.4)
   - ## Tech stack (from v6 spec — Next.js 15 App Router, TypeScript strict, Tailwind v4, shadcn/ui, PostgreSQL + Prisma, NextAuth v5, Anthropic SDK, TanStack Query/Table, Zustand, Vitest)
   - ## Build progress
       - [ ] Prompt 0 — Environment + scaffold
       - [ ] Prompt 1 — Foundation
       - [ ] Prompt 2 — Profile Wizard
       - [ ] Prompt 3 — Ingestion
       - [ ] Prompt 4 — Merchant Intelligence
       - [ ] Prompt 5 — STOPs + Ledger Review
       - [ ] Prompt 6 — Residual AI + Lock
       - [ ] Prompt 7 — Output Artifacts
       - [ ] Prompt 8 — Polish + E2E
   - ## Decisions locked
       - Runtime: Node everywhere. No Python service in V1.
       - Models: claude-sonnet-4-6 for Merchant Intelligence + Residual Transaction agents; claude-opus-4-7 for Position Memos on gray-zone items with >$5K exposure.
       - Entity scope V1: Sole prop / SMLLC disregarded only.
       - Tax year V1: one year at a time.
       - Wardrobe default: 0% (Pevsner-strict); 50% is opt-in with position memo.
       - Acceptance test for V1: reprocess the Maznah Media 2025 fixture and match locked numbers.
   - ## What NOT to do
       - Do not introduce Python. Node only.
       - Do not add features beyond V1 scope (see spec Part 13.2).
       - Do not modify Transaction or Classification rows in-place — append-only.
       - Do not invent IRC citations. Use the rule library only.
       - Do not file anything, share anything externally, or modify any system permissions.
       - Do not commit secrets or real .env files.
   - ## Session handoff protocol
       - Every prompt ends by updating this file's "Build progress" checklist and writing a "## Session N notes" section with: what changed, how to verify, any open issues for next session.

D. Create an empty prompts/ directory (for future Claude API prompt templates) and an empty tests/fixtures/ directory (for future test data).

E. Git: commit with message "chore: prompt 0 — env verified, CLAUDE.md and .env.example in place"

VERIFICATION COMMANDS (run these at the end and show me output):
- node --version
- pnpm --version
- ls -la .
- cat CLAUDE.md | head -40
- git log --oneline

Then STOP. Do not proceed to Prompt 1.

Final summary format:
- ✓ What succeeded
- ✗ What failed (if anything)
- Environment blockers requiring user action (if any)
- Ready to proceed to Prompt 1 (Y/N)
```

--- END PROMPT ---

**VERIFICATION CHECKLIST (human):**
- [ ] `CLAUDE.md` exists and contains the ten principles
- [ ] `.env.example` lists all env vars without real values
- [ ] `.env.local` exists locally (gitignored — confirm with `git status`)
- [ ] Git repo initialized, one commit
- [ ] `node --version` ≥ 20, `pnpm --version` present
- [ ] `ANTHROPIC_API_KEY` is exported in your shell
- [ ] `DATABASE_URL` points at a reachable Postgres

**If any fails:** address it before Prompt 1. Do not proceed with a broken env.

---

# ═══════════════════════════════════════════════════════════════════════
# PROMPT 1 — FOUNDATION (Next.js, Prisma schema, NextAuth, seed, routes)
# ═══════════════════════════════════════════════════════════════════════

**Prerequisites:** Prompt 0 complete.
**What this does:** scaffolds the Next.js app, writes the full Prisma schema (Part 5 of spec), sets up NextAuth v5, creates seed data, stubs out the routes.
**Duration:** 30–45 minutes.

--- COPY BELOW INTO CLAUDE CODE ---

```
Read CLAUDE.md first. Then read TaxLens_v6_Spec.md Parts 5 (Data Model), 13 (Scope), 14 Session 1 (Build Sequence).

BEFORE WRITING ANY CODE, use extended thinking ("ultrathink") to produce a detailed PLAN for Prompt 1. The plan must:

1. State the Session 1 outcome in your words.
2. List the complete file tree you will create (every file, with one-line purpose each).
3. List the full Prisma schema you will write — every model, every field, every relation, every index, every enum. Do this by copying from spec Part 5 and expanding into schema.prisma syntax. Flag anything ambiguous in the spec that you are resolving.
4. List the exact shell commands in execution order (install, migrate, seed, dev server start).
5. List the tests you will write this session (minimum: a seed smoke test).
6. Identify risks: Tailwind v4 + shadcn/ui compatibility, NextAuth v5 config shape, Prisma trigger installation for append-only tables.

Present the plan. Stop. Wait for my approval.

On approval, execute in this order with TodoWrite tracking each step:

STEP 1 — Scaffold Next.js:
   pnpm create next-app@latest . --typescript --tailwind --app --eslint --src-dir=false --import-alias="@/*"
   When prompted about overwriting CLAUDE.md or .env.example, preserve existing versions.

STEP 2 — Install dependencies:
   pnpm add @prisma/client @auth/prisma-adapter next-auth@beta @tanstack/react-table @tanstack/react-query zustand zod @anthropic-ai/sdk react-hook-form @hookform/resolvers date-fns lucide-react clsx tailwind-merge exceljs pdf-parse papaparse
   pnpm add -D prisma vitest @vitejs/plugin-react @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom @types/node @types/papaparse

STEP 3 — Initialize shadcn/ui (preserve Tailwind v4 config):
   pnpm dlx shadcn@latest init
   Add these components one by one (NOT all at once — verify each installs cleanly):
     button card dialog input label select table tabs toast badge progress alert separator popover dropdown-menu form textarea checkbox slider

STEP 4 — Prisma setup:
   pnpm prisma init --datasource-provider postgresql
   Write prisma/schema.prisma with ALL entities from spec Part 5.1:
     User, BusinessProfile, KnownEntity, Trip, TaxYear, Account, StatementImport,
     Transaction (INSERT-only), Classification (append-only), MerchantRule, StopItem,
     AuditEvent (INSERT-only), RuleVersion, Report
   
   Key schema rules:
   - Use cuid() for all IDs
   - Foreign keys use @relation with fields + references; enable onDelete rules appropriately
   - Transaction, Classification, AuditEvent: do NOT add @updatedAt fields (these tables must feel immutable even if DB-level triggers come in Prompt 8)
   - Add all indexes from spec Part 5.1
   - Enums: AccountType, TransactionCode (WRITE_OFF, WRITE_OFF_TRAVEL, WRITE_OFF_COGS, MEALS_50, MEALS_100, GRAY, PERSONAL, TRANSFER, PAYMENT, BIZ_INCOME, NEEDS_CONTEXT), EvidenceTier, ClassificationSource, TaxYearStatus, StopCategory, StopState, ActorType, KnownEntityKind, EntityType
   - Amount fields: Decimal with @db.Decimal(15,2) for money; never Float
   - business_pct as Int (0-100), not Float
   
   Run: pnpm prisma migrate dev --name init
   Run: pnpm prisma generate

STEP 5 — NextAuth v5:
   Create auth.ts at project root (not in /app) per NextAuth v5 convention.
   Configure: PrismaAdapter, Credentials provider (email + password hashed via a local bcrypt utility), Google provider (config only — keys from env).
   Create /lib/db.ts — Prisma singleton with dev hot-reload guard.
   Create /middleware.ts protecting everything except /login, /signup, and Next.js internals.
   Create /app/(auth)/login/page.tsx and /app/(auth)/signup/page.tsx — simple forms, nothing fancy yet.

STEP 6 — Seed data (prisma/seed.ts):
   One User: test@taxlens.local / password "test123" (hashed).
   One TaxYear: 2025, status CREATED.
   One BusinessProfile with realistic values matching Najath's fixture: naics 711510, entity SOLE_PROP, state TX, business_description "Wedding photography, travel content creation, and e-commerce", gross_receipts_estimate 2818, home office dedicated 200sqft/2000sqft total, vehicle 60% business.
   Three Trips: Alaska (Aug 2–13), Sri Lanka (Sep 15–Nov 3), Colorado (Dec 4–12).
   Three KnownEntities: spouse (PERSON_PERSONAL), business partner (PERSON_PERSONAL, Zelle pattern), HSMCA (PATTERN_EXCLUDED, donation).
   Two RuleVersion rows: one effective 2024-01-01 (pre-OBBBA), one effective 2025-01-20 (post-OBBBA). Rule set JSON starts minimal — Prompt 8 loads the full library.
   Five Accounts: Chase Freedom (CC), Amex Platinum (CC), Costco Citi (CC), Chase Checking 9517 (CHECKING), Robinhood (BROKERAGE).
   20 synthetic Transactions across the accounts spanning 2025 dates.
   
   Add a "pnpm seed" script in package.json: "tsx prisma/seed.ts".

STEP 7 — Route stubs (minimal — no feature UI yet):
   /app/page.tsx — landing, links to /login if unauthed, /dashboard if authed
   /app/(app)/dashboard/page.tsx — lists user's tax years (seed shows one)
   /app/(app)/onboarding/page.tsx — placeholder "Profile wizard coming in Session 2"
   /app/(app)/years/[year]/page.tsx — placeholder showing year status, account count, txn count
   /app/(app)/layout.tsx — sidebar with: Dashboard, Current Year, Settings; org/user display; logout

STEP 8 — Vitest:
   Create vitest.config.ts with jsdom environment.
   Create tests/seed.smoke.test.ts: verifies seeded user exists, tax year exists, 20 transactions exist, no Classification rows yet.
   Run: pnpm test — must pass.

STEP 9 — Dev server smoke:
   Run: pnpm dev in background for 10 seconds, curl http://localhost:3000, kill the server.
   Expected: 200 response.

STEP 10 — Update CLAUDE.md:
   Mark "Prompt 1 — Foundation" complete.
   Add "## Session 1 notes" with: files created, schema summary, how to verify (pnpm prisma studio, pnpm test, pnpm dev), any decisions made that weren't in the plan, any open issues.

STEP 11 — git add . && git commit -m "feat(session-1): foundation — next.js, prisma schema, nextauth, seed, route stubs"

VERIFICATION COMMANDS (run at end and show output):
- pnpm test
- pnpm prisma migrate status
- pnpm prisma studio (launch, confirm models visible, then kill)
- curl -s http://localhost:3000 >/dev/null && echo "dev server OK" (start dev in background first)
- cat CLAUDE.md | grep -A 20 "Session 1 notes"

STOP. Final summary: ✓/✗ per step, blockers, ready for Prompt 2 (Y/N).
```

--- END PROMPT ---

**VERIFICATION CHECKLIST (human):**
- [ ] `pnpm prisma studio` shows all 14 models
- [ ] Seeded user at test@taxlens.local / test123 can log in via /login
- [ ] `/dashboard` shows the 2025 tax year
- [ ] `/years/2025` shows 20 transactions, 5 accounts
- [ ] `pnpm test` passes (at least the seed smoke test)
- [ ] CLAUDE.md "Build progress" checkbox updated
- [ ] Git commit present

**If verification fails:** paste the failing output back into Claude Code with: "This failed: [paste]. Diagnose and fix. Show me what you changed before running any migration."

---

# ═══════════════════════════════════════════════════════════════════════
# PROMPT 2 — PROFILE WIZARD (12 Q + Trips + Entities + Income Sources)
# ═══════════════════════════════════════════════════════════════════════

**Prerequisites:** Prompt 1 complete.
**What this does:** builds the Phase 0 onboarding flow. This is the most leveraged phase in the whole app — the AI's classification quality is bounded by profile quality.
**Duration:** 45–60 minutes.

--- COPY BELOW INTO CLAUDE CODE ---

```
Read CLAUDE.md and TaxLens_v6_Spec.md Parts 4.1 (Phase 0), 8 (Universal Questions), 9 (Dynamic Questions — for understanding what downstream DOES NOT need to be asked here).

BEFORE WRITING CODE, use extended thinking to produce a PLAN. The plan must:

1. Sketch the wizard's step-by-step flow (steps, their questions, validation rules).
2. Specify the Zod schemas for each step.
3. Specify the server actions for persistence (one per step or one monolithic — pick one, justify).
4. Specify progress persistence: a half-finished profile must resume at the same step on reload.
5. Identify UI components needed (use shadcn/ui primitives; do not build from scratch).
6. Specify the edit flow: completed profile → single-page edit view vs. re-run wizard.
7. State what is NOT built this session (the STOP UI, file upload, AI calls — all downstream).

Present the plan. Stop for approval.

On approval, execute:

STEP 1 — Wizard structure (/app/(app)/onboarding/):
   Multi-step wizard with these steps matching spec Part 4.1:
   
   Step 1 — Basics:
     U1 tax year (year picker), U4 entity type (SOLE_PROP or SMLLC_DISREGARDED only in V1 — show a "Other entity types coming in V2" notice for anything else), U5 primary state (dropdown, US states), U8 accounting method (default CASH), U12 first year of business (checkbox).
   
   Step 2 — Business description:
     U2 (textarea, placeholder "e.g., Wedding photography and travel content creation"), U3 NAICS code (searchable dropdown — top 50 common codes plus a free-text fallback).
   
   Step 3 — Revenue profile:
     U6 revenue streams (multi-select checkboxes: Services, Physical Products, Digital Products, Ad Revenue, Brand Deals, Affiliate, Subscriptions, Gifts/PR), U7 gross receipts estimate (numeric input with currency format).
   
   Step 4 — Home office:
     U9 dropdown (No / Yes-dedicated / Yes-separate-structure). If Yes: office_sqft + home_sqft inputs. Show live simplified-method preview: min(office_sqft, 300) * 5 = $X per spec rule R-280Ac-002.
   
   Step 5 — Vehicle:
     U10 dropdown (No / Yes-mixed-use / Yes-dedicated-biz). If mixed-use: biz_pct slider 0–100 default 50. Show warning label under the slider at 75+: "Vehicle business use above 75% draws IRS scrutiny; above 90% is statistically implausible."
   
   Step 6 — Inventory:
     U11 dropdown (No / Physical / Dropship). If any Yes: brief notice "V1 supports COGS tracking; full §471(c) inventory method choices in V2".
   
   Step 7 — Trips (structured list, 0..N entries):
     Name, destination, start date, end date, purpose (textarea), deliverable description (textarea). Add/remove rows. A "Is confirmed" checkbox per trip.
   
   Step 8 — Known entities (structured list, 0..N):
     Kind (PERSON_PERSONAL / PERSON_CONTRACTOR / PERSON_CLIENT / PATTERN_EXCLUDED / PATTERN_INCOME), display name, match keywords (tag input — what strings in transaction descriptions should match this entity; e.g., "RANDI" matches Zelle to spouse named Randi), default code (optional), notes.
   
   Step 9 — Expected income sources (structured list, 0..N):
     Platform name (free text), approximate total expected (number), category (multi-select: direct bank, Stripe, Square, PayPal business, Zelle business, 1099 platform).
   
   Step 10 — Review & confirm:
     All data shown in a summary card. "Edit" button per section returns to that step with data preloaded. "Confirm & save" finalizes.

STEP 2 — Server actions:
   Create /app/(app)/onboarding/actions.ts with:
     saveStep(stepNumber, data) — upserts the relevant portion of BusinessProfile + related records for that step. Draft state tracked.
     finalizeOnboarding() — marks profile complete, advances TaxYear.status from CREATED to INGESTION.
   Use Zod for validation on every input. Server actions must re-validate server-side (never trust client).

STEP 3 — Progress persistence:
   Store wizard step in BusinessProfile (add a draft_step Int field via migration — run migration).
   On resume, redirect to /onboarding?step=<draft_step>.
   Each step saves on "Next" click; leaving mid-step keeps the previous step saved.

STEP 4 — Edit flow:
   /app/(app)/profile/page.tsx — single-page view of entire profile, organized by step sections, each section has an "Edit" button that opens a shadcn Dialog with just that step's form.
   Edits go through the same server actions and trigger an AuditEvent (ActorType.USER, event_type "PROFILE_EDITED").

STEP 5 — Tests (tests/onboarding.test.ts):
   - Completing the wizard end-to-end for the seeded user persists correctly
   - Leaving on step 4 and reloading resumes at step 4
   - Invalid NAICS fails server-side validation
   - Vehicle biz_pct above 100 fails
   - Trip with end_date before start_date fails
   - finalizeOnboarding moves tax year to INGESTION

STEP 6 — UX validation:
   Every step must meet these:
   - Keyboard navigation works (Tab through, Enter to advance)
   - Errors appear inline, not in a toast for form validation
   - "Back" always works without data loss

STEP 7 — Update CLAUDE.md with Session 2 notes, mark complete.

STEP 8 — Commit: "feat(session-2): phase 0 profile wizard — 12 questions + trips + entities + income sources"

VERIFICATION:
- pnpm test (new tests must pass)
- Manual: clear seeded profile in Prisma Studio, navigate to /onboarding, complete the wizard, confirm it lands at /dashboard with tax year status INGESTION
- Manual: edit a completed profile; confirm AuditEvent row created
- Show me: cat prisma/schema.prisma | grep -A 2 "draft_step"

STOP. Final summary.
```

--- END PROMPT ---

**VERIFICATION CHECKLIST (human):**
- [ ] Wizard has exactly 10 steps matching spec
- [ ] V1 entity wall appears for non-sole-prop selections
- [ ] Vehicle 75%+ warning visible
- [ ] Trip add/remove works, dates validated
- [ ] Resume-from-step persists across reload
- [ ] Completing wizard advances tax year status to INGESTION
- [ ] Profile edit creates AuditEvent row (check in Prisma Studio)
- [ ] All onboarding tests pass

---

# ═══════════════════════════════════════════════════════════════════════
# PROMPT 3 — INGESTION (File upload, PDF/CSV parsing, normalization, coverage)
# ═══════════════════════════════════════════════════════════════════════

**Prerequisites:** Prompt 2 complete. Have 2–3 real statement files ready for manual testing.
**What this does:** accepts statement files, parses them, produces raw transactions with reconciliation and coverage validated.
**Duration:** 60–90 minutes.

--- COPY BELOW INTO CLAUDE CODE ---

```
Read CLAUDE.md and TaxLens_v6_Spec.md Part 4.2 (Phase 1 Ingestion). Read Part 4.3 carefully — Prompt 3 does NOT do normalization/dedup; that's Prompt 4. Prompt 3 stops at raw transactions per statement with coverage + reconciliation verified.

BEFORE CODING, use extended thinking to plan. The plan must:

1. Sketch the upload UX (drag-drop zone, file list, per-file status).
2. Specify local-dev file storage (simple /uploads/<user-id>/ directory; presigned cloud storage is V2).
3. Specify the parser interface: parseStatement(file, accountId) -> ParseResult with { transactions[], period_start, period_end, total_inflows, total_outflows, parse_confidence, reconciliation }.
4. Specify sign normalization: outflows positive, inflows negative (from spec Part 4.2). Per-institution rules for Chase CSV vs. Robinhood vs. Amex — how to detect institution from the file or have user select.
5. Specify dedup: SHA-256 on file bytes + transaction idempotency key (hash of account_id + posted_date + amount + merchant_raw).
6. Specify reconciliation: sum transactions, compare to statement-reported totals (PDF) or CSV sum (for CSV, there's no "reported total" so skip or compute from a stated header if present).
7. Specify coverage report: for each account in the current tax year, show which months have statements and which don't.
8. Explicitly list what is NOT done in Prompt 3: merchant normalization (Prompt 4), transfer matching (Prompt 4), classification (Prompt 4).

Present the plan. Stop for approval.

On approval:

STEP 1 — Parser module (/lib/parsers/):
   pdf-parse.ts: uses pdf-parse npm package to extract text; returns page-by-page text.
   csv-parse.ts: uses papaparse; sniffs delimiter; handles header row detection.
   statement-parser.ts: dispatcher — detects file type by extension + byte sniff; routes to pdf or csv; applies institution-specific extraction rule if detected.
   
   Institution rules in /lib/parsers/institutions/:
     chase-cc.ts, chase-checking.ts, amex.ts, costco-citi.ts, robinhood.ts
   Each exports a parse function that takes raw text/rows and returns normalized transactions.
   A "generic" fallback parser for unknown institutions that asks the user to map columns.
   
   IMPORTANT: do NOT invoke Claude Vision in Prompt 3. If pdf-parse returns empty or gibberish, mark parse_status=FAILED with a clear error message. Vision OCR fallback is added in a later prompt only if needed.

STEP 2 — Sign normalization:
   Per spec: amount_normalized is outflow-positive, inflow-negative.
   Chase CSV: charges come in as negative → flip sign.
   Robinhood: charges positive → keep.
   Amex PDF: depends on format; detect by "Amount" column orientation.
   Store both amount_original and amount_normalized on Transaction rows.
   Write unit tests per institution against small fixture files.

STEP 3 — Idempotency + dedup:
   Compute SHA-256 of uploaded file bytes → StatementImport.source_hash with UNIQUE constraint on (account_id, source_hash). Re-upload returns the existing import record, no-op.
   Compute transaction idempotency_key as SHA-256 of (account_id, posted_date ISO, amount_normalized cents, merchant_raw). UNIQUE on that column. If a new import contains txns already in the DB, do not insert duplicates — mark as is_duplicate_of on the new candidate, do not persist it.

STEP 4 — Reconciliation:
   For PDF imports: after parsing, attempt to extract "Total Payments and Credits" / "Total Fees and Charges" / "Total Activity" strings from the text. Compare to sum of parsed transactions. Store reconciliation_ok boolean and reconciliation_delta on StatementImport.
   If |delta| > 0.01, mark parse_status=PARTIAL and flag the import in the UI.
   For CSV: sum is the authoritative source (no external total to compare to); always ok unless parse errors encountered.

STEP 5 — Upload UX (/app/(app)/years/[year]/upload/):
   Drag-drop zone accepting PDF/CSV/OFX.
   Per-file card showing: filename, institution (auto-detected or user-selected via dropdown), account (user selects from their accounts or creates a new one inline), parse status, period covered, transaction count, reconciliation badge (green ✓ / amber ⚠ / red ✗).
   Accounts managed inline: user can add a new account (institution, type, mask, nickname) right from the upload screen if they haven't created it yet.
   A "Re-parse" button per failed import.
   A "Remove" button only for imports with no classified transactions yet.

STEP 6 — Coverage dashboard (/app/(app)/years/[year]/coverage/):
   Grid: rows = accounts, columns = months Jan–Dec. Cell green if a statement covers that month, red if gap, amber if partial.
   Any red cell generates a "Missing statement" STOP candidate — but do not create StopItem rows yet; just list the gaps.

STEP 7 — Server actions + API:
   /app/(app)/years/[year]/upload/actions.ts:
     uploadStatement(fd: FormData) — receives file, stores to /uploads/<userid>/<taxyear>/<statementid>.ext, invokes parser, persists StatementImport + Transactions.
     deleteImport(statementImportId) — only if no classifications reference transactions from this import.

STEP 8 — Tests (tests/ingestion/):
   Fixture files in tests/fixtures/: chase-cc-may2025-sample.pdf (or CSV), robinhood-apr2025-sample.csv, amex-jun2025-sample.pdf. Use small synthetic samples you construct, not real statements (sanitize).
   Per-institution parser correctness tests.
   Sign normalization tests (Chase charge is +, Robinhood charge is +, same direction in amount_normalized).
   Dedup test: upload same file twice → one StatementImport, same txn count.
   Overlap test: upload Jan PDF and year-to-date CSV — overlapping txns deduped.
   Reconciliation test: inject a malformed PDF → parse_status=PARTIAL with delta recorded.

STEP 9 — Update CLAUDE.md Session 3 notes, mark complete.

STEP 10 — Commit: "feat(session-3): phase 1 ingestion — pdf/csv parsers, sign normalization, dedup, coverage"

VERIFICATION:
- pnpm test
- Manual: upload your own fixture Chase Freedom statement, confirm transactions populate
- Manual: upload same file again, confirm no duplication
- Manual: navigate to /years/2025/coverage, confirm grid shows uploads

STOP.
```

--- END PROMPT ---

**VERIFICATION CHECKLIST (human):**
- [ ] Upload a Chase CC PDF → transactions parsed with correct signs
- [ ] Upload same file twice → one StatementImport, no duplicate transactions
- [ ] Coverage grid shows accurate month-level gaps
- [ ] Reconciliation delta visible for PDFs
- [ ] A malformed file shows parse_status=PARTIAL with a specific error

**Feed real test data now.** Drop 2–3 of your actual 2025 fixture statements into `tests/fixtures/` and upload them via the UI. Note which institutions parse cleanly and which don't — the gaps become targeted fixes before Prompt 4.

---

# ═══════════════════════════════════════════════════════════════════════
# PROMPT 4 — MERCHANT INTELLIGENCE (Normalization, pairing, Sonnet 4.6 agent)
# ═══════════════════════════════════════════════════════════════════════

**Prerequisites:** Prompt 3 complete, 3+ real statements uploaded into the seeded tax year.
**What this does:** cleans merchant strings, matches transfers and payments, runs the AI classifier at the merchant-unique level, writes Classifications and generates StopItems.
**Duration:** 90–120 minutes. This is the most algorithmically dense session.

--- COPY BELOW INTO CLAUDE CODE ---

```
Read CLAUDE.md and TaxLens_v6_Spec.md Parts 3 (Categorization Process — READ IN FULL), 4.3 (Phase 2), 4.4 (Phase 3), 6 (AI Architecture), 7 (Rule Library).

This is the heart of the application. Before coding, use EXTENDED extended thinking ("ultrathink") — this session's plan needs 2-3x the depth of earlier sessions.

The plan must cover:

1. Deterministic merchant normalization — the full regex set for stripping SQ*, PAYPAL*, TST*, reference numbers, trailing city/state, phone/ZIP. Include 10 specific before/after examples using realistic transaction descriptions.

2. Transfer matching algorithm — exact pseudocode for matching outflow-inflow pairs across accounts within ±5 day window with same absolute amount. Define what "same amount" means for FX cases. Define tie-breaking when multiple candidates exist.

3. Payment matching — how credit card "Payment Thank You" lines pair with checking outflows.

4. Refund pairing — negative charges on cards matched to prior positive charges at same merchant within a 90-day window.

5. Merchant Intelligence Agent spec:
   - Input: batch of 25 unique merchants + full BusinessProfile + Trips[] + KnownEntities[] + RuleVersion rules + NAICS context.
   - System prompt structure (don't just guess — sketch the actual prompt).
   - Output JSON schema matching MerchantRule fields from spec Part 3.3.
   - Guardrail: never invent IRC sections; use only citations from the rule library; return [VERIFY] if uncertain.
   - Error handling: API failure, JSON parse failure, unexpected fields.

6. Rule application: how MerchantRule maps onto each transaction with that merchant_key, including the trip-window override logic.

7. StopItem generation: one per merchant with requires_human_input=true, grouping all affected transactions.

8. Testing strategy: unit tests for each deterministic step, integration test using a small fixture of 30 transactions that exercises all four classification paths (transfer, payment, confident merchant, STOP merchant).

9. Token budget estimation: for a 419-unique-merchant test case, expected Sonnet 4.6 calls, tokens, and cost.

10. Explicit non-goals: Phase 4 residual per-transaction pass is Prompt 6, not this session. STOP UI is Prompt 5, not this session. Only persist StopItems; the UI to resolve them comes next.

Present the plan. Stop. Wait for approval. If the plan lacks depth on any of the 10 items, I will reject it.

On approval:

STEP 1 — /lib/merchants/normalize.ts:
   normalizeMerchant(raw: string): string
   Strip: SQ *, TST *, PAYPAL *, SP *, leading/trailing whitespace, trailing phone numbers (regex: \s+\d{3}[-.]?\d{3}[-.]?\d{4}\s*$), trailing city + 2-letter state, trailing ZIPs, reference numbers (##### patterns).
   Preserve the brand. Uppercase normalization for match_key; preserve display_name with original case.
   Unit test against 30 specific raw strings pulled from real fixtures.

STEP 2 — /lib/pairing/transfers.ts:
   matchTransfers(taxYearId) — query all unpaired transactions; for each outflow of amount A on date D, find inflows in other owned accounts with amount -A ±0.01 within dates [D-5, D+5]. Confidence: 1.0 for exact same day, decreasing with date distance.
   Require the user's other accounts to be is_primarily_business + match threshold; use raw description "transfer"/"move"/"payment" hints as boosters.
   Store pairing on both Transaction rows (is_transfer_paired_with self-FK).
   Unmatched outflows above $500 → create a StopItem category=TRANSFER.

STEP 3 — /lib/pairing/payments.ts:
   matchCardPayments(taxYearId) — for each "Payment Thank You" / "ONLINE PAYMENT" / similar on a credit card account, match to an outflow from a checking account with equal amount within ±5 days.
   Mark both as code=PAYMENT via a temporary classification with source=SYSTEM.

STEP 4 — /lib/pairing/refunds.ts:
   matchRefunds(taxYearId) — for each negative charge (inflow on a credit card), search same-merchant_normalized positive charges within 90 days prior. Link via is_refund_pairs_with. The refund will net the deductible later.

STEP 5 — /lib/ai/merchantIntelligence.ts:
   Define the zod schema for MerchantRule AI output.
   Define buildSystemPrompt(profile, trips, knownEntities, ruleSet, naicsContext): string.
   Define classifyBatch(merchants: string[], profile, ...): Promise<MerchantRule[]>.
   
   Call Anthropic SDK with model "claude-sonnet-4-5" (use the model string that matches your SDK version — verify against @anthropic-ai/sdk's Model type; if sonnet-4-6 is exposed as a specific ID in the SDK at this point use that; otherwise fall back to the latest 4.x sonnet). Document the chosen model string in the file.
   max_tokens: 4096. Temperature: 0 (deterministic).
   System prompt MUST include:
     - The business profile
     - The trip windows
     - The known entities with match keywords
     - The rule library IDs and summaries (not the full JSON)
     - The 9-code vocabulary with strict instruction to use only those codes
     - The evidence tier definitions
     - Explicit guardrail: "If uncertain about IRC citation, return [VERIFY] string. Never invent a citation."
     - Explicit guardrail: "If insufficient information to classify with ≥0.60 confidence, set requires_human_input=true and write a specific human_question referencing the merchant and dollar context."
   User prompt: JSON list of {merchant_key, sample_raw, count, total_amount, sample_dates[], account_types[]}.
   
   Parse response, validate against Zod, persist MerchantRule rows.
   On parse failure: log to AuditEvent with event_type MERCHANT_AI_PARSE_FAIL, retry once with temperature 0 and an instruction to fix the JSON, then fail to a manual STOP if still bad.

STEP 6 — /lib/classification/apply.ts:
   applyMerchantRules(taxYearId) — for each Transaction lacking a current Classification, find the matching MerchantRule by merchant_normalized (case-insensitive); create a Classification with source=AI.
   Trip override: if MerchantRule.applies_trip_override=true AND transaction date falls in a confirmed Trip window, upgrade code to WRITE_OFF_TRAVEL (or MEALS_50 for restaurants on a trip), business_pct to 100.
   Write the reasoning field from the MerchantRule, referencing the trip name if the override applied.
   For merchants with requires_human_input=true: create Classification with code=NEEDS_CONTEXT + generate a StopItem.

STEP 7 — /app/(app)/years/[year]/pipeline/page.tsx — pipeline control panel:
   Buttons to manually trigger each step (for dev/testing): Normalize merchants, Match transfers, Match payments, Match refunds, Run merchant AI, Apply rules.
   Status cards showing: unique merchants detected, merchants classified, STOPs generated, transfers matched, payments matched.

STEP 8 — Tests (tests/merchant-intel/):
   Normalize function: 30 cases.
   Transfer pairing: synthetic 10-transaction fixture with 3 true transfers, 1 false candidate.
   Payment pairing: card payment + checking outflow.
   Refund pairing: charge + refund.
   Merchant AI (MOCKED): stub the Anthropic client, verify the system prompt shape, verify output mapping.
   Rule application: 50-transaction fixture, verify every transaction has a current Classification post-apply.
   Trip override: a transaction with merchant "BLUEWAVE CAR WASH" gets GRAY outside trips and WRITE_OFF_TRAVEL inside trip dates.

STEP 9 — Update CLAUDE.md Session 4 notes. Include the model string chosen + the token cost estimate for the Maznah fixture.

STEP 10 — Commit: "feat(session-4): merchant intelligence — normalization, pairing, sonnet agent, rule application"

VERIFICATION:
- pnpm test
- Manual: run the pipeline on the uploaded fixtures; inspect a sampling of 20 classifications in Prisma Studio to verify sensible codes and IRC citations
- Manual: confirm StopItems were generated for ambiguous merchants with specific human_question text
- Show me: 3 actual MerchantRule rows (pick one confident, one gray, one requires_human_input)

STOP.
```

--- END PROMPT ---

**VERIFICATION CHECKLIST (human):**
- [ ] 20 sample classifications reviewed — codes make sense for the merchant + profile
- [ ] IRC citations are from the rule library, no invented ones
- [ ] Trip override works: a fuel charge during Alaska trip is WRITE_OFF_TRAVEL, same merchant outside trip is GRAY
- [ ] Transfer pairs identified and mutually linked
- [ ] Card payments not counted as expenses
- [ ] STOP questions are specific and contextual (not generic "is this business?")

**The acid test:** look at 5 real `MerchantRule` rows. If any reasoning is generic or any citation is fabricated, the system prompt is broken. Send the specific bad row to Claude Code with: "This MerchantRule is wrong because [specific reason]. Fix the system prompt in /lib/ai/merchantIntelligence.ts and re-run."

---

# ═══════════════════════════════════════════════════════════════════════
# PROMPT 5 — STOP REVIEW + LEDGER (user resolution + review UI)
# ═══════════════════════════════════════════════════════════════════════

**Prerequisites:** Prompt 4 complete with classifications and STOPs populated.
**Duration:** 60–90 minutes.

--- COPY BELOW INTO CLAUDE CODE ---

```
Read CLAUDE.md and TaxLens_v6_Spec.md Parts 3.5 (User UX during categorization), 4.5 (Phase 4 STOPs), 4.6 (Phase 5 Ledger), 9 (Dynamic Questions — STOP templates).

Plan first. The plan must:

1. Design the STOP queue UX. STOPs grouped by category (merchant / transfer / deposit / 274d / period_gap) with category tabs showing count.
2. Per-STOP UI per template type (§9.3) — merchant STOP, transfer STOP, deposit STOP, §274(d) meal STOP.
3. Answer persistence: Classification append (new row with is_current=true, flipping prior via trigger-simulating code or manual flip in the same transaction), MerchantRule update if "apply to similar" toggled (default ON for merchant STOPs), AuditEvent row.
4. Natural-language override: a text box on the ledger that calls a targeted Sonnet 4.6 "reclassification" call with the user's instruction + affected transaction/merchant context.
5. Ledger view: TanStack Table with virtualization (react-virtual under TanStack), column filters, bulk selection, inline edit on code/pct/line.
6. Amazon split UI: a Dialog that takes one transaction and lets the user create up to 5 line-item splits summing to the original.
7. Performance target: ledger with 2000 rows must render at 60fps, first row visible in <500ms.

Plan. Stop for approval.

On approval:

STEP 1 — /app/(app)/years/[year]/stops/page.tsx:
   Tabs by StopCategory. Each tab shows a list of StopItem cards, sorted by total_amount desc.
   Card expands to show: Claude's human_question, the affected transactions in a mini-table, the answer form.
   Answer form per category matches spec §9.3 templates.
   "Apply to similar merchants" toggle for merchant-category STOPs (default on).

STEP 2 — /app/(app)/years/[year]/stops/actions.ts:
   resolveStop(stopId, answer, applyToSimilar) — performs:
     a. For each affected transaction, insert new Classification row with the answer-derived code/pct/reasoning (source=AI_USER_CONFIRMED for answer-confirmed AI; source=USER for owner-corrected).
     b. Flip prior Classification rows: is_current=false. This is a database transaction.
     c. If applyToSimilar and category=merchant: update MerchantRule with the new code/pct and set is_confirmed=true; re-run applyMerchantRules for that merchant_key only.
     d. Insert AuditEvent row capturing before/after state.
     e. Mark StopItem.state=ANSWERED with user_answer JSON.
   deferStop(stopId) — state=DEFERRED; does not block lock attempt but will show on risk dashboard.

STEP 3 — /app/(app)/years/[year]/ledger/page.tsx — the ledger view:
   TanStack Table with react-virtual.
   Columns: date | account | merchant_normalized | amount_normalized | code (editable dropdown) | sch_c_line (editable dropdown) | biz_pct (editable slider in popover) | deductible_amt (computed) | evidence_tier (badge) | confidence (bar 0–1) | is_user_confirmed (checkbox).
   Color coding per spec Part 10.1.
   Filter bar: account multi-select, code multi-select, line multi-select, date range, merchant search.
   Bulk actions (visible when ≥1 row selected): Reclassify as…, Set biz_pct, Confirm all, Unconfirm all.
   Explain popover per row: shows the stored reasoning + a "Re-explain" button calling the Explanation endpoint (only on demand).

STEP 4 — Natural-language override bar at top of ledger:
   Text input: "Tell the AI what to change…"
   Example placeholder: "Mark all Zelle payments to Francisco A. as personal."
   On submit: call /api/reclassify endpoint with the instruction + current filter context.
   Endpoint invokes Sonnet 4.6 targeted call: "The user said [instruction]. The current filter matches [N] transactions at these merchants [list]. Return a list of transaction IDs and the classification override to apply."
   Before applying, show a preview dialog: "This will change N rows. Proceed?" — yes applies via same Classification-append mechanism.

STEP 5 — Amazon split (Dialog):
   Trigger: a "Split" button on rows where merchant_normalized contains "AMAZON" AND amount > $50 (editable threshold).
   Dialog: up to 5 split rows, each with amount + code + line + biz_pct + reasoning. Sum must equal original (validated live).
   Save splits: create 5 new Transaction-like rows OR — cleaner design — store splits as child entities under the parent Transaction with is_split_of FK. Splits each have their own Classification. Parent is marked as is_split=true and excluded from deductible totals in favor of its children. Amend the Transaction model if needed via migration.

STEP 6 — Tests:
   - Resolving a merchant STOP creates one new Classification per affected txn, flips prior is_current, writes AuditEvent, updates MerchantRule.
   - Natural-language override preview endpoint returns expected transaction IDs for a simple instruction.
   - Amazon split: 5 splits summing to parent; parent excluded from Sch C totals.
   - Ledger renders 2000 synthetic rows without blocking the UI thread (measure via Vitest + jsdom timer).

STEP 7 — Update CLAUDE.md Session 5 notes.

STEP 8 — Commit: "feat(session-5): stop review + ledger — resolution ui, bulk actions, amazon split, nl override"

VERIFICATION:
- pnpm test
- Manual: answer a merchant STOP — verify the 5 affected txns reclassify and the MerchantRule updates
- Manual: use the NL override "Mark all gasoline charges outside trips as 60% business" — verify preview, apply, and expected changes
- Manual: split one Amazon transaction into 3 — verify totals

STOP.
```

--- END PROMPT ---

**VERIFICATION CHECKLIST (human):**
- [ ] Answering a STOP reclassifies all affected transactions in one atomic action
- [ ] AuditEvent rows created for every STOP resolution
- [ ] Natural-language override produces sensible previews before applying
- [ ] Amazon split sums correctly; parent excluded from Sch C
- [ ] Ledger handles 2000 rows smoothly

---

# ═══════════════════════════════════════════════════════════════════════
# PROMPT 6 — RESIDUAL AI + VALIDATION + LOCK (Phase 4 residual, QA, risk, lock)
# ═══════════════════════════════════════════════════════════════════════

**Prerequisites:** Prompt 5 complete. Most transactions classified, most STOPs resolved.
**Duration:** 60–90 minutes.

--- COPY BELOW INTO CLAUDE CODE ---

```
Read CLAUDE.md and v6 spec Parts 3.3 (residual pass justification), 6.2 (Residual Agent spec), 11 (Audit Risk Layer), 12 (QA Assertions), 4.7 (Lock).

Plan first. The plan must:

1. Residual Agent trigger rules: which transactions qualify for per-transaction AI (date+amount+trip-specific cases from spec).
2. System prompt structure for residual agent — differs from Merchant Agent because input is a single transaction with neighboring context.
3. The 12 QA assertions as executable TypeScript functions (one per item in spec Part 12).
4. The hard-block rules at lock: see spec Part 11.3 (NEEDS_CONTEXT remaining, §274(d) incomplete, period gaps, gross receipts reconciliation failure).
5. Risk score computation formula (spec Part 11.2).
6. Risk dashboard UI structure.
7. Lock UX: dashboard → "Attempt lock" → runs assertions → shows pass/fail → if all pass, confirm dialog → writes lock record.
8. Unlock UX: requires a rationale input, logs AuditEvent, marks existing Reports as STALE.

Plan. Stop for approval.

On approval:

STEP 1 — /lib/ai/residualTransaction.ts:
   Identify candidates: transactions where (a) merchant is multi-candidate in its MerchantRule (multiple plausible codes), (b) amount is >3σ from other charges at same merchant, (c) merchant is GRAY and amount >$500 AND trip-window status is ambiguous.
   classifyResidual(txn, merchantRule, profile, neighboringTxns): Promise<Classification>.
   Sonnet 4.6 call with full single-txn context. max_tokens: 1024. Temperature: 0.
   Result: Classification or a new StopItem if still ambiguous.

STEP 2 — /lib/validation/assertions.ts:
   runLockAssertions(taxYearId): Promise<{ passed: Assertion[], failed: Assertion[] }>.
   Implement all 12 assertions from spec Part 12 + the deposits reconstruction completeness check from 12.1.
   Each assertion returns { id, name, passed: boolean, details: string, blocking: boolean }.

STEP 3 — /lib/risk/score.ts:
   computeRiskScore(taxYearId): Promise<RiskReport>.
   Deterministic formula from spec Part 11.2. No AI here.
   Returns: { score, critical: RiskSignal[], high: RiskSignal[], medium: RiskSignal[], low: RiskSignal[], estimated_deductions, estimated_tax_impact }.
   For the tax impact estimate: simple (deductions × 0.25) as a ballpark — flagged as "informational estimate, not advice."

STEP 4 — /app/(app)/years/[year]/risk/page.tsx:
   Dashboard matching spec Part 11.1 mockup.
   Traffic-light sections: Critical (red, blocks lock), High (amber), Medium (yellow), Low (green).
   Each signal is expandable to show the contributing transactions.

STEP 5 — /app/(app)/years/[year]/lock/page.tsx:
   "Attempt lock" button runs assertions + risk score, shows results.
   If critical signals or blocking assertions exist: "Lock blocked" with a list of required fixes, each linking to the relevant page (ledger, stops, upload).
   If clean: "Confirm lock" dialog with a warning that unlocking requires a rationale. On confirm: transaction to set TaxYear.status=LOCKED, record locked_at + computed ledger hash.

STEP 6 — /app/(app)/years/[year]/unlock/actions.ts:
   unlockTaxYear(reason: string) — requires non-empty reason; writes AuditEvent TAXYEAR_UNLOCKED; marks all existing Reports is_current=false.

STEP 7 — Tests:
   - Residual agent classifies a known ambiguous txn (mock the API).
   - All 12 assertions: green fixture passes all, red fixtures each fail one assertion.
   - Risk score formula: construct a fixture with 6% meal ratio and verify +15 score.
   - Lock blocked when a CRITICAL signal present; lock succeeds when clean.
   - Unlock logs AuditEvent and marks Reports stale.

STEP 8 — CLAUDE.md Session 6 notes + commit.

VERIFICATION:
- pnpm test
- Manual: attempt lock on fixture — should show specific blocking issues
- Manual: resolve the blockers, attempt lock again — succeeds
- Manual: verify TaxYear.locked_snapshot_hash populated in Prisma Studio

STOP.
```

--- END PROMPT ---

---

# ═══════════════════════════════════════════════════════════════════════
# PROMPT 7 — OUTPUT ARTIFACTS (Master Ledger, Financial Statements, Audit Packet)
# ═══════════════════════════════════════════════════════════════════════

**Prerequisites:** Prompt 6 complete. A locked tax year exists in dev DB.
**Duration:** 90–120 minutes.

--- COPY BELOW INTO CLAUDE CODE ---

```
Read CLAUDE.md and v6 spec Part 10 (Output Artifacts).

Plan first. Cover:

1. XLSX generation library: exceljs (already installed).
2. Per-artifact sheet specs from spec §10.1, §10.2, §10.3 — map every column to a source field.
3. Color coding implementation in exceljs (fill, border, font).
4. Freeze panes, autofilter, column widths.
5. ZIP packaging for audit packet (node native zlib + archiver OR jszip).
6. Position Memo generator: Sonnet 4.6 for narrative only, citations pulled from rule library (not generated).
7. Download UX: trigger generation → show spinner → present_files via a signed URL or direct download.
8. Explicitly state: this session uses Node/exceljs only. No Python.

Plan. Approve. Execute.

STEP 1 — /lib/reports/masterLedger.ts:
   buildMasterLedger(taxYearId): Promise<Buffer> — generates the XLSX per spec §10.1.
   Five sheets: Transactions, Merchant Rules, Stop Resolutions, Profile Snapshot, Metadata.
   Color coding on Transactions sheet matches code.
   Freeze first row. Auto-filters on all columns.

STEP 2 — /lib/reports/financialStatements.ts:
   buildFinancialStatements(taxYearId): Promise<Buffer> per spec §10.2.
   Five sheets: General Ledger, Schedule C, P&L, Balance Sheet, Schedule C Detail.
   Schedule C sheet: every Sch C line populated, subtotal per line, IRC column, links to Schedule C Detail rows.
   P&L: Revenue → COGS → Gross Profit → Expenses (grouped by line) → Net Profit.
   Balance Sheet: simple cash-method format.
   Schedule C Detail: every deductible transaction grouped by Schedule C line.

STEP 3 — /lib/reports/auditPacket.ts:
   buildAuditPacket(taxYearId): Promise<Buffer> (zip).
   Contents per spec §10.3:
     01_transaction_ledger.pdf (export Master Ledger Transactions sheet to PDF via exceljs → HTML → a headless print; or simpler, just include as XLSX + CSV if PDF generation adds too much complexity — document the choice)
     02_274d_substantiation/ : meals.csv, travel.csv, vehicle.csv, gifts.csv
     03_cohan_labels.csv
     04_position_memos/ : §183_hobby.pdf (if loss), §274n2_100pct_meals.pdf (if MEALS_100 exist), §280A_home_office.pdf (if claimed), wardrobe.pdf (if wardrobe claimed)
     05_income_reconciliation.csv
     06_source_documents_inventory.csv
     README.md explaining the packet
   
   Use archiver for ZIP.

STEP 4 — /lib/ai/positionMemo.ts:
   For each memo type: takes structured facts (from profile + classifications) and generates narrative.
   Model: sonnet-4-6 for memos where exposure <$5K, opus-4-7 for >$5K.
   System prompt anchors on facts-law-analysis-conclusion structure.
   Citations: pulled from the rule library matching the memo type; never generated.
   [VERIFY] flagged if the memo touches a rule with needs_search_verification=true.

STEP 5 — /app/(app)/years/[year]/download/page.tsx:
   Three cards: Master Ledger, Financial Statements, Audit Packet.
   Each with a "Generate" button (only enabled if TaxYear.status=LOCKED).
   On generate: POST to /app/(app)/years/[year]/download/actions.ts → builds Buffer → stores as Report row → returns signed URL or direct File response.

STEP 6 — Tests:
   - Fixtures with known values → generated XLSX has expected sheet names and cell values.
   - Schedule C total sum equals sum of deductible_amt per the locked ledger.
   - Audit packet ZIP contains all expected files.
   - Position memo for §183 hobby generates facts/law/analysis/conclusion structure with citations from rule library only (parse the generated text and assert no non-library citation strings appear).

STEP 7 — CLAUDE.md Session 7 notes + commit.

VERIFICATION:
- pnpm test
- Manual: lock the fixture tax year, generate all three artifacts, download each, open in Excel, confirm formatting

STOP.
```

--- END PROMPT ---

---

# ═══════════════════════════════════════════════════════════════════════
# PROMPT 8 — HARDEN + E2E (DB triggers, rule library, [VERIFY] CI, end-to-end)
# ═══════════════════════════════════════════════════════════════════════

**Prerequisites:** Prompt 7 complete.
**Duration:** 90–120 minutes.

--- COPY BELOW INTO CLAUDE CODE ---

```
Read CLAUDE.md and v6 spec Parts 5.2 (immutability), 7 (rule library), 14 Session 8.

Plan first. Cover:

1. DB-level enforcement: PostgreSQL triggers to deny UPDATE/DELETE on transactions, classifications is_current flip done via trigger not app code, audit_events INSERT-only.
2. Rule library seeder: loads the V1 minimum rule set from spec §7.3 into RuleVersion rows with effective dates.
3. [VERIFY] CI check: a test that scans the active RuleVersion's JSON and fails if any needs_search_verification=true flag remains (these must be resolved before production).
4. Error boundaries (Next.js error.tsx), loading states (loading.tsx), empty states.
5. Sentry + Posthog integration (config only — keys from env).
6. E2E test: the acceptance criterion from the v6 spec — reprocess the Maznah Media 2025 fixture and compare locked numbers to the known-good Excel deliverable.

Plan. Approve. Execute.

STEP 1 — /prisma/migrations/NN_append_only_triggers/migration.sql:
   CREATE TRIGGER enforce_transaction_immutable BEFORE UPDATE OR DELETE ON "Transaction" FOR EACH ROW EXECUTE FUNCTION raise_exception('Transaction rows are immutable. Use reversal+corrected pattern.');
   CREATE TRIGGER enforce_audit_event_insert_only BEFORE UPDATE OR DELETE ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION raise_exception('AuditEvent is append-only.');
   CREATE FUNCTION flip_classification_is_current() RETURNS TRIGGER ... (on INSERT with is_current=true, set all other rows for this transaction_id to is_current=false).
   Apply migration. Update seed to use the reversal pattern where it previously might have edited rows.

STEP 2 — /prisma/seeds/ruleLibrary.ts:
   Encodes every rule from spec §7.3 with correct effective_from dates.
   Separate RuleVersion rows for 2024 (pre-OBBBA), 2025 (post-OBBBA §168(k)+§179), 2026 (indexed).
   Mark all thresholds requiring Rev. Proc. verification as needs_search_verification=true.
   Run during dev seed. In production, a separate loader script runs this and requires a --force-production flag plus confirmation.

STEP 3 — tests/ci/verify-rule-library.test.ts:
   Loads the current-year RuleVersion. Fails if any rule has needs_search_verification=true. This blocks production build.
   Before shipping Maznah Media's return: search IRS publications for current figures, update the rule entries, remove the flag.

STEP 4 — /app/error.tsx, /app/loading.tsx, /app/(app)/years/[year]/error.tsx:
   User-friendly error messages. For AI-specific errors: "The classifier is temporarily unavailable. Your data is safe. Retry in a moment."

STEP 5 — Sentry + Posthog:
   Install @sentry/nextjs + posthog-js. Config files using env keys; no-ops if keys missing.

STEP 6 — E2E acceptance test (tests/e2e/maznah-2025.test.ts):
   Uses a fixture built from the project files you already have (/mnt/project/* — copy sanitized versions into tests/fixtures/maznah-2025/).
   Known-good totals: total deductible expenses ≈ $37,048, gross receipts ≈ $2,818, home office 200/2000 sqft.
   Test:
     a. Seeds a fresh user with known profile.
     b. Uploads all fixture statements.
     c. Runs normalization, pairing, merchant intel, rule application, residual AI.
     d. Auto-answers STOPs using a canned answer map (stored in fixture).
     e. Runs lock.
     f. Asserts: total deductible within ±1% of $37,048; specific line totals within $10; specific transactions end up in specific codes.
   This test takes real Claude API tokens. Gate it behind a env flag: RUN_E2E=1. Otherwise skip.

STEP 7 — CLAUDE.md Session 8 notes. Mark V1 complete.

STEP 8 — Commit: "feat(session-8): harden — db triggers, rule library, verify gate, e2e"

VERIFICATION:
- pnpm test (all tests)
- RUN_E2E=1 pnpm test e2e (expected to pass within ±1%)
- Manual: attempt raw SQL UPDATE on a Transaction row → should raise exception
- Manual: verify CI would fail if [VERIFY] flag present
- Final: tag git v1.0.0

STOP.
```

--- END PROMPT ---

**VERIFICATION CHECKLIST (human):**
- [ ] Raw SQL `UPDATE "Transaction" SET merchant_raw='test' WHERE ...` raises exception
- [ ] Rule library has all V1 rules seeded
- [ ] [VERIFY] CI test fails if flags remain
- [ ] E2E Maznah 2025 fixture: locked totals within 1% of known-good $37,048
- [ ] `v1.0.0` git tag applied

---

# TROUBLESHOOTING

**Plan looks off:** reply with specific objections. Do not approve a plan that leaves key questions unanswered.

**Session runs out of context:** end the current session with a CLAUDE.md update that captures exactly where you stopped and what's next. Start a new session; it will re-read CLAUDE.md and pick up.

**A test that passed in Session N fails in Session N+1:** regression. Revert the offending change, diagnose, retry. Do not paper over with skipped tests.

**The AI classifier produces nonsense:** the system prompt is wrong. Isolate a bad case, paste the MerchantRule row + the profile into Claude Code with "This is wrong because X. The system prompt at /lib/ai/merchantIntelligence.ts needs a fix." Iterate on the prompt — do not paper over with hardcoded post-processing rules.

**You hit an OBBBA rule figure you're not sure about:** the spec has [VERIFY] flags for a reason. Search IRS publications for the current Rev. Proc. or Notice. If no authoritative source confirms, keep [VERIFY] and have a CPA review before Maznah's return is filed.

**Scope creep:** if Claude Code proposes adding something not in the spec's Part 13 "what's IN V1," reject. Every deferred feature (crypto, state tax, receipt upload, CPA share link) is V2+. V1 must ship.

---

**End of build prompts.**
