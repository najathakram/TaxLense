import { requireAuth, getCurrentUserId } from "@/lib/auth"
import { getClientContext, getCurrentCpaContext } from "@/lib/cpa/clientContext"
import { exitClientSession } from "@/lib/cpa/actions"
import { prisma } from "@/lib/db"
import Link from "next/link"
import { signOut } from "@/auth"
import { Button } from "@/components/ui/button"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuth()
  const [clientCtx, cpaCtx] = await Promise.all([
    getClientContext(),
    getCurrentCpaContext(),
  ])
  const userId = await getCurrentUserId()
  const activeYear = await prisma.taxYear.findFirst({
    where: { userId },
    orderBy: { year: "desc" },
    select: { year: true, status: true },
  })

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-56 border-r flex flex-col bg-card">
        <div className="p-4 border-b">
          <span className="font-bold text-lg text-foreground">TaxLens</span>
          {cpaCtx && (
            <span
              className="ml-2 text-[10px] font-medium bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded"
              title={`Logged in as ${cpaCtx.cpaName} (${cpaCtx.cpaEmail})`}
            >
              CPA
            </span>
          )}
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {clientCtx && (
            <Link
              href="/clients"
              className="flex items-center px-3 py-2 rounded-md text-sm font-medium text-blue-600 hover:bg-accent transition-colors"
              onClick={undefined}
            >
              ← All Clients
            </Link>
          )}
          <Link
            href="/dashboard"
            className="flex items-center px-3 py-2 rounded-md text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            Dashboard
          </Link>
          <Link
            href="/onboarding"
            className="flex items-center px-3 py-2 rounded-md text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            Profile Wizard
          </Link>
          <Link
            href="/profile"
            className="flex items-center px-3 py-2 rounded-md text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            Business Profile
          </Link>
          {activeYear && (
            <div className="pt-3 mt-3 border-t space-y-1">
              <Link
                href={`/years/${activeYear.year}`}
                className="flex items-center justify-between px-3 py-2 rounded-md text-sm font-semibold text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <span>Tax Year {activeYear.year}</span>
                <span className="text-[10px] text-muted-foreground">{activeYear.status}</span>
              </Link>
              {[
                { href: `/years/${activeYear.year}/upload`, label: "Upload Statements" },
                { href: `/years/${activeYear.year}/coverage`, label: "Coverage" },
                { href: `/years/${activeYear.year}/pipeline`, label: "Pipeline" },
                { href: `/years/${activeYear.year}/stops`, label: "Stops" },
                { href: `/years/${activeYear.year}/ledger`, label: "Ledger" },
                { href: `/years/${activeYear.year}/risk`, label: "Risk" },
                { href: `/years/${activeYear.year}/analytics`, label: "Analytics" },
                { href: `/years/${activeYear.year}/lock`, label: "Lock" },
                { href: `/years/${activeYear.year}/download`, label: "Download" },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center pl-6 pr-3 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </nav>
        <div className="p-3 border-t">
          <p className="text-xs text-muted-foreground truncate mb-2">{session.user?.email}</p>
          <form
            action={async () => {
              "use server"
              await signOut({ redirectTo: "/login" })
            }}
          >
            <Button variant="ghost" size="sm" type="submit" className="w-full justify-start">
              Sign out
            </Button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Client context banner */}
        {clientCtx && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between text-sm shrink-0">
            <span className="text-amber-900">
              {cpaCtx && (
                <span className="text-amber-700 mr-1">
                  {cpaCtx.cpaName} on behalf of
                </span>
              )}
              <strong>{clientCtx.clientName}</strong>
              <span className="text-amber-700 ml-2 font-normal">({clientCtx.clientEmail})</span>
            </span>
            <form action={exitClientSession}>
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="h-7 text-amber-800 hover:bg-amber-100 hover:text-amber-900"
              >
                Exit client workspace →
              </Button>
            </form>
          </div>
        )}
        <main className="flex-1 flex flex-col min-w-0">{children}</main>
      </div>
    </div>
  )
}
