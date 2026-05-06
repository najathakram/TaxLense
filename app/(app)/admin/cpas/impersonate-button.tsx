"use client"

import { useTransition } from "react"
import { Btn } from "@/components/v2/primitives"
import { enterCpaSession } from "@/lib/admin/actions"

export function ImpersonateButton({ cpaId }: { cpaId: string }) {
  const [pending, start] = useTransition()
  return (
    <Btn
      size="sm"
      kind="purple"
      onClick={() => start(() => enterCpaSession(cpaId))}
      disabled={pending}
    >
      {pending ? "Entering…" : "Impersonate →"}
    </Btn>
  )
}
