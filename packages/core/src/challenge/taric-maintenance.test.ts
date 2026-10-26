import { describe, expect, mock, test } from "bun:test"
import { HostBridgeError } from "./host-bridge-types"
import { TaricMaintenance } from "./taric-maintenance"

describe("Taric maintenance", () => {
    test("does not replay when the outbox is already drained", async () => {
        const dispatcher = mock(async (_input: { operation: string; request: Record<string, unknown>; engagementId?: string }) => ({
            ok: true,
            data: { pending_outbox: 0, watermarks: { committed_seq: 84, projected_seq: 84 } },
        }))
        const maintenance = new TaricMaintenance({ dispatcher })
        const result = await maintenance.reconcile("engagement-1")
        expect(result).toEqual({ applied: 0, committedSeq: 84, projectedSeq: 84, pendingOutbox: 0 })
        expect(dispatcher).toHaveBeenCalledTimes(1)
        expect(dispatcher.mock.calls[0]?.[0]).toMatchObject({
            operation: "audit.reconcile",
            engagementId: "engagement-1",
            request: { engagement_id: "engagement-1", action: "preview" },
        })
    })

    test("replays pending outbox entries once and returns the new watermarks", async () => {
        const dispatcher = mock(async (input: { request: Record<string, unknown> }) => {
            if (input.request.action === "preview") {
                return { ok: true, data: { pending_outbox: 3, watermarks: { committed_seq: 10, projected_seq: 7 } } }
            }
            return { ok: true, data: { applied: 3, doctor: { pending_outbox: 0, watermarks: { committed_seq: 10, projected_seq: 10 } } } }
        })
        const maintenance = new TaricMaintenance({ dispatcher })
        const result = await maintenance.reconcile("engagement-1")
        expect(result).toEqual({ applied: 3, committedSeq: 10, projectedSeq: 10, pendingOutbox: 0 })
        expect(dispatcher).toHaveBeenCalledTimes(2)
        expect(dispatcher.mock.calls[1]?.[0]).toMatchObject({ request: { action: "replay" } })
    })

    test("surfaces audit.doctor watermarks", async () => {
        const dispatcher = mock(async () => ({
            ok: true,
            data: { pending_outbox: 0, watermarks: { committed_seq: 5, projected_seq: 5 } },
        }))
        const maintenance = new TaricMaintenance({ dispatcher })
        await expect(maintenance.doctor("engagement-1")).resolves.toEqual({
            committedSeq: 5,
            projectedSeq: 5,
            pendingOutbox: 0,
        })
    })

    test("fails closed when Taric is unavailable", async () => {
        const maintenance = new TaricMaintenance({
            dispatcher: mock(async () => ({ ok: false, error: { code: "unavailable_host", message: "docker unavailable" } })),
        })
        let caught: unknown
        try {
            await maintenance.reconcile("engagement-1")
        } catch (error) {
            caught = error
        }
        expect(caught).toBeInstanceOf(HostBridgeError)
        expect((caught as HostBridgeError).code).toBe("unavailable")
    })
})
