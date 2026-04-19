"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import type { ReportKind } from "@/app/generated/prisma/client"

interface Props {
  year: number
  kind: ReportKind
  filename: string
  disabled: boolean
}

export function DownloadClient({ year, kind, filename, disabled }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDownload() {
    setLoading(true)
    setError(null)
    try {
      const kindParam = kind.toLowerCase().replace(/_/g, "-")
      const res = await fetch(`/api/years/${year}/download/${kindParam}`)
      if (!res.ok) {
        const msg = await res.text()
        throw new Error(msg || `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-1">
      <Button
        onClick={handleDownload}
        disabled={disabled || loading}
        size="sm"
        variant={disabled ? "outline" : "default"}
      >
        {loading ? "Generating…" : disabled ? "Locked required" : "Generate & Download"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
