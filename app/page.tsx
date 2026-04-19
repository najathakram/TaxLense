import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import Link from "next/link"
import { Button } from "@/components/ui/button"

export default async function Home() {
  const session = await getSession()

  if (session?.user) {
    redirect("/dashboard")
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-8">
      <div className="max-w-xl text-center space-y-6">
        <h1 className="text-4xl font-bold tracking-tight text-foreground">TaxLens</h1>
        <p className="text-lg text-muted-foreground">
          AI-first Schedule C bookkeeping for self-employed professionals.
          Upload your bank statements, let the AI classify every transaction,
          and export a locked ledger with every deduction backed by an IRC citation.
        </p>
        <div className="flex gap-4 justify-center">
          <Button asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/signup">Create account</Link>
          </Button>
        </div>
      </div>
    </main>
  )
}
