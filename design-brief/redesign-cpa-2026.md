# TaxLens — CPA Workflow Redesign Brief

> **For:** A Claude-powered design agent with full read access to this repo.
> **Goal:** Replace the current single-taxpayer UI with a three-tier platform — **super admin → CPA → client** — where each tier has a coherent workspace, impersonation flows correctly down the chain, and the audit defense rigor that already exists is preserved.
> **Read first:** `CLAUDE.md`, `AGENTS.md`, `prisma/schema.prisma`, `app/(app)/layout.tsx`, `app/(cpa)/layout.tsx`, `lib/cpa/clientContext.ts`, `lib/admin/adminContext.ts`, `lib/auth.ts`. They contain non-obvious constraints (Next.js 16, Prisma v7, Tailwind v4, hand-written shadcn components) that determine what's buildable.

---

## 0. The brief in one paragraph

TaxLens already has the correct *data model* for a CPA tool — `User.role` (now SUPER_ADMIN / CPA / CLIENT), a `CpaClient` join table, cookie-based impersonation, and `getCurrentUserId()` that auto-resolves to the deepest impersonation target. What it lacks is a *workspace mental model* for each tier: the current UI treats every login like a single taxpayer. The platform is now three tiers — a **platform super admin** who manages CPA accounts and can impersonate any CPA for support; **CPAs** who manage their own roster of clients across many tax years; and **clients** who occasionally log in to answer STOPs and approve packages. The redesign's job is to give each tier one coherent workspace where the *next tier down* is the primary noun, the next lens is one click away, and everything an audit-ready return needs is reachable in two clicks. Don't change the data model unless absolutely required; restructure routes, navigation, and information density.

---

## 1. Personas & jobs-to-be-done

### Tier-0 persona — Platform super admin (Anthropic-side operator)

The person running TaxLens itself. Today there's one of them. They never prepare taxes — they keep the platform running and CPA accounts in good standing.

**Jobs:**

1. **Onboard a new CPA in <2 minutes** — name, email, temp password, optional firm display name. The CPA receives credentials, logs in, sees an empty `/workspace`.
2. **List all CPAs** with: client count, total locked returns YTD, last login, last action. Filter by active / inactive.
3. **Edit a CPA** — change display name, reset password, mark inactive (soft suspend, no data deletion).
4. **Impersonate a CPA for support** — when a CPA emails saying "my Sara Mendoza ledger is broken", the admin enters that CPA's workspace exactly as they would see it. From there, they can also enter any of that CPA's client workspaces. Triple-tier impersonation: admin → CPA → client. Every click during impersonation is captured in the audit trail with both `actorAdminUserId` and `actorCpaUserId` set.
5. **See cross-firm audit log** — every `AuditEvent` across every CPA, filterable by actor / event type / date range. This is the platform's compliance surface.
6. **Disable a CPA** without deleting their data — set `isActive=false`, prevent login, keep audit trail.

The super admin **does not** prepare taxes themselves. They never see a STOPs queue, never lock a year, never download an audit packet on their own behalf. If they need to do any of those, they impersonate a CPA first.

### Primary persona — Najath, CPA

Tax preparer running a small practice. Today handles ~5 sole-prop / SMLLC Schedule C clients; expects to grow to 25–50. Cycle is annual but the busy crunch is March–April. Time is the binding constraint.

**Jobs the UI must support, in priority order:**

1. **Triage daily** — "Of my 12 clients, who needs me right now?" — show overdue uploads, pending STOPs, blocked locks at a glance.
2. **Onboard a new client in <10 minutes** — collect business profile, request statements via secure link, set engagement preferences.
3. **Process one client end-to-end** — upload statements → run pipeline → answer STOPs → review ledger → review risk → lock → download deliverables. Ten visits to the same client per tax year on average.
4. **Switch clients fast** — keyboard shortcut + recents list. Today switching is a 3-click round trip through `/clients`. Should be ≤1 click.
5. **Compare a client's year-over-year numbers** — gross receipts, deductions, risk score, lock status across 2023/2024/2025/2026 in one view.
6. **Audit-defend a return after the fact** — given an IRS inquiry on Atif's 2024 meal deductions, find the substantiation, the source statement, the position memo, and the audit packet that was generated, in <2 minutes.
7. **Handle non-statement documents** — W-9s collected from contractors, 1099-NEC issued, 1099-K received, signed engagement letter, prior-year return PDF, IRS notice scans. Today there's nowhere for these.
8. **Show a client what's happening** — share a read-only progress view ("we're at 73%, 4 questions outstanding") without giving them edit access. Optional but valued.

### Secondary persona — Client (Atif)

Self-employed sole prop. Logs in only to (a) answer STOPs the CPA flagged for them, (b) upload a missing statement, (c) sign off on the final package. Rarely uses the tool unprompted. Should not feel like a "second-class" experience.

### Anti-persona — IRS examiner

Never logs in. But they read the **audit packet** — every artifact must be readable and defensible by them after the fact. Don't let cosmetic redesign weaken `/audit-packet` exports.

### Anti-persona — Bad-actor admin

A super admin who tries to silently fix a client's numbers under cover of CPA impersonation. The audit trail must make this impossible to hide: every event during admin-impersonating-CPA must record `actorAdminUserId` separately from `actorCpaUserId`. The cross-firm audit log lets a different super admin (or external auditor) detect this after the fact. Don't add a "stealth mode" that hides admin actions from the audit trail. Ever.

---

## 2. Design principles (non-negotiable)

0. **Three tiers, one mental model.** Every page belongs to exactly one tier (admin, CPA, client). When impersonating, the user always sees the *target tier's* UI, with a chrome banner that makes the impersonation chain visible. No "hybrid" pages. No mode switches.
1. **Client is the primary noun.** For CPAs and clients, everything is "Atif > 2025 > Ledger", not "Ledger > Atif > 2025". For admins, the primary noun is the **CPA**: "Najath > Atif > 2025 > Ledger". The URL hierarchy, navigation, breadcrumbs, and titles all reflect this.
2. **Year is the primary lens, not a hidden detail.** The current design buries the year inside one client's sidebar. The new design puts the year selector beside the client selector, both first-class.
3. **Calm, dense, professional.** This is a tool used 4 hours a day by someone with strong opinions. No marketing gradients. No emoji decoration. No animations that block work. Information density above visual flourish — this should feel closer to Linear or a modern Bloomberg terminal than to a consumer SaaS landing page.
4. **Status is always visible.** Every page shows: which client, which year, year status (CREATED → INGESTION → REVIEW → LOCKED), pending blockers count, last action timestamp. Never let the CPA wonder "where am I?"
5. **One number, one place.** A CPA-flagged data-quality fix already landed (B8): the same Schedule C deductible total renders in the ledger header, the risk page, the financial statements, and A03. **Maintain that invariant.** Any new place that surfaces "deductible" must use `lib/classification/deductible.ts:computeDeductibleAmt`.
6. **Keyboard-first.** Cmd-K command palette to switch client / switch year / jump to a section. Shortcuts for "next stop", "approve and continue", "open ledger". A CPA should rarely reach for the mouse.
7. **No fabrication, ever.** Same rule as the AI: the UI never makes up a status, attendee name, or amount. If data is missing, show a placeholder with a "fix this" link, never a guess. (See CLAUDE.md principle 8.)
8. **Audit trail visible on demand.** Every meaningful row should let you peek at "who did this, when, with what rationale" — `AuditEvent` already records this. Surface it in a side panel, not a modal that takes you out of context.
9. **Don't redesign the data; redesign the path through it.** The schema, classification logic, AI agents, assertions, and lock flow are correct as-shipped. They are paid-for work. Redesign navigation, layouts, components, and content density. Leave the engine alone.
10. **Bounded autonomy.** The new UI never publishes anything externally, never sends client emails on its own, never authorizes a download without explicit click — same principle 9 from CLAUDE.md.
11. **Impersonation is always visible, never silent.** When admin → CPA, the chrome shows it. When admin → CPA → client, the chrome shows the full chain. The "Exit impersonation" affordance is always within one click. Closing the tab does NOT clear impersonation cookies — the user must explicitly exit. (Cookies expire after 8 hours regardless.)
12. **Admin actions are auditable, never invisible.** Every AuditEvent during admin impersonation records `actorAdminUserId`. The cross-firm audit log surfaces these distinctly. There is no "stealth admin mode."

---

## 3. Information architecture

### URL structure (the primary deliverable of this redesign)

```
/                                       ← redirects based on role:
                                          SUPER_ADMIN → /admin
                                          CPA         → /workspace
                                          CLIENT      → /workspace (their own)
/login, /signup                         ← unchanged (signup creates a CLIENT only;
                                          CPA accounts are created by an admin)

# ── Super admin tier ─────────────────────────────────────────────────────
/admin                                  ← admin home: KPI strip + "needs attention"
/admin/cpas                             ← list of all CPAs (table-as-spreadsheet)
/admin/cpas/new                         ← create CPA
/admin/cpas/[cpaId]                     ← CPA detail (clients owned, recent activity)
/admin/cpas/[cpaId]/edit                ← edit display name / reset password / suspend
/admin/audit                            ← cross-firm audit event log
/admin/settings                         ← platform-level settings (rule version pinning, etc.)

# ── CPA tier (impersonation can target this from admin) ──────────────────
/workspace                              ← CPA home (replaces /dashboard for CPAs)
/workspace/inbox                        ← cross-client triage queue (NEW)
/workspace/calendar                     ← deadline-aware view (NEW, optional)
/workspace/firm                         ← firm-level analytics (today /clients/analytics)

/clients                                ← list of all clients with year-strip per client
/clients/new                            ← add client wizard
/clients/[clientId]                     ← client home (years grid, quick stats, recent activity)
/clients/[clientId]/profile             ← business profile (today /profile)
/clients/[clientId]/documents           ← per-client document hub (NEW — see §4 below)

# ── Client-year tier (impersonation can target this from CPA, or from admin via CPA) ──
/clients/[clientId]/years/[year]                      ← year overview (replaces today's /years/[year])
/clients/[clientId]/years/[year]/upload               ← (today /years/[year]/upload)
/clients/[clientId]/years/[year]/coverage             ← idem
/clients/[clientId]/years/[year]/pipeline             ← idem
/clients/[clientId]/years/[year]/stops                ← idem
/clients/[clientId]/years/[year]/ledger               ← idem
/clients/[clientId]/years/[year]/risk                 ← idem
/clients/[clientId]/years/[year]/analytics            ← idem
/clients/[clientId]/years/[year]/lock                 ← idem
/clients/[clientId]/years/[year]/download             ← idem
/clients/[clientId]/years/[year]/audit-trail         ← (NEW) AuditEvent stream for this year

# ── Account-level (any tier) ─────────────────────────────────────────────
/account/profile                        ← user's own settings (works for all 3 roles)
/account/firm                           ← CPA-only: firm-level settings (logo, default rule version)
/account/billing                        ← subscription / usage (deferred)
```

**Key change:** every taxpayer-context route is rooted under `/clients/[clientId]/...`. The `/years/[year]/...` routes that exist today should be **kept as redirect shims** that resolve `clientId` from the cookie context and 301 to the canonical URL — so existing bookmarks, audit packet links, and email reminders don't break.

**Solo-CLIENT-login mode** (Atif logging in directly): instead of restructuring the app twice, log them in as if they had impersonated themselves — the cookie context resolves `clientId = session.user.id` automatically. They see the same `/clients/[clientId]/...` URLs, just with the client picker hidden.

### Navigation shell

**Standard CPA-tier shell** (CPA logged in, possibly impersonating a client):

```
┌────────────────────────────────────────────────────────────────────────┐
│  TaxLens [CPA: Najath ▾]   ⌘K  Search clients & years         🔔  ?    │  ← Top bar
├──────────────────────┬─────────────────────────────────────────────────┤
│ ● Workspace          │  Atif Khan  ▾   |   2025  ▾   ●  REVIEW         │  ← Context bar
│   Inbox       [4]    │                                                 │  (only when in client context)
│   Firm overview      │                                                 │
│ ─────────────────    │                                                 │
│ ● Clients            │                                                 │
│   Atif Khan          │                                                 │
│   Sara Mendoza  [2]  │  <main>                                         │
│   ...                │                                                 │
│ ─────────────────    │                                                 │
│ Atif Khan / 2025     │                                                 │
│   Year overview      │                                                 │
│   Documents     [3]  │                                                 │
│   Upload             │                                                 │
│   Coverage           │                                                 │
│   Pipeline           │                                                 │
│   Stops         [4]  │                                                 │
│   Ledger             │                                                 │
│   Risk               │                                                 │
│   Lock               │                                                 │
│   Audit trail        │                                                 │
│   Download           │                                                 │
│ ─────────────────    │                                                 │
│ najath@…  [sign out] │                                                 │
└──────────────────────┴─────────────────────────────────────────────────┘
```

**Sidebar rules:**

- The "Atif Khan / 2025" sub-menu only appears when a client + year are active. It collapses to "Pick a year" when only the client is active.
- Numeric badges on Inbox, Stops, Documents are real counts pulled server-side.
- "Atif Khan" in the Clients section uses an avatar (initials in a colored circle, deterministic hash of email) — it's the only avatar in the app.
- The CPA's own row (top-right, "CPA: Najath") is a popover with: Switch firm, Account settings, Sign out.

**Top bar:**

- Cmd-K palette (use `cmdk` from shadcn) — searches clients, years, and known doc tags. Power-user surface.
- 🔔 = system notifications, NOT email. Placeholder for V2.

**Admin-tier shell** (super admin logged in, possibly impersonating a CPA):

```
┌────────────────────────────────────────────────────────────────────────┐
│  TaxLens [ADMIN: Anthropic ▾]   ⌘K  Search CPAs & clients     🔔  ?    │
├──────────────────────┬─────────────────────────────────────────────────┤
│ ● Admin              │                                                 │
│   Dashboard          │                                                 │
│   CPAs       [12]    │                                                 │
│   Audit log  [HOT]   │  <main>                                         │
│   Settings           │                                                 │
│ ─────────────────    │                                                 │
│ admin@…  [sign out]  │                                                 │
└──────────────────────┴─────────────────────────────────────────────────┘
```

When the admin impersonates a CPA, the shell switches to the CPA-tier layout above, with a **stacked impersonation banner** at the top (purple over amber):

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ADMIN: Anthropic operator   →   acting as CPA: Najath  [Exit admin]     │  ← purple
├─────────────────────────────────────────────────────────────────────────┤
│ Najath on behalf of Atif Khan (atif@example.com)   [Exit client →]      │  ← amber
└─────────────────────────────────────────────────────────────────────────┘
```

The bottom (amber) banner only appears when the impersonated CPA has *also* entered a client workspace. The order matters: admin row above CPA row, never reversed. Each row has its own "Exit" button — exiting client returns to "admin → CPA"; exiting admin returns to "/admin/cpas".

---

## 4. New surfaces (designs needed)

### 4.0 `/admin` — super admin home

The first screen after a SUPER_ADMIN logs in.

**Top — KPI strip:**

| Active CPAs | Total clients | Total locked YTD | Total deductions claimed YTD | Errors flagged (24h) |
|---|---|---|---|---|

**Below — "Needs attention":** A flat list of items the platform operator should look at. E.g.:

- 🟠 PARSE_FAIL spike: "Najath / 2 imports failed in the last 24h" (links to filter on `/admin/audit?eventType=MERCHANT_AI_PARSE_FAIL`)
- 🔵 NEW_CPA: "Sarah Mendoza signed up 1h ago — first onboard not yet started"
- ⚫ LOGIN_INACTIVE: "3 CPAs not logged in for 90+ days"

**Below — recent activity:** last 20 events from `actorAdminUserId IS NOT NULL` — shows what other admins (or the user themselves) did recently. Full log at `/admin/audit`.

### 4.0.1 `/admin/cpas` — manage CPAs

Table-as-spreadsheet. Rows = CPAs. Columns:

- Name, email, status (active / suspended), client count, total deductions YTD across all clients, last login, last action timestamp.
- Right-click row → "Impersonate", "Edit", "Reset password", "Suspend".
- Top-right: `+ Add CPA` button → `/admin/cpas/new`.
- Filter: by status, by tags, by activity recency.

### 4.0.2 `/admin/cpas/new` — create CPA

Single form, three fields: name, email, optional firm display name. Submit → creates User with `role=CPA`, generates a temp password, shows it once with a "Copy" button (admin emails it out of band).

### 4.0.3 `/admin/cpas/[cpaId]` — CPA detail

Read-only summary of a single CPA: profile fields, list of clients, recent activity, total deductions, lock count.

Two action buttons at top:

- `Impersonate this CPA →` (sets the admin context cookie, redirects to `/workspace`)
- `Edit profile →` (links to `/admin/cpas/[cpaId]/edit`)

### 4.0.4 `/admin/audit` — cross-firm audit log

Time-sorted list of every AuditEvent platform-wide. Filters:

- Event type (multi-select)
- Actor type (USER / AI / SYSTEM)
- Has `actorAdminUserId` (i.e., admin actions only)
- Has `actorCpaUserId`
- Date range
- Specific CPA / specific client

Export-to-CSV button for compliance handoff.

### 4.0.5 `/admin/settings`

Platform-level configuration: pinned RuleVersion, default model overrides, feature flags, base UPLOAD_BASE_DIR. Most fields are read-only display in V1; mutation surface deferred.

### 4.1 `/workspace` — CPA home / triage

The CPA's first screen after login. Replaces `/dashboard` for CPAs (CLIENT-role users keep the existing dashboard).

**Top section — "Inbox" (cross-client triage queue):**

A flat list of items needing the CPA's attention right now, *across all clients*. Each row is a single action with one-click navigation:

- 🔴 BLOCKER: "Atif Khan / 2024 — 3 unclassified deposits ($12,340)" → click goes to `/clients/<atif>/years/2024/stops?category=DEPOSIT`
- 🟡 PENDING: "Sara Mendoza / 2025 — 14 STOPs awaiting review" → `…/stops`
- 🟢 READY: "Marcus Liu / 2024 — risk score green, ready to lock" → `…/lock`
- ⏰ DEADLINE: "Sara Mendoza — Q3 estimated tax due in 6 days" (only if §C7 retirement / SE tax module ships)

Group by severity. Sort within a group by `lastActivityAt`. Show 20 items, "show all" link.

**Below — KPI strip:**

| Active clients | Locked YTD | Pending lock | Total deductions claimed | Avg risk score |
|---|---|---|---|---|

These are firm-level KPIs (replaces today's `/clients/analytics` which moves under `/workspace/firm`).

**Below — recent activity:**

Last 10 audit events across all clients, with actor + rationale. Same component as the "Audit trail" view in §3.

### 4.2 `/clients` — clients list, redesigned

Today: a list of cards with one client per card and the latest year inline. Redesign:

- A table-as-spreadsheet layout: rows = clients, columns = tax years 2023, 2024, 2025, 2026. Each cell shows a status pill (CREATED / INGESTION / REVIEW / LOCKED) and a deduction amount. Empty cells = "add year".
- Clicking the cell goes directly to that client+year overview.
- A search box, a filter ("only clients with blockers", "only locked YTD"), and a "+ Add client" button.
- One row per client; sticky-left first column with avatar + name + email.

This is the *one screen a CPA leaves open in a tab*. Make it dense.

### 4.3 `/clients/[clientId]` — client home

The client's own homepage, scoped to all their years.

```
[Avatar] Atif Khan                                 najathakram1@gmail.com
NAICS 711510 · Independent Artist · TX · Sole prop · §471(c) cash method

┌──────────────────────────────────────────────────────────────────────┐
│ Year       Status     Receipts     Deductions   Net   Risk   Locked? │
│ 2026  +    [add year]                                                │
│ 2025      REVIEW     $21,797      $40,891      -$19K    1     —     │
│ 2024      LOCKED     $86,420      $42,310     $44,110   12    Mar 31 │
│ 2023      LOCKED     $74,000      $38,200     $35,800    9    Apr 14 │
└──────────────────────────────────────────────────────────────────────┘

Documents  (view all)
- 1099-NEC issued 2025 — Mar 12
- W-9 from Acme LLC — Feb 28
- Engagement letter 2025 — Feb 1
- IRS letter CP2000 (2023) — Jan 9

Recent activity
- 2 hours ago — Najath resolved 4 STOPs in Atif Khan / 2025
- yesterday — System auto-classified 23 transactions in 2025
- 3 days ago — Najath uploaded 2024 Chase Credit Card statements (8 files)
```

The top "year strip" is the navigation hub — clicking a year goes to its overview. The Documents section is a peek; full management lives at `/clients/[clientId]/documents`.

### 4.4 `/clients/[clientId]/documents` — document hub (NEW)

The schema's `StatementImport` model only stores bank/card statements. CPAs accumulate many other docs. Add a generic `Document` model (see §6 backend) and surface it here.

**Categories:**

- **Statements** (existing) — bank/CC/processor statements. Already in `StatementImport`. Show inline here, don't duplicate.
- **Tax forms received** — 1099-NEC, 1099-K, 1099-MISC, 1099-INT, W-2 (rare for sole prop), Schedule K-1 (multi-entity).
- **Tax forms issued** — 1099-NEC issued to contractors, 1099-MISC, W-2 (if employees).
- **Engagement & legal** — engagement letter, signed Form 8879 e-file authorization, prior-year returns.
- **IRS correspondence** — notices, transcripts, audit letters. Sensitive — flag for special handling.
- **Receipts** — itemized receipts that substantiate §274(d) deductions, especially for >$75 meals/lodging.

**Per-document fields:**

- Title, category, year (one or many), tags, uploaded_by, uploaded_at, file_path, mime, size, optional linked_classification_ids (for receipts substantiating specific transactions).

**Operations:**

- Drag-drop upload with category auto-detect by filename.
- Bulk download as ZIP per category-year.
- Link a receipt to a transaction (gray-zone meal → tier bumped from 4 → 1).

### 4.5 Per-year sidebar improvements

The current per-year nav (Upload / Coverage / Pipeline / STOPs / Ledger / Risk / Analytics / Lock / Download) is correct in scope but has flat labels. Redesign:

- **Group with section headers**: "Ingest" (Upload, Coverage), "Process" (Pipeline, STOPs), "Review" (Ledger, Risk, Analytics), "Deliver" (Lock, Download). The CPA mental model is staged.
- **Show progress per stage** as a thin bar under each header. E.g. "Ingest: 6 of 8 statements uploaded — 75%".
- **Mark blockers** with a red dot on the section header that contains them.
- **Numerical badges**: `STOPs (66)`, `Coverage (3 gaps)`.

### 4.6 `/clients/[clientId]/years/[year]/audit-trail` (NEW)

A flat, time-sorted list of every `AuditEvent` for this client+year, with filters by event type and actor. This is the artifact a CPA hands to opposing counsel if there's ever a dispute about who did what when. Already most-of-the-data exists; it just needs a view.

Columns: timestamp · actor (CPA on behalf of CLIENT) · event type · entity type+id · before/after diff (collapsible) · rationale.

Use the `AuditEvent.actorCpaUserId` field added in this redesign's backend changes (see §6) to make "Najath, on behalf of Atif" explicit.

### 4.7 Cmd-K command palette

A `cmdk`-based palette opening on ⌘K. Three categories:

1. **Switch client** — fuzzy match against name/email.
2. **Switch year** — for the active client.
3. **Jump to** — Inbox, Firm overview, Documents (active client), Stops (active year), Ledger, Risk.

Recently-used items show first.

---

## 5. Visual direction

The aesthetic to imitate is **Linear / Vercel / Stripe Dashboard**, not consumer SaaS. Specifics:

- **Type scale:** clamp-based, base 14px (1rem = 16px). Headings only at 18 / 22 / 28. Numbers tabular-nums everywhere.
- **Color:** stay with the existing Tailwind v4 token system (`background`, `foreground`, `muted`, etc.). Don't introduce a new palette.
- **Status colors:**
  - LOW / OK → `green-600`
  - MODERATE → `amber-600`
  - HIGH → `orange-600`
  - CRITICAL / BLOCKER → `red-600`
  Keep the *same* tokens used in `lib/classification/constants.ts:CODE_FILL` so XLSX exports match the UI.
- **Spacing:** generous internal padding, modest external. Tables use `border-b border-muted` rows, no zebra striping.
- **Tables:** TanStack Table with virtualization where >200 rows. Inline editing patterns from the existing ledger should carry over.
- **Icons:** lucide-react only. Never two icons in the same row that mean overlapping things.
- **Animations:** instant page transitions, no skeleton screens >200ms. For long-running actions (Run Pipeline), a tiny progress inline-block with token counts ("Step 5/9 · 1,234 / 4,096 tokens").
- **No emoji in the UI.** The status pills use color and a 1-letter code (B for blocker, etc.). Emoji is fine in the *brief and audit trail rationale*; just not chrome.

---

## 6. Required backend changes (already done by the redesign-shipping commit)

These primitives must exist before the new UI can be built. The commit accompanying this brief lands them:

1. **`UserRole.SUPER_ADMIN`** — new enum value alongside CPA and CLIENT. Granting it is a manual DB operation in V1 (no UI to promote a user to super admin); see "seed an admin" below.
2. **`AuditEvent.actorCpaUserId`** — when a CPA acts on behalf of a client, this captures the CPA's own user id alongside `userId` (which is the impersonated client id). The audit-trail view at §4.6 reads from this.
3. **`AuditEvent.actorAdminUserId`** — when a super admin acts (whether impersonating a CPA or just touching the admin surfaces), this captures the admin's own user id. Combined with `actorCpaUserId`, the audit trail can reconstruct the full impersonation chain after the fact.
4. **`Document` model** — the new `/clients/[clientId]/documents` hub needs a model. Fields per §4.4. Storage path: `<UPLOAD_BASE_DIR>/documents/<userId>/<documentId>` (sibling to existing `<UPLOAD_BASE_DIR>/<taxYearId>/...`).
5. **`getCurrentCpaContext()`** helper — returns `{ cpaId, cpaName, cpaEmail }` of the *logged-in CPA* (whether or not impersonating). The top-bar "CPA: Najath ▾" widget reads from this.
6. **`getCurrentAdminContext()`** helper (in `lib/admin/adminContext.ts`) — returns `{ adminId, adminName, adminEmail, impersonatedCpaId? }` of the *logged-in super admin*. Returns null for non-admin sessions. Used by the admin shell to populate the top-bar admin badge and by every `writeAuditEvent` site to capture admin actor.
7. **Admin-impersonation cookie** — `taxlens_admin_ctx` = `${adminId}:${cpaId}` set by `enterCpaSession(cpaId)` and cleared by `exitCpaSession()`. Coexists with `taxlens_client_ctx` to support admin → CPA → client. `getCurrentUserId()` resolves in order: `client_ctx.clientId` → `admin_ctx.cpaId` → `session.user.id`, so the deepest impersonation level wins.
8. **Server actions for CPA switching** — `enterCpaSession(cpaId)` (admin-only; sets the cookie + writes an AuditEvent of type `ADMIN_ASSUMED_CPA`) and `exitCpaSession()` (clears cookie + writes `ADMIN_RELEASED_CPA`).
9. **Server actions for client switching** — `enterClientSession(clientId)` and `exitClientSession()` already exist; the redesign uses them as-is. Add `getRecentClients(limit)` for the Cmd-K palette.
10. **Multi-year listing API** — `getClientYearStrip(clientId)` returning the year-strip data shape used by `/clients` table and `/clients/[clientId]` overview.
11. **`writeAuditEvent({...})`** — the audit-event helper auto-fills BOTH `actorCpaUserId` (from `getClientContext`) AND `actorAdminUserId` (from `getCurrentAdminContext`). Replaces `prisma.auditEvent.create` at sites that need impersonation provenance.
12. **Role guard helpers** — `requireRole("SUPER_ADMIN")` for `/admin/*` routes and `requireRole("CPA")` for `/workspace`, `/clients/*` routes (with bypass when admin is impersonating a CPA).

**Seed an initial super admin:** `pnpm tsx scripts/promote-admin.ts <email>` — finds the user, sets `role=SUPER_ADMIN`, writes an AuditEvent. Run once after deploy. There is no UI to do this on purpose — promoting users to admin is intentionally a DB-side operation, kept off the production UI to prevent privilege escalation via a phished CPA session.

The redesign should NOT add new database migrations beyond these — the existing schema and the changes above cover §3–§5.

---

## 7. Acceptance criteria for the redesign

The redesigned app passes when **all** of these are true on three test logins (one super admin, one CPA with 2 clients × 2 years each, one solo client):

**CPA tier (Najath):**

- [ ] Switching from one client+year to another takes ≤2 clicks (or ≤3 keystrokes via ⌘K).
- [ ] On any page with a client+year context, the CPA can see in the chrome: client name, year number, year status, blocker count.
- [ ] The Inbox shows triage items across all clients without requiring a per-client visit.
- [ ] `/clients` table renders 50 clients in <1s without virtual scrolling jank.
- [ ] All existing per-year pages (upload, coverage, pipeline, stops, ledger, risk, analytics, lock, download) render *unchanged* in their data tables and forms — only the chrome around them changes.
- [ ] The ledger header total, risk page total, A03 sum, and Schedule C grand total all match (the B8 invariant).
- [ ] All existing audit packets, master ledger, financial statements, and tax package downloads work without modification.
- [ ] Old URLs (`/years/[year]/...`) still resolve via 301s using the cookie context.
- [ ] Solo-client login (Atif logging in directly) still works — they see exactly the per-year flow they see today, just under the new URL structure.
- [ ] No new emoji introduced in the chrome. Existing emoji-in-status (✓ / ✗) remain.
- [ ] Lighthouse a11y score ≥95 on `/clients`, `/clients/[id]`, `/clients/[id]/years/[year]/ledger`.
- [ ] Cmd-K palette works on Mac and Windows.
- [ ] Sign-in → "I am Najath, working on Atif's 2025" → drag-drop a statement → resolve a STOP → lock the year → download the audit packet flow takes <30s of clicks (i.e., the chrome doesn't get in the way).

**Admin tier:**

- [ ] Admin login → `/admin` renders KPI strip, "needs attention" list, recent admin activity.
- [ ] `/admin/cpas` shows all CPAs with last-login, client count, deductions YTD.
- [ ] `+ Add CPA` flow: name + email + temp-password reveal → CPA can log in immediately with that password.
- [ ] Impersonate flow: admin clicks "Impersonate" on a CPA row → lands on `/workspace` as that CPA, with the **purple admin banner** at top showing "ADMIN: <admin name> → CPA: <cpa name>".
- [ ] During admin impersonation, every AuditEvent written has BOTH `actorCpaUserId` and `actorAdminUserId` set.
- [ ] Triple impersonation works: admin → CPA → enter client workspace → both purple AND amber banners visible.
- [ ] "Exit" buttons unwind the chain in correct order: client → CPA → admin home.
- [ ] `/admin/audit` log filters by `actorAdminUserId IS NOT NULL` correctly; CSV export works.
- [ ] Suspended CPA cannot log in (auth.ts respects an `isActive=false` flag on User).

**Cross-tier:**

- [ ] A CLIENT-role login redirects to `/workspace` (their own data); they cannot reach `/admin/*` or `/clients/*` (CPA's client list).
- [ ] A CPA-role login redirects to `/workspace`; they cannot reach `/admin/*`.
- [ ] An admin who has not started impersonation cannot reach `/clients/*` (the CPA's roster) — they must `enterCpaSession` first.

---

## 8. Hard constraints

These are the rails — break them and the redesign is wrong.

- **Stack:** Next.js 16 (App Router, `proxy.ts` not `middleware.ts`, async route params), React 19, TypeScript strict, Tailwind v4 (no `tailwind.config.js`, CSS variables), Prisma 7 (`@prisma/adapter-pg`, generated to `app/generated/prisma`), shadcn/ui (hand-written; do NOT run `npx shadcn` — see CLAUDE.md), TanStack Query/Table v5+v8, Zustand v5, Vitest v4, Anthropic SDK 0.90+ (Sonnet 4.6 + Opus 4.7 for memos + Haiku 4.5 for PDF cleanup).
- **Don't change** the AI agents (`lib/ai/*`), the pairing modules (`lib/pairing/*`), the lock flow (`lib/lock/*`), the assertions (`lib/validation/assertions.ts`), the rule library, or the report builders (`lib/reports/*`). They're correct.
- **Don't change** the data formula. `computeDeductibleAmt` from `lib/classification/deductible.ts` is the only function that says "how much of this transaction is deductible." Every chart, total, and export must call it (or transitively call it via existing modules).
- **Don't add** a chat / agent UI. The user said no.
- **Don't add** multi-tenant *firms* (where one tenant owns many CPAs). The CPA *is* the firm in V1. The super admin is the platform operator, not a "firm admin."
- **Don't add** UI for promoting users to SUPER_ADMIN. The promotion is a DB / scripted operation only — see `scripts/promote-admin.ts`.
- **Don't change** `User.role` (only ADD `SUPER_ADMIN` to the enum), `CpaClient`, `getCurrentUserId()`, or the cookie-based impersonation. They work; build on them.
- **Don't allow stealth admin actions.** Every audit event during admin impersonation has `actorAdminUserId` populated. There is no codepath that bypasses this.
- **Honor the principles in `CLAUDE.md`** — every redesigned surface is a new opportunity to violate "silence is a bug", "deductions travel as triples", "Cohan is a rescue not a strategy". Re-read principle 1 through 10 before shipping.
- **Mobile is read-only.** Any breakpoint <768px shows a "TaxLens is desktop-first; you can read but not edit on mobile" banner. Don't waste cycles building mobile interactions.
- **Accessibility:** every interactive element keyboard-reachable. ARIA labels on every status pill. Color is never the only signal (always a code letter or icon too).
- **i18n:** US-English only in V1. No translation infrastructure.
- **Do not** modify the auth flow (`auth.ts`, `proxy.ts`) without an explicit ask. NextAuth v5 beta is finicky. The role guards live at the layout / page level, not in middleware.

---

## 9. What "done" looks like (the deliverable from the design agent)

A single PR against `main` that:

1. Adds new pages under `app/(admin)/admin/...`, `app/(app)/workspace/...`, and `app/(app)/clients/[clientId]/...` implementing §3 IA, §4 surfaces, §5 visuals. The admin section uses its own route group `(admin)` with its own layout.
2. Keeps the old `app/(app)/years/[year]/...` paths as 301-redirect shims that resolve `clientId` from cookie context.
3. Replaces `app/(app)/layout.tsx` and `app/(cpa)/layout.tsx` with a unified CPA shell at `app/(app)/layout.tsx` that renders the §3 CPA navigation; the `(cpa)` route group is folded into `(app)`. Adds `app/(admin)/layout.tsx` for the admin shell.
4. Adds the `Documents` page wired to the new `Document` model.
5. Adds the Audit Trail page reading from `AuditEvent.actorCpaUserId` and `actorAdminUserId`.
6. Updates `lib/cpa/clientContext.ts` with `getCurrentCpaContext()` and `getRecentClients()`. Adds `lib/admin/adminContext.ts` with `getCurrentAdminContext()`, `enterCpaSession()`, `exitCpaSession()`, and admin-only listing helpers.
7. Adds `scripts/promote-admin.ts` for one-time super admin seeding.
8. Tests: every new page has a smoke test that asserts it renders for the appropriate role, and a triple-impersonation integration test asserts AuditEvent fields are populated correctly.
9. README update under `design-brief/redesign-cpa-2026-implementation.md` describing what landed, including any deviations from this brief.
10. All assertions A01–A13, all 246 existing tests, the 19 tier-1 tests, and the 4 redesign-prep tests still pass.
11. `pnpm build` clean.

---

## 10. Cost / scope estimate

Best-guess upper bound for the design agent: **11–15 sessions of 2–3 hours each.**

- 1 session: route restructuring + 301 shims + role-guard rewrites for three tiers
- 2 sessions: CPA navigation shell + ⌘K + sidebar refactor
- 1 session: admin navigation shell + stacked impersonation banner
- 2 sessions: `/admin` + `/admin/cpas` + `/admin/cpas/new` + admin-impersonation flow
- 1 session: `/admin/audit` + `/admin/settings`
- 1 session: `/workspace` + `/workspace/inbox`
- 1 session: redesigned `/clients` + `/clients/[id]`
- 2 sessions: `/clients/[id]/documents` + `Document` model wiring + receipt-to-transaction linking
- 1 session: per-year sidebar refactor + audit-trail page (with admin/CPA actor distinction)
- 1 session: visual polish, type scale, status pills, dark mode parity
- 1 session: tests (triple impersonation), accessibility, performance budget
- 1 session: bugfix and migration of any existing data

If the agent finds a more compact path, take it. If a session would exceed 3h, *stop* and write a new brief; the user prefers many small visible changes to one giant invisible one.

---

## 11. Out-of-scope — explicitly do not build

- No "AI assistant" inside the chrome. The Anthropic agents are pipeline-only, not chat.
- No mobile-first / mobile editing — read-only banner is enough.
- No payment / billing UI.
- No client portal sharing UI ("share with my client") — defer to V2.
- No external integrations (Plaid, Stripe Sync, QBO sync).
- No multi-language.
- No firm-level multi-CPA access ("Sarah and I share Atif"). Each CPA is a solo tenant in V1.
- No multi-admin co-management UI — admins all share the same `/admin/*` surface; we don't separate admin teams.
- No "approve before merge" workflow on admin actions. Admin can act unilaterally, but every action is logged.
- No OCR for receipts (yet — the Haiku PDF path covers statements; receipts come later).
- No automated reminders / email scheduling.
- No SSO / SCIM provisioning for CPAs in V1. Email + temp password only. SSO is V2.

---

## 12. Risk register

| Risk | Mitigation |
|---|---|
| Breaking old bookmarks / audit-packet links | Keep `/years/[year]/...` as 301 redirect shims using cookie ctx. |
| Performance regression on 500-row ledger after restructure | TanStack virtualization is already in place; redesign reuses the same ledger component. |
| Cookie ctx + new route prefix interact weirdly on first load | Add a "first load" middleware (`proxy.ts`) that, if the CPA hits `/dashboard` without a cookie, sends them to `/workspace`. |
| CPA accidentally locks the wrong client | Lock confirmation modal already exists; reinforce with client name in big bold text in the modal. |
| Document upload bypasses the existing rate-limit / virus-scan path | Document uploads use the same `uploadDir` storage helper and a similar parse pipeline (skipping the parser dispatch). |
| Solo-client experience regressed | Acceptance criterion: solo Atif login renders identically to a CPA-impersonating-Atif login. CI should run both. |
| Admin impersonation forgotten (admin walks away from desk) | Admin context cookie expires after 8h max. Top-bar banner is sticky and always visible. Optional: idle-timeout that drops admin context after 30 min of inactivity. |
| Admin makes a destructive change to CPA's client and CPA can't tell | Audit-trail view (per client+year) shows `actorAdminUserId` events with a distinct badge. Optional V2: notify CPA via 🔔 when their client data is touched by an admin. |
| Admin promotes themselves stealthily | Promotion is DB-only (`scripts/promote-admin.ts`); no UI path. Audit trail entry on promote. Detect via cross-firm audit log. |
| Suspended CPA's clients orphaned | `isActive=false` doesn't delete data. Clients of a suspended CPA can still log in directly; admin can re-assign clients to another CPA in V2. |

---

**End of brief. Read it twice. Build the smallest plausible thing first. Ship in slices.**
