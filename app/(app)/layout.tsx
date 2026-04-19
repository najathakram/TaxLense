import { requireAuth } from "@/lib/auth"
import { getClientContext } from "@/lib/cpa/clientContext"
import { exitClientSession } from "@/lib/cpa/actions"
import Link from "next/link"
import { signOut } from "@/auth"
import { Button } from "@/components/ui/button"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuth()
  const clientCtx = await getClientContext()

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-56 border-r flex flex-col bg-card">
        <div className="p-4 border-b">
          <span className="font-bold text-lg text-foreground">TaxLens</span>
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
              Working on: <strong>{clientCtx.clientName}</strong>
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
