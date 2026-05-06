"use client"

import { useTransition } from "react"
import { Btn } from "@/components/v2/primitives"
import { enterClientSession } from "@/lib/cpa/actions"

export function EnterClientButton({ clientId }: { clientId: string }) {
  const [pending, start] = useTransition()
  return (
    <Btn
      kind="primary"
      onClick={() => start(() => enterClientSession(clientId))}
      disabled={pending}
    >
      {pending ? "Entering…" : "Enter workspace →"}
    </Btn>
  )
}
