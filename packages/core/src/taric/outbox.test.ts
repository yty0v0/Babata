import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { EncryptedTaricOutbox, TaricOutboxError, TaricSubscriptionRecovery } from "./outbox"

describe("encrypted Taric outbox", () => {
    test("stores encrypted append-only events and keeps duplicate event identity bound to the first payload", async () => {
        const dir = await mkdtemp(join(tmpdir(), "bw-taric-outbox-"))
        try {
            const path = join(dir, "events.jsonl")
            const outbox = new EncryptedTaricOutbox({ path, key: new Uint8Array(32).fill(7), maxEvents: 2 })
            const event = await outbox.append({ eventId: "event-1", projectId: "project-1", payload: { content: "secret observation" } })
            expect(event.status).toBe("pending")
            expect(await outbox.append({ eventId: "event-1", projectId: "project-1", payload: { content: "ignored" } })).toEqual(event)
            expect(await outbox.list()).toHaveLength(1)
            expect((await outbox.list())[0]?.payload).toEqual({ content: "secret observation" })
            await outbox.markReplayed("event-1", { accepted: true })
            expect((await outbox.list())[0]).toMatchObject({ eventId: "event-1", status: "replayed" })
            expect(await readFile(path, "utf8")).not.toContain("secret observation")
            await outbox.append({ eventId: "event-2", projectId: "project-1", payload: {} })
            await expect(outbox.append({ eventId: "event-3", projectId: "project-1", payload: {} })).rejects.toMatchObject({ code: "TARIC_OUTBOX_FULL" })
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    test("requires a host encryption key and rejects event rebinding", async () => {
        const dir = await mkdtemp(join(tmpdir(), "bw-taric-outbox-"))
        try {
            const path = join(dir, "events.jsonl")
            const missingKey = new EncryptedTaricOutbox({ path })
            await expect(missingKey.list()).rejects.toBeInstanceOf(TaricOutboxError)
            const outbox = new EncryptedTaricOutbox({ path, key: new Uint8Array(32).fill(1) })
            await outbox.append({ eventId: "event-1", projectId: "project-1", payload: {} })
            await expect(outbox.append({ eventId: "event-1", projectId: "project-2", payload: {} })).rejects.toMatchObject({ code: "TARIC_OUTBOX_CONFLICT" })
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    test("replays events in sequence, preserves results, and stops at a conflict", async () => {
        const dir = await mkdtemp(join(tmpdir(), "bw-taric-outbox-replay-"))
        try {
            const outbox = new EncryptedTaricOutbox({ path: join(dir, "events.jsonl"), key: new Uint8Array(32).fill(8) })
            await outbox.append({ eventId: "event-1", projectId: "project-1", payload: { n: 1 } })
            await outbox.append({ eventId: "event-2", projectId: "project-1", payload: { n: 2 } })
            await outbox.append({ eventId: "event-3", projectId: "project-1", payload: { n: 3 } })

            const calls: string[] = []
            let secondPass = false
            const first = await outbox.replayOrdered({
                projectId: "project-1",
                apply: async (event) => {
                    calls.push(event.eventId)
                    if (event.eventId === "event-2") throw Object.assign(new Error("stale version"), { code: "stale_version" })
                    return { result: { accepted: true, eventId: event.eventId }, readSeq: event.sequence }
                },
            })
            expect(first).toMatchObject({ replayed: 1, conflicts: 1, stopped: true, watermark: 1 })
            expect(calls).toEqual(["event-1", "event-2"])
            expect(await outbox.pending("project-1")).toHaveLength(1)

            const second = await outbox.replayOrdered({
                projectId: "project-1",
                apply: async (event) => {
                    secondPass = true
                    expect(event.eventId).toBe("event-3")
                    return { result: { accepted: true }, readSeq: 3 }
                },
            })
            expect(secondPass).toBe(false)
            expect(second.results).toEqual(expect.arrayContaining([
                expect.objectContaining({ eventId: "event-1", status: "replayed", result: { accepted: true, eventId: "event-1" } }),
                expect.objectContaining({ eventId: "event-2", status: "conflict" }),
            ]))
            expect(second.stopped).toBe(true)
            expect(await outbox.pending("project-1")).toHaveLength(1)
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    test("preserves an ambiguous non-idempotent capture without replaying it", async () => {
        const path = join(await mkdtemp(join(tmpdir(), "taric-outbox-indeterminate-")), "outbox.jsonl")
        const outbox = new EncryptedTaricOutbox({ path, key: new Uint8Array(32).fill(9) })
        await outbox.append({ eventId: "capture-1", projectId: "project-1", payload: { operation: "capture.observation", observation: { resource_ref: "resource" } } })
        await outbox.markIndeterminate("capture-1", "timeout after dispatch")
        let applied = 0
        const summary = await outbox.replayOrdered({ projectId: "project-1", apply: async () => { applied += 1; return { result: true, readSeq: 1 } } })
        expect(applied).toBe(0)
        expect(summary.stopped).toBe(true)
        expect((await outbox.list())[0]?.status).toBe("indeterminate")
    })

    test("returns the original authority result on duplicate replay without invoking Taric again", async () => {
        const dir = await mkdtemp(join(tmpdir(), "bw-taric-outbox-idempotency-"))
        try {
            const outbox = new EncryptedTaricOutbox({ path: join(dir, "events.jsonl"), key: new Uint8Array(32).fill(9) })
            await outbox.append({ eventId: "event-1", projectId: "project-1", payload: { content: "candidate" } })
            let calls = 0
            const apply = async () => {
                calls += 1
                return { result: { authorityId: "fact-1" }, readSeq: 7 }
            }
            const first = await outbox.replayOrdered({ projectId: "project-1", apply })
            const second = await outbox.replayOrdered({ projectId: "project-1", apply })
            expect(calls).toBe(1)
            expect(first.results).toEqual([{ eventId: "event-1", status: "replayed", result: { authorityId: "fact-1" }, readSeq: 7 }])
            expect(second.results).toEqual(first.results)
            expect(second.watermark).toBe(7)
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    test("coalesces duplicate and reconnect signals and advances only on confirmed read_seq", async () => {
        const requests: Array<{ afterReadSeq: number; reason: string }> = []
        let release: (() => void) | undefined
        let queryCount = 0
        const recovery = new TaricSubscriptionRecovery({
            projectId: "project-1",
            initialReadSeq: 4,
            query: async (request) => {
                requests.push({ afterReadSeq: request.afterReadSeq, reason: request.reason })
                queryCount += 1
                if (queryCount === 1) await new Promise<void>((resolve) => { release = resolve })
                return { records: [{ seq: queryCount }], readSeq: queryCount === 1 ? 5 : 6 }
            },
        })

        const first = recovery.notify("signal")
        const duplicate = recovery.notify("reconnect")
        release?.()
        await Promise.all([first, duplicate])
        expect(requests).toEqual([
            { afterReadSeq: 4, reason: "signal" },
            { afterReadSeq: 5, reason: "reconnect" },
        ])
        expect(recovery.snapshot()).toMatchObject({ state: "healthy", confirmedReadSeq: 6 })
        await recovery.close()
        await expect(recovery.notify("manual")).rejects.toThrow("closed")
    })

    test("does not accept a backwards authority watermark", async () => {
        const recovery = new TaricSubscriptionRecovery({
            projectId: "project-1",
            initialReadSeq: 10,
            query: async () => ({ records: [], readSeq: 9 }),
        })
        await expect(recovery.notify("slow_consumer")).rejects.toThrow("moved backwards")
        expect(recovery.snapshot()).toMatchObject({ state: "degraded", confirmedReadSeq: 10 })
    })
})
