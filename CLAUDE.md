@AGENTS.md

# TaxLens — Claude Development Guide

## Project Purpose
TaxLens is a Schedule C tax-preparation SaaS. It ingests bank/credit-card statements, runs AI classification against IRS rules, and produces a ready-to-file Schedule C. Single user (sole prop / single-member LLC). Multi-year workspace model.

---

## 10 Non-Negotiable Principles

1. **Read before you write.** Always read the relevant source file(s) before editing. Never write from memory alone.
2. **Schema is the source of truth.** Every field in `prisma/schema.prisma` was chosen deliberately. Do not add, rename, or remove columns without explicit instruction.
3. **Append-only tables are immutable.** `Transaction`, `Classification`, and `AuditEvent` have NO `@updatedAt`. Never run `UPDATE` or `DELETE` on these rows. Use `isCurrent` flip + new insert for corrections.
4. **DB triggers are deferred to Session 8.** Until then, append-only enforcement is in application code only.
5. **Prisma v7 driver adapter is required.** The `PrismaClient` constructor requires `adapter: new PrismaPg({ connectionString })`. No direct URL option exists. See `lib/db.ts`.
6. **Next.js 16 uses `proxy.ts`, not `middleware.ts`.** Proxy defaults to Node.js runtime. The file exports `proxy` (not `default`) + `config.matcher`. JWT session check via `next-auth/jwt getToken`.
7. **Async params in Next.js 16.** Route params are `Promise<{...}>` — always `await params` before destructuring.
8. **`@/app/generated/prisma/client`** is the correct Prisma import path (not `@prisma/client` or `@/app/generated/prisma`). The v7 generator writes to a custom output dir with `client.ts` as the entry point.
9. **EvidenceTier is Int (1–5).** Numeric for range queries. businessPct is also Int (0–100). Never Float.
10. **Financial accounts = FinancialAccount** (not Account). The `Account` model is reserved for NextAuth OAuth tokens.

---

## Tech Stack (locked — do not upgrade without instruction)

| Layer | Version | Notes |
|---|---|---|
| Next.js | 16.2.4 | App Router, no src/ dir, `@/*` alias to project root |
| React | 19.2.4 | |
| TypeScript | 5.x | |
| Tailwind | v4 | CSS-variable config in globals.css, no tailwind.config.js |
| shadcn/ui | manual | CLI is fully interactive; components hand-written in components/ui/ |
| Prisma | v7.7.0 | generator `prisma-client`; output `app/generated/prisma`; URL in prisma.config.ts |
| @prisma/adapter-pg | 7.7.0 | Required runtime adapter |
| pg | 8.x | PostgreSQL driver |
| NextAuth | v5.0.0-beta.31 | JWT strategy; PrismaAdapter in auth.ts |
| bcryptjs | 3.x | Password hashing (12 rounds) |
| Vitest | 4.x | jsdom env for React tests; node env for DB/server tests |
| dotenv | 17.x | Loaded manually in seed.ts and tests |
| zod | 4.x | Schema validation |

---

## Session Build Progress

### ✅ Session 1 — Foundation (complete)
- [x] Next.js 16.2.4 scaffold (App Router, TypeScript, Tailwind v4)
- [x] Prisma v7 schema — 17 models, 13 enums
- [x] Migration applied: `prisma/migrations/`
- [x] Prisma client generated: `app/generated/prisma/`
- [x] `@prisma/adapter-pg` wired in `lib/db.ts`
- [x] NextAuth v5 JWT strategy with PrismaAdapter (`auth.ts`)
- [x] `lib/auth.ts` — `getSession`, `requireAuth`, `getCurrentUserId`
- [x] `proxy.ts` — JWT session check, redirects to /login (Next.js 16 proxy convention)
- [x] Route stubs: dashboard, onboarding, years/[year], login, signup
- [x] shadcn/ui components: Button, Card, Input, Label, Badge
- [x] Seed script: 1 user, 1 TaxYear, 5 accounts, 20 transactions, 20 classifications
- [x] 8/8 Vitest smoke tests passing
- [x] Dev server: 200 OK on `/login`

### ⬜ Session 2 — Profile Wizard (next)
- 12-question onboarding form
- BusinessProfile write-back
- Trip and KnownEntity management

### ⬜ Session 3 — Statement Ingestion
- CSV/OFX/QFX upload, parse, dedup
- StatementImport tracking

### ⬜ Session 4 — AI Classification (Agent 1)
- Merchant rule generation
- Batch transaction classification
- GRAY / STOP queue population

### ⬜ Session 5 — Review UI
- Classification review table
- Override workflow, isCurrent flip

### ⬜ Session 6 — Report Generation
- Master Ledger, Financial Statements, Audit Packet PDFs

### ⬜ Session 7 — Lock & Archive
- TaxYear lock + snapshot hash
- Export archive

### ⬜ Session 8 — DB Hardening
- Append-only triggers (deny UPDATE/DELETE on Transaction/Classification/AuditEvent)
- Migrations for trigger functions

---

## Decisions Locked (do not override)

- **EvidenceTier = Int** not enum — numeric range comparisons in classification logic
- **FinancialAccount** not Account — avoids NextAuth adapter conflict
- **JWT session strategy** (not database sessions) — avoids NextAuth Session table lock contention
- **No `src/` directory** — `@/*` alias maps directly to project root
- **Tailwind v4** — no `tailwind.config.js`; theme in `app/globals.css` via `@theme inline`
- **`prisma.config.ts`** holds DATABASE_URL for Prisma CLI; runtime uses `PrismaPg` adapter
- **`proxy.ts`** not `middleware.ts` (deprecated in Next.js 16)
- **Transaction self-relations** use 4 named relations: TxDuplicate, TxTransfer, TxPayment, TxRefund

---

## What NOT to Do

- ❌ Do NOT run `npx shadcn@latest` — it's fully interactive and will hang
- ❌ Do NOT use `@prisma/client` as import path — use `@/app/generated/prisma/client`
- ❌ Do NOT add `datasourceUrl` to PrismaClient constructor — it doesn't exist in v7
- ❌ Do NOT create `middleware.ts` — use `proxy.ts` (Next.js 16)
- ❌ Do NOT use `export const runtime = 'edge'` anywhere — Prisma v7 requires Node.js
- ❌ Do NOT use `params.year` directly — `params` is a Promise in Next.js 16, `await params` first
- ❌ Do NOT add `@updatedAt` to Transaction, Classification, or AuditEvent
- ❌ Do NOT use Float for businessPct or evidenceTier
- ❌ Do NOT create new Railway projects — project "amusing-patience" is the TaxLens project (provisioning Postgres deferred until Railway credits are topped up)

---

## Session Handoff Protocol

At the start of each session:
1. Run `pnpm test` — all tests must pass before writing new code
2. Read this CLAUDE.md and the relevant spec parts for the session
3. Read the current files you'll modify (never write from memory)
4. Present a step-by-step plan and wait for approval
5. Execute steps one at a time, committing at the end

At the end of each session:
1. Run `pnpm test` — all tests must still pass
2. Update the Build Progress checklist above
3. Add Session N notes below
4. `git add -A && git commit -m "feat(session-N): description"`

---

## Session 1 Notes

- Scaffolded in `taxlens-init/` subdir (pnpm create forbids capital letters in cwd name), then moved files
- shadcn CLI is fully interactive at v4.3.0 — wrote components by hand
- Docker Desktop not running; used `docker -H npipe:////./pipe/docker_engine` for local Postgres on port 5433
- Prisma v7 breaking changes: generator is `prisma-client`, output to `app/generated/prisma`, URL in `prisma.config.ts`, runtime requires `@prisma/adapter-pg`
- Next.js 16 breaking changes: `middleware.ts` → `proxy.ts`, `export default` → `export function proxy`, runs in Node.js runtime by default
- Next.js 16 async params: `params: Promise<{ year: string }>`, must `await params`
- Railway PostgreSQL provisioning failed ("Unknown error") — likely account credit limit ($1.85 remaining). Using local Docker Postgres (`localhost:5433`). Wire Railway DB in a future session.
- Database credentials (local dev): `postgresql://taxlens:taxlens_dev@localhost:5433/taxlens`
- Seed user: `najathakram1@gmail.com` / `taxlens2025!`
