"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Link from "next/link"

export default function NewClientPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ name: string; email: string; password: string } | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const fd = new FormData(e.currentTarget)
    const res = await fetch("/api/cpa/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fd.get("name") as string,
        email: fd.get("email") as string,
        displayName: (fd.get("displayName") as string) || undefined,
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? "Failed to create client")
      setLoading(false)
      return
    }

    setCreated(data)
    setLoading(false)
  }

  if (created) {
    return (
      <div className="p-6 max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle>Client created</CardTitle>
            <CardDescription>Share these credentials with your client.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md bg-muted p-4 text-sm space-y-2 font-mono">
              <p><span className="text-muted-foreground">Name:</span> {created.name}</p>
              <p><span className="text-muted-foreground">Email:</span> {created.email}</p>
              <p><span className="text-muted-foreground">Temp password:</span> {created.password}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              The client should change their password after first login.
            </p>
            <Button asChild className="w-full">
              <Link href="/clients">Back to My Clients</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-lg">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Add Client</h1>
        <p className="text-muted-foreground">Create a TaxLens account for your client.</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Client full name</Label>
              <Input id="name" name="name" placeholder="Jane Smith" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Client email</Label>
              <Input id="email" name="email" type="email" placeholder="jane@example.com" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="displayName">
                Display name <span className="text-muted-foreground">(optional — shown in your client list)</span>
              </Label>
              <Input id="displayName" name="displayName" placeholder="Smith Photography LLC" />
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <div className="flex gap-3 pt-2">
              <Button type="submit" className="flex-1" disabled={loading}>
                {loading ? "Creating…" : "Create client account"}
              </Button>
              <Button variant="outline" asChild>
                <Link href="/clients">Cancel</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
