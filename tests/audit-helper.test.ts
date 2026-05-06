/**
 * writeAuditEvent — auto-derives actorCpaUserId AND actorAdminUserId from
 * cookie context. Pure unit test with mocked prisma + context modules.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.hoisted runs BEFORE vi.mock factories (which are themselves hoisted),
// so the spies survive the hoisting and remain referenceable in tests.
const { auditCreate, getCtxMock, getAdminCpaCtxMock } = vi.hoisted(() => ({
  auditCreate: vi.fn().mockResolvedValue({ id: "ae_1" }),
  getCtxMock: vi.fn(),
  getAdminCpaCtxMock: vi.fn(),
}))

vi.mock("../lib/db", () => ({
  prisma: { auditEvent: { create: auditCreate } },
}))

vi.mock("../lib/cpa/clientContext", () => ({
  getClientContext: () => getCtxMock(),
  getCurrentCpaContext: vi.fn(),
  getRecentClients: vi.fn(),
}))

vi.mock("../lib/admin/adminContext", () => ({
  getAdminCpaContext: () => getAdminCpaCtxMock(),
  getCurrentAdminContext: vi.fn(),
  listAllCpas: vi.fn(),
}))

import { writeAuditEvent } from "../lib/audit"

beforeEach(() => {
  auditCreate.mockClear()
  getCtxMock.mockReset()
  getAdminCpaCtxMock.mockReset()
  // Default: no admin context
  getAdminCpaCtxMock.mockResolvedValue(null)
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

  it("populates BOTH actorAdminUserId and actorCpaUserId during admin → CPA impersonation", async () => {
    // Admin impersonating CPA but NOT a client — admin_ctx is set,
    // client_ctx is not. The CPA actor should still be filled from the
    // admin context, since admin actions running in CPA workspace are
    // attributed to that CPA.
    getAdminCpaCtxMock.mockResolvedValue({
      adminId: "admin_1",
      cpaId: "cpa_1",
      cpaName: "Najath",
      cpaEmail: "najath@example.com",
    })
    getCtxMock.mockResolvedValue(null)

    await writeAuditEvent({
      userId: "client_1",
      actorType: "USER",
      eventType: "STOP_RESOLVED",
      entityType: "StopItem",
    })

    const call = auditCreate.mock.calls[0]![0]
    expect(call.data.userId).toBe("client_1")
    expect(call.data.actorCpaUserId).toBe("cpa_1")
    expect(call.data.actorAdminUserId).toBe("admin_1")
  })

  it("admin → CPA → CLIENT triple-impersonation: client_ctx wins for CPA actor too", async () => {
    // Triple stack: admin is impersonating Najath (CPA), Najath has entered
    // Atif's (CLIENT) workspace. The CPA actor should be Najath (from
    // client_ctx), the admin actor should be the impersonating admin.
    getAdminCpaCtxMock.mockResolvedValue({
      adminId: "admin_1",
      cpaId: "cpa_1",
      cpaName: "Najath",
      cpaEmail: "najath@example.com",
    })
    getCtxMock.mockResolvedValue({
      cpaId: "cpa_1",
      clientId: "client_1",
      clientName: "Atif",
      clientEmail: "atif@example.com",
    })

    await writeAuditEvent({
      userId: "client_1",
      actorType: "USER",
      eventType: "LEDGER_EDIT",
      entityType: "Classification",
    })

    const call = auditCreate.mock.calls[0]![0]
    expect(call.data.userId).toBe("client_1")
    expect(call.data.actorCpaUserId).toBe("cpa_1")
    expect(call.data.actorAdminUserId).toBe("admin_1")
  })

  it("admin acting WITHOUT impersonating any CPA leaves both actor fields null", async () => {
    // Admin on /admin/cpas, no impersonation cookie set.
    getAdminCpaCtxMock.mockResolvedValue(null)
    getCtxMock.mockResolvedValue(null)

    await writeAuditEvent({
      actorType: "USER",
      eventType: "ADMIN_VIEWED_AUDIT_LOG",
      entityType: "AuditEvent",
      actorAdminUserId: "admin_1", // explicit override here is the right pattern
    })

    const call = auditCreate.mock.calls[0]![0]
    expect(call.data.actorAdminUserId).toBe("admin_1")
    expect(call.data.actorCpaUserId).toBeNull()
  })
})
