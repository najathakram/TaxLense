/**
 * writeAuditEvent — auto-derives actorCpaUserId from cookie context.
 * Pure unit test with mocked prisma + getClientContext.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.hoisted runs BEFORE vi.mock factories (which are themselves hoisted),
// so the spies survive the hoisting and remain referenceable in tests.
const { auditCreate, getCtxMock } = vi.hoisted(() => ({
  auditCreate: vi.fn().mockResolvedValue({ id: "ae_1" }),
  getCtxMock: vi.fn(),
}))

vi.mock("../lib/db", () => ({
  prisma: { auditEvent: { create: auditCreate } },
}))

vi.mock("../lib/cpa/clientContext", () => ({
  getClientContext: () => getCtxMock(),
  getCurrentCpaContext: vi.fn(),
  getRecentClients: vi.fn(),
}))

import { writeAuditEvent } from "../lib/audit"

beforeEach(() => {
  auditCreate.mockClear()
  getCtxMock.mockReset()
})

describe("writeAuditEvent", () => {
  it("populates actorCpaUserId from cookie context when CPA is impersonating", async () => {
    getCtxMock.mockResolvedValue({
      cpaId: "cpa_1",
      clientId: "client_1",
      clientName: "Atif",
      clientEmail: "atif@example.com",
    })

    await writeAuditEvent({
      userId: "client_1",
      actorType: "USER",
      eventType: "STOP_RESOLVED",
      entityType: "StopItem",
      entityId: "stop_1",
    })

    expect(auditCreate).toHaveBeenCalledOnce()
    const call = auditCreate.mock.calls[0]![0]
    expect(call.data.userId).toBe("client_1")
    expect(call.data.actorCpaUserId).toBe("cpa_1")
    expect(call.data.eventType).toBe("STOP_RESOLVED")
  })

  it("leaves actorCpaUserId null when no client context (solo client login)", async () => {
    getCtxMock.mockResolvedValue(null)

    await writeAuditEvent({
      userId: "client_1",
      actorType: "USER",
      eventType: "PROFILE_EDITED",
      entityType: "BusinessProfile",
    })

    const call = auditCreate.mock.calls[0]![0]
    expect(call.data.actorCpaUserId).toBeNull()
  })

  it("respects explicit actorCpaUserId override (skips context lookup)", async () => {
    // Explicit override case — useful for system jobs that know the CPA already.
    await writeAuditEvent({
      userId: "client_1",
      actorType: "AI",
      eventType: "MERCHANT_AI_RUN_COMPLETE",
      entityType: "MerchantRule",
      actorCpaUserId: "cpa_explicit",
    })

    expect(getCtxMock).not.toHaveBeenCalled()
    const call = auditCreate.mock.calls[0]![0]
    expect(call.data.actorCpaUserId).toBe("cpa_explicit")
  })

  it("omits json fields when not provided (does not write null literal)", async () => {
    getCtxMock.mockResolvedValue(null)

    await writeAuditEvent({
      actorType: "SYSTEM",
      eventType: "REPORT_GENERATED",
      entityType: "Report",
    })

    const call = auditCreate.mock.calls[0]![0]
    expect(call.data.beforeState).toBeUndefined()
    expect(call.data.afterState).toBeUndefined()
  })
})
