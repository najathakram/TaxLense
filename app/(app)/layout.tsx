import { requireAuth, getCurrentUserId } from "@/lib/auth"
import { getClientContext, getCurrentCpaContext } from "@/lib/cpa/clientContext"
import { exitClientSession } from "@/lib/cpa/actions"
import { getCurrentAdminContext, getAdminCpaContext } from "@/lib/admin/adminContext"
import { exitCpaSession } from "@/lib/admin/actions"
import { prisma } from "@/lib/db"
import { TopBar, Sidebar, type SidebarGroup, type SidebarItem } from "@/components/v2/shell"
import { Banner } from "@/components/v2/primitives"
import { signOut } from "@/auth"
import Link from "next/link"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuth()
  const [clientCtx, cpaCtx, adminCtx, adminCpaCtx] = await Promise.all([
    getClientContext(),
    getCurrentCpaContext(),
    getCurrentAdminContext(),
    getAdminCpaContext(),
  ])
  const userId = await getCurrentUserId()

  // Pull "active client" + "active year" — when a CPA (or admin-as-CPA) is
  // working in a client workspace, we use the deepest context (clientId).
  // Otherwise it's the user's own data.
  const activeClient = clientCtx
    ? { id: clientCtx.clientId, name: clientCtx.clientName, email: clientCtx.clientEmail }
    : null

  // Year selector — most recent year for the active user.
  const activeYear = await prisma.taxYear.findFirst({
    where: { userId },
    orderBy: { year: "desc" },
    select: { year: true, status: true },
  })

  const tier = adminCtx ? "ADMIN" : cpaCtx ? "CPA" : "CLIENT"
  const userName = session.user?.name ?? session.user?.email ?? "User"
  const userEmail = session.user?.email ?? ""

  // CPA's clients (for sidebar quick-pick)
  const cpaUserId = adminCpaCtx?.cpaId ?? cpaCtx?.cpaId ?? null
  const myClients = cpaUserId
    ? await prisma.cpaClient.findMany({
        where: { cpaUserId },
        select: {
          clientUserId: true,
          displayName: true,
          client: { select: { id: true, name: true, email: true } },
        },
        take: 6,
        orderBy: { createdAt: "desc" },
      })
    : []

  // Pending stops on active client + year (used as a sidebar badge)
  const pendingStopsCount = activeYear
    ? await prisma.stopItem.count({
        where: { taxYear: { userId, year: activeYear.year }, state: "PENDING" },
      })
    : 0

  // Build sidebar groups depending on tier
  const groups: SidebarGroup[] = []

  if (tier === "ADMIN" && !adminCpaCtx) {
    // Pure admin view (not impersonating)
    groups.push({
      label: "Admin",
      items: [
        { label: "Dashboard", href: "/admin", accent: "var(--tl-purple)" },
        { label: "CPAs",      href: "/admin/cpas", accent: "var(--tl-purple)" },
        { label: "Audit log", href: "/admin/audit", accent: "var(--tl-purple)" },
        { label: "Settings",  href: "/admin/settings", accent: "var(--tl-purple)" },
      ],
    })
  } else {
    // CPA-tier or admin-impersonating-CPA — show the CPA workspace
    groups.push({
      label: "Workspace",
      items: [
        { label: "Inbox",         href: "/workspace", accent: "var(--tl-accent)" },
        { label: "Firm overview", href: "/workspace/firm", accent: "var(--tl-accent)" },
        { label: "Calendar",      href: "/workspace/calendar", accent: "var(--tl-accent)" },
      ],
    })

    if (myClients.length > 0 || cpaUserId) {
      const clientItems: SidebarItem[] = [
        { label: "All clients", href: "/clients" },
        ...myClients.map((c) => ({
          label: c.displayName ?? c.client.name ?? c.client.email,
          href: `/clients/${c.client.id}`,
        })),
      ]
      groups.push({ label: `Clients · ${myClients.length}`, items: clientItems })
    }

    if (activeClient && activeYear) {
      const yearBase = `/years/${activeYear.year}`
      // Stage-grouped year items (Ingest / Process / Review / Deliver)
      const stages: Array<{ label: string; items: SidebarItem[] }> = [
        {
          label: "INGEST",
          items: [
            { label: "Upload",   href: `${yearBase}/upload`,   indent: 1 },
            { label: "Coverage", href: `${yearBase}/coverage`, indent: 1 },
          ],
        },
        {
          label: "PROCESS",
          items: [
            { label: "Pipeline", href: `${yearBase}/pipeline`, indent: 1 },
            {
              label: "STOPs",
              href: `${yearBase}/stops`,
              indent: 1,
              ...(pendingStopsCount > 0
                ? { badge: { text: pendingStopsCount, color: "var(--tl-amber)", bg: "rgba(244,196,81,0.14)" } }
                : {}),
            },
          ],
        },
        {
          label: "REVIEW",
          items: [
            { label: "Ledger",    href: `${yearBase}/ledger`,    indent: 1 },
            { label: "Risk",      href: `${yearBase}/risk`,      indent: 1 },
            { label: "Analytics", href: `${yearBase}/analytics`, indent: 1 },
          ],
        },
        {
          label: "DELIVER",
          items: [
            { label: "Lock",     href: `${yearBase}/lock`,     indent: 1 },
            { label: "Download", href: `${yearBase}/download`, indent: 1 },
          ],
        },
      ]

      groups.push({
        label: `${activeClient.name.split(" ")[0]} / ${activeYear.year}`,
        items: [
          { label: "Year overview", href: yearBase },
          { label: "Documents",     href: `/clients/${activeClient.id}/documents` },
        ],
      })

      // Append each stage as a separate "group" with its own header
      for (const s of stages) {
        groups.push({ label: s.label, items: s.items })
      }
    } else if (activeClient) {
      groups.push({
        label: activeClient.name,
        items: [{ label: "Pick a year to expand →", href: `/clients/${activeClient.id}`, accent: "var(--fg-3)" }],
      })
    }
  }

  return (
    <div className="flex flex-col" style={{ minHeight: "100vh" }}>
      <TopBar
        userName={userName}
        userEmail={userEmail}
        tier={tier as "ADMIN" | "CPA" | "CLIENT"}
        impersonatingCpa={!!adminCpaCtx}
        logoHref={adminCtx && !adminCpaCtx ? "/admin" : "/workspace"}
      />

      {/* Stacked impersonation banners: admin row above CPA row */}
      {adminCpaCtx && (
        <Banner
          tone="admin"
          exitAction={exitCpaSession}
          exitLabel="Exit admin ✕"
        >
          <span style={{ color: "var(--fg-1)" }}>{adminCtx?.adminName ?? "Admin"}</span>
          <span style={{ margin: "0 8px", color: "var(--fg-3)" }}>→</span>
          <span style={{ fontWeight: 700 }}>acting as CPA · {adminCpaCtx.cpaName}</span>
        </Banner>
      )}
      {clientCtx && (
        <Banner
          tone="cpa"
          exitAction={exitClientSession}
          exitLabel="Exit client ✕"
        >
          {cpaCtx && (
            <>
              <span style={{ fontWeight: 700 }}>{cpaCtx.cpaName}</span>
              <span style={{ margin: "0 6px", color: "var(--fg-3)" }}>on behalf of</span>
            </>
          )}
          <span style={{ fontWeight: 700 }}>{clientCtx.clientName}</span>
          <span style={{ margin: "0 6px", color: "var(--fg-3)" }}>·</span>
          <span style={{ color: "var(--fg-2)" }}>{clientCtx.clientEmail}</span>
        </Banner>
      )}

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <Sidebar
          groups={groups}
          footerEmail={userEmail}
          signOutAction={async () => {
            "use server"
            await signOut({ redirectTo: "/login" })
          }}
        />
        <main style={{ flex: 1, minWidth: 0, overflow: "auto", display: "flex", flexDirection: "column" }}>
          {/* Optional context bar (client + year breadcrumb) */}
          {activeClient && activeYear && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 28px",
                borderBottom: "1px solid var(--hairline)",
                background: "rgba(11,13,18,0.4)",
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
              }}
            >
              <Link
                href={`/clients/${activeClient.id}`}
                className="glass"
                style={{ padding: "4px 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, textDecoration: "none", color: "inherit" }}
              >
                {activeClient.name} ▾
              </Link>
              <span style={{ color: "var(--fg-3)" }}>›</span>
              <Link
                href={`/years/${activeYear.year}`}
                className="glass"
                style={{ padding: "4px 14px", borderRadius: 999, fontWeight: 700, fontSize: 13, fontFamily: "var(--mono)", textDecoration: "none", color: "inherit" }}
              >
                {activeYear.year} ▾
              </Link>
              <span
                className="tl-pill"
                style={{
                  background: "rgba(122,166,255,0.16)",
                  color: "var(--tl-blue)",
                  border: "1px solid rgba(122,166,255,0.32)",
                }}
              >
                {activeYear.status}
              </span>
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
        </main>
      </div>
    </div>
  )
}
