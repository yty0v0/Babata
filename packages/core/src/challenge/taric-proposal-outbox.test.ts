import { afterEach, describe, expect, mock, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { HostBridgeError } from "./host-bridge-types"
import { TaricProposalOutbox, type TaricProposalOutboxEntry } from "./taric-proposal-outbox"
import type { NormalizedTaricProposal } from "./taric-proposal-schema"

const tempDirs: string[] = []

afterEach(async () => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop()
        if (!dir) continue
        await rm(dir, { recursive: true, force: true })
    }
})

const proposal: NormalizedTaricProposal = {
    kind: "claim",
    subject_type: "claim",
    expected_version: 0,
    content: {
        proposition: "/admin is reachable",
        status: "proposed",
        evidence_refs: ["5eee9386-a285-70b9-8ce5-995fafcc348c"],
        limitations: ["single identity"],
    },
}

function baseEntry(idempotencyKey: string): Omit<TaricProposalOutboxEntry, "status" | "retry_count" | "created_at" | "updated_at"> {
    return {
        idempotency_key: idempotencyKey,
        challenge_id: "web-001",
        engagement_id: "engagement-1",
        solver_id: "solver-a",
        role: "executor",
        proposal,
    }
}

async function createOutbox(): Promise<TaricProposalOutbox> {
    const dir = await mkdtemp(join(tmpdir(), "taric-proposal-outbox-"))
    tempDirs.push(dir)
    return new TaricProposalOutbox({ rootDir: dir })
}

describe("Taric proposal outbox", () => {
    test("enqueues proposal-only entries with stable idempotency key", async () => {
        const outbox = await createOutbox()
        const entry = await outbox.enqueue(baseEntry("proposal-1"))
        expect(entry).toMatchObject({ status: "pending", retry_count: 0 })
        await expect(outbox.enqueue(baseEntry("proposal-1"))).rejects.toThrow(HostBridgeError)
    })

    test("replays pending proposals and acknowledges idempotency conflicts as success", async () => {
        const outbox = await createOutbox()
        await outbox.enqueue(baseEntry("proposal-1"))
        const dispatcher = mock(async () => ({ ok: true, data: { id: "proposal-1" } }))
        const result = await outbox.replay(dispatcher)
        expect(result).toEqual({ applied: 1, skipped: 0, failed: 0 })
        expect(await outbox.get("proposal-1")).toMatchObject({ status: "acknowledged" })
        expect(dispatcher).toHaveBeenCalledTimes(1)
    })

    test("retries failures and preserves last error", async () => {
        const outbox = await createOutbox()
        await outbox.enqueue(baseEntry("proposal-1"))
        const dispatcher = mock(async () => ({ ok: false, error: { code: "unavailable_host", message: "Taric unavailable" } }))
        const result = await outbox.replay(dispatcher)
        expect(result).toEqual({ applied: 0, skipped: 0, failed: 1 })
        expect(await outbox.get("proposal-1")).toMatchObject({
            status: "failed",
            retry_count: 1,
            last_error: "Taric unavailable",
        })
    })

    test("treats a Taric-rejected proposal as failure instead of acknowledgement", async () => {
        const outbox = await createOutbox()
        await outbox.enqueue(baseEntry("proposal-1"))
        const dispatcher = mock(async () => ({ ok: true, data: { id: "proposal-1", status: "rejected" } }))
        const result = await outbox.replay(dispatcher)
        expect(result).toEqual({ applied: 0, skipped: 0, failed: 1 })
        expect(await outbox.get("proposal-1")).toMatchObject({
            status: "failed",
            retry_count: 1,
        })
        expect((await outbox.get("proposal-1"))?.taric_proposal_id).toBeUndefined()
    })

    test("marks rolled back entries so they are not replayed", async () => {
        const outbox = await createOutbox()
        await outbox.enqueue(baseEntry("proposal-1"))
        await outbox.markRolledBack("proposal-1")
        const dispatcher = mock(async () => ({ ok: true }))
        const result = await outbox.replay(dispatcher)
        expect(result).toEqual({ applied: 0, skipped: 0, failed: 0 })
        expect(dispatcher).not.toHaveBeenCalled()
        expect(await outbox.get("proposal-1")).toMatchObject({ status: "rolled_back" })
    })

    test("rewrites buffered proposal payloads but not submitted entries", async () => {
        const outbox = await createOutbox()
        await outbox.enqueue(baseEntry("proposal-1"))
        const rewritten = await outbox.updateProposal("proposal-1", {
            ...proposal,
            content: { ...proposal.content, proposition: "/admin is reachable with admin:admin" },
        })
        expect(rewritten?.proposal.content.proposition).toBe("/admin is reachable with admin:admin")

        await outbox.replay(mock(async () => ({ ok: true, data: { id: "proposal-1" } })))
        await expect(outbox.updateProposal("proposal-1", proposal)).rejects.toThrow(HostBridgeError)
    })

    test("replays only the requested idempotency keys", async () => {
        const outbox = await createOutbox()
        await outbox.enqueue(baseEntry("proposal-1"))
        await outbox.enqueue(baseEntry("proposal-2"))
        const dispatcher = mock(async () => ({ ok: true, data: { id: "proposal-1" } }))
        const result = await outbox.replay(dispatcher, { idempotencyKeys: ["proposal-1"] })
        expect(result).toEqual({ applied: 1, skipped: 0, failed: 0 })
        expect(dispatcher).toHaveBeenCalledTimes(1)
        expect((await outbox.get("proposal-2"))?.status).toBe("pending")
    })
})
