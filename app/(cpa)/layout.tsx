import { requireAuth } from "@/lib/auth"
import Link from "next/link"
import { signOut } from "@/auth"
import { Button } from "@/components/ui/button"

export default async function CpaLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuth()

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="w-56 border-r flex flex-col bg-card">
        <div className="p-4 border-b">
          <span className="font-bold text-lg text-foreground">TaxLens</span>
          <span className="ml-2 text-xs font-medium bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">CPA</span>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          <Link
            href="/clients"
            className="flex items-center px-3 py-2 rounded-md text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            My Clients
          </Link>
          <Link
            href="/clients/new"
            className="flex items-center px-3 py-2 rounded-md text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            + Add Client
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
      <main className="flex-1 flex flex-col min-w-0">{children}</main>
    </div>
  )
}
