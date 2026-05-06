import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { prisma } from "@/lib/db"
import Link from "next/link"

export default async function Home() {
  const session = await getSession()

  if (session?.user?.id) {
    // Route by role: admin → /admin, CPA → /workspace, CLIENT → /dashboard.
    const me = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    })
    if (me?.role === "SUPER_ADMIN") redirect("/admin")
    if (me?.role === "CPA") redirect("/workspace")
    redirect("/dashboard")
  }

  return (
    <main
      style={{
        display: "flex",
        minHeight: "100vh",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
      }}
    >
      <div style={{ maxWidth: 560, textAlign: "center", display: "flex", flexDirection: "column", gap: 22 }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 16,
            margin: "0 auto",
            background: "linear-gradient(135deg, #7aa6ff 0%, #c39bff 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
            color: "#0a1428",
            fontSize: 28,
            boxShadow: "0 8px 32px rgba(122,166,255,0.4), inset 0 1px 0 rgba(255,255,255,0.4)",
          }}
        >
          T
        </div>
        <h1 style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1, margin: 0 }}>TaxLens</h1>
        <p style={{ fontSize: 16, color: "var(--fg-2)", lineHeight: 1.6, margin: 0 }}>
          AI-first Schedule C bookkeeping for self-employed professionals and the CPAs who serve them.
          Upload statements, classify every transaction, lock the year — every deduction backed by an
          IRC citation.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 6 }}>
          <Link
            href="/login"
            style={{
              padding: "10px 22px",
              borderRadius: 999,
              fontSize: 14,
              fontWeight: 600,
              color: "#0a1428",
              background: "linear-gradient(180deg, #8fb6ff 0%, #6f9bff 100%)",
              boxShadow: "0 4px 12px rgba(122,166,255,0.35), inset 0 1px 0 rgba(255,255,255,0.4)",
              textDecoration: "none",
            }}
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            style={{
              padding: "10px 22px",
              borderRadius: 999,
              fontSize: 14,
              fontWeight: 600,
              color: "var(--fg)",
              background: "rgba(255,255,255,0.08)",
              border: "1px solid var(--hairline)",
              textDecoration: "none",
            }}
          >
            Create account
          </Link>
        </div>
      </div>
    </main>
  )
}
