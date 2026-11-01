import { afterEach, describe, expect, mock, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { HostBridgeError } from "./host-bridge-types"
import { resolveTaricLeaseMs, TaricWorkManager, type TaricCheckpointPayload } from "./taric-work-manager"

const tempDirs: string[] = []
const WORK_ITEM_ID = "01a16c3a-afbd-76b8-a605-d46104a68225"
const ENGAGEMENT_ID = "01a16c36-afe4-7a6f-8841-c44a7ecf48ea"

afterEach(async () => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop()
        if (dir) await rm(dir, { recursive: true, force: true })
    }
})

async function createManager(data: Record<string, unknown> = { read_seq: 1 }) {
    const dir = await mkdtemp(join(tmpdir(), "taric-work-"))
    tempDirs.push(dir)
    const calls: Array<{ operation: string; request: Record<string, unknown> }> = []
    const dispatcher = mock(async (input: { operation: string; request: Record<string, unknown> }) => {
        calls.push(input)
        return { ok: true, data }
    })
    const manager = new TaricWorkManager({ rootDir: dir, dispatcher })
    return { dir, dispatcher, calls, manager }
}

function claim(manager: TaricWorkManager, overrides: Partial<Parameters<TaricWorkManager["claim"]>[0]> = {}) {
    return manager.claim({
        challengeId: "web-001",
        engagementId: ENGAGEMENT_ID,
        workItemId: WORK_ITEM_ID,
        solverId: "solver-a",
        role: "executor",
        ...overrides,
    })
}

const checkpoint: TaricCheckpointPayload = {
    next_steps: ["verify auth bypass"],
    facts_used: ["admin endpoint is reachable"],
    open_questions: ["is CSRF token required?"],
}

describe("Taric work manager", () => {
    test("list ignores persisted work-item records that are not WorkRuns", async () => {
        const { dir, manager } = await createManager()
        const claimed = await claim(manager)
        await writeFile(join(dir, "work-item-web-001-solver-a.json"), JSON.stringify({
            work_item_id: WORK_ITEM_ID,
            challenge_id: "web-001",
            engagement_id: ENGAGEMENT_ID,
            solver_id: "solver-a",
            status: "closed",
            created_at: new Date().toISOString(),
        }))

        const records = await manager.list()
        expect(records).toHaveLength(1)
        expect(records[0]?.work_run_id).toBe(claimed.work_run_id)
    })

    test("claims a work run with the Taric work.claim contract", async () => {
        const { dispatcher, calls, manager } = await createManager()
        const record = await claim(manager)
        expect(record).toMatchObject({
            challenge_id: "web-001",
            engagement_id: ENGAGEMENT_ID,
            work_item_id: WORK_ITEM_ID,
            host_id: "breachweave-host",
            solver_id: "solver-a",
            agent_id: "executor-solver-a",
            role: "executor",
            generation: 1,
            status: "active",
        })
        expect(dispatcher).toHaveBeenCalledTimes(1)
        expect(calls[0]).toMatchObject({
            operation: "work.claim",
            request: {
                engagement_id: ENGAGEMENT_ID,
                work_item_id: WORK_ITEM_ID,
                host_id: "breachweave-host",
                agent_id: "executor-solver-a",
                ttl_ms: 300000,
            },
        })
        expect((await manager.get(record.work_run_id))?.work_run_id).toBe(record.work_run_id)
    })

    test("projects authoritative claim and checkpoint responses", async () => {
        const { manager } = await createManager({
            run_id: "01a16c3b-7336-7fb3-a165-68fdf3fe3e17",
            attempt_ref: "01a16c3b-733a-7895-b1a2-2657ac3eb65b",
            generation: 1,
            read_seq: 14,
            work_item_version: 1,
            target_version: 1,
            scope_ref: "01a16c36-afe4-7ae3-b24f-d83fb3837bc5",
            scope_version: 1,
            lease_expires_at: "2030-01-01T00:00:00.000Z",
        })
        const record = await claim(manager)
        expect(record).toMatchObject({
            work_run_id: "01a16c3b-7336-7fb3-a165-68fdf3fe3e17",
            attempt_id: "01a16c3b-733a-7895-b1a2-2657ac3eb65b",
            read_seq: 14,
            scope_ref: "01a16c36-afe4-7ae3-b24f-d83fb3837bc5",
            scope_version: 1,
        })
    })

    test("renews and resumes an active work run", async () => {
        const { dispatcher, calls, manager } = await createManager()
        const claimed = await claim(manager)
        const renewed = await manager.renew(claimed.work_run_id, 1)
        expect(renewed.lease_expires_at).toBeDefined()
        const resumed = await manager.resume(claimed.work_run_id, 1)
        expect(resumed.read_seq).toBe(1)
        await manager.commitCheckpoint(claimed.work_run_id, checkpoint, 1)
        expect(dispatcher).toHaveBeenCalledTimes(4)

        expect(calls[1]).toMatchObject({
            operation: "work.renew",
            request: { engagement_id: ENGAGEMENT_ID, work_run_id: claimed.work_run_id, host_id: "breachweave-host", generation: 1 },
        })
        expect(calls[2]).toMatchObject({
            operation: "work.resume",
            request: { engagement_id: ENGAGEMENT_ID, work_run_id: claimed.work_run_id, host_id: "breachweave-host" },
        })
        expect(calls[3]).toMatchObject({ operation: "checkpoint.commit" })
    })

    test("checkpoint commit sends a complete checkpoint envelope", async () => {
        const { calls, manager } = await createManager()
        const claimed = await claim(manager)
        await manager.commitCheckpoint(claimed.work_run_id, checkpoint, 1)
        expect(calls[1]?.operation).toBe("checkpoint.commit")
        expect(calls[1]?.request.checkpoint).toMatchObject({
            work_item_ref: WORK_ITEM_ID,
            work_run_ref: claimed.work_run_id,
            attempt_ref: claimed.attempt_id,
            generation: 1,
            next_steps: ["verify auth bypass"],
            unresolved_work: ["is CSRF token required?"],
            external_action_state: "none",
            owner: { host_id: "breachweave-host", agent_id: "executor-solver-a" },
        })
        expect((calls[1]?.request.checkpoint as Record<string, unknown>).context_manifest).toMatchObject({ builder_version: "breachweave-taric-work/1" })
    })

    test("checkpoint commit carries host-derived observation and evidence refs", async () => {
        const { calls, manager } = await createManager()
        const claimed = await claim(manager)
        const observationRef = "01a16c3b-7336-7fb3-a165-68fdf3fe3e21"
        await manager.commitCheckpoint(
            claimed.work_run_id,
            {
                ...checkpoint,
                observation_refs: [observationRef],
                evidence_refs: [observationRef],
            },
            1,
        )
        expect(calls[1]?.request.checkpoint).toMatchObject({
            observation_refs: [observationRef],
            evidence_refs: [observationRef],
        })
        expect((await manager.get(claimed.work_run_id))?.committed_evidence_refs).toEqual([observationRef])
    })

    test("checkpoint commit rejects malformed observation refs", async () => {
        const { manager } = await createManager()
        const claimed = await claim(manager)
        await expect(
            manager.commitCheckpoint(
                claimed.work_run_id,
                { ...checkpoint, observation_refs: ["not-a-uuid"] },
                1,
            ),
        ).rejects.toBeInstanceOf(HostBridgeError)
    })

    test("reclaiming marks the old attempt stale and starts a new generation", async () => {
        const { manager } = await createManager()
        const claimed = await claim(manager)
        const oldAttempt = claimed.attempt_id
        const next = await manager.reclaim(claimed.work_run_id, 1)
        expect(next.attempt_id).not.toBe(oldAttempt)
        expect(next.generation).toBe(2)
        expect(next.status).toBe("active")
    })

    test("reclaim transfers ownership to the replacement solver", async () => {
        const dir = await mkdtemp(join(tmpdir(), "taric-work-takeover-"))
        tempDirs.push(dir)
        const calls: Array<{ operation: string; request: Record<string, unknown> }> = []
        const dispatcher = mock(async (input: { operation: string; request: Record<string, unknown> }) => {
            calls.push(input)
            if (input.operation === "work.claim") {
                return { ok: true, data: { run_id: WORK_ITEM_ID, attempt_ref: "01a16c3b-733a-7895-b1a2-2657ac3eb65b", generation: 1, read_seq: 2 } }
            }
            return {
                ok: true,
                data: {
                    attempt_ref: "01a16c3b-733a-7895-b1a2-2657ac3eb65c",
                    generation: 2,
                    read_seq: 9,
                    lease_expires_at: "2030-01-01T00:00:00.000Z",
                },
            }
        })
        const manager = new TaricWorkManager({ rootDir: dir, dispatcher })
        const claimed = await claim(manager)
        const next = await manager.reclaim(claimed.work_run_id, 1, {
            solverId: "solver-b",
            role: "executor",
            agentId: "executor-solver-b",
        })
        expect(calls[1]).toMatchObject({
            operation: "work.reclaim",
            request: { agent_id: "executor-solver-b", host_id: "breachweave-host" },
        })
        expect(next).toMatchObject({
            solver_id: "solver-b",
            agent_id: "executor-solver-b",
            generation: 2,
            attempt_id: "01a16c3b-733a-7895-b1a2-2657ac3eb65c",
        })
    })

    test("finds only expired runs that carry a checkpoint for recovery", async () => {
        const dir = await mkdtemp(join(tmpdir(), "taric-work-recover-"))
        tempDirs.push(dir)
        const dispatcher = mock(async (input: { operation: string }) => {
            if (input.operation === "work.claim") {
                return { ok: true, data: { run_id: WORK_ITEM_ID, attempt_ref: "01a16c3b-733a-7895-b1a2-2657ac3eb65b", generation: 1, read_seq: 2 } }
            }
            return { ok: true, data: {} }
        })
        const manager = new TaricWorkManager({ rootDir: dir, dispatcher, leaseMs: 500 })
        const claimed = await claim(manager)
        expect(await manager.findRecoverable("web-001", ENGAGEMENT_ID)).toBeUndefined()
        await manager.commitCheckpoint(claimed.work_run_id, checkpoint, 1)
        expect(await manager.findRecoverable("web-001", ENGAGEMENT_ID)).toBeUndefined()
        await Bun.sleep(600)
        const recoverable = await manager.findRecoverable("web-001", ENGAGEMENT_ID)
        expect(recoverable?.work_run_id).toBe(claimed.work_run_id)
        expect(recoverable?.checkpoint_id).toBeDefined()
    })

    test("holds an unexpired checkpointed run as pending recovery", async () => {
        const dir = await mkdtemp(join(tmpdir(), "taric-work-pending-"))
        tempDirs.push(dir)
        const dispatcher = mock(async (input: { operation: string }) => {
            if (input.operation === "work.claim") {
                return {
                    ok: true,
                    data: {
                        run_id: WORK_ITEM_ID,
                        attempt_ref: "01a16c3b-733a-7895-b1a2-2657ac3eb65b",
                        generation: 1,
                        read_seq: 2,
                        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
                    },
                }
            }
            return { ok: true, data: { checkpoint_id: "01a16c3b-733a-7895-b1a2-2657ac3eb65d" } }
        })
        const manager = new TaricWorkManager({ rootDir: dir, dispatcher })
        const claimed = await claim(manager)
        await manager.commitCheckpoint(claimed.work_run_id, checkpoint, 1)
        expect(await manager.findRecoverable("web-001", ENGAGEMENT_ID)).toBeUndefined()
        expect((await manager.findPendingRecovery("web-001", ENGAGEMENT_ID))?.work_run_id).toBe(claimed.work_run_id)
    })

    test("closing with an admitted checkpoint records the checkpoint id", async () => {
        const { calls, manager } = await createManager({
            run_id: WORK_ITEM_ID,
            attempt_ref: "01a16c3b-733a-7895-b1a2-2657ac3eb65b",
            generation: 1,
            read_seq: 4,
            checkpoint_id: "01a16c3b-733a-7895-b1a2-2657ac3eb65d",
            lease_expires_at: "2030-01-01T00:00:00.000Z",
        })
        const claimed = await claim(manager)
        const closed = await manager.closeWithAdmittedCheckpoint(claimed.work_run_id, checkpoint, 1)
        expect(closed).toMatchObject({
            status: "checkpointed",
            checkpoint_id: "01a16c3b-733a-7895-b1a2-2657ac3eb65d",
        })
        expect(calls.filter((call) => call.operation === "checkpoint.commit")).toHaveLength(1)
        const again = await manager.closeWithAdmittedCheckpoint(claimed.work_run_id, checkpoint, 1)
        expect(again.checkpoint_id).toBe(closed.checkpoint_id)
        expect(calls.filter((call) => call.operation === "checkpoint.commit")).toHaveLength(1)
    })

    test("projects an admitted checkpoint proposal into the commit payload", async () => {
        const { checkpointPayloadFromAdmittedProposal } = await import("./taric-work-manager")
        expect(
            checkpointPayloadFromAdmittedProposal({
                completed_steps: ["logged in as admin"],
                next_steps: ["exploit SQL injection"],
                facts_used: ["admin panel reachable"],
                unresolved_work: ["does WAF block UNION?"],
                negative_results: ["default creds rejected"],
                context_manifest: { sources: [{ kind: "fact", summary: "ignored fallback" }] },
            }),
        ).toMatchObject({
            completed_steps: ["logged in as admin"],
            next_steps: ["exploit SQL injection"],
            facts_used: ["admin panel reachable"],
            open_questions: ["does WAF block UNION?"],
            negative_results: ["default creds rejected"],
        })
        expect(checkpointPayloadFromAdmittedProposal({})).toMatchObject({
            next_steps: ["Continue from the admitted checkpoint"],
            facts_used: [],
        })
    })

    test("stale generation writes are rejected", async () => {
        const { manager } = await createManager()
        const claimed = await claim(manager)
        await manager.reclaim(claimed.work_run_id, 1)
        await expect(manager.commitCheckpoint(claimed.work_run_id, checkpoint, 1)).rejects.toBeInstanceOf(HostBridgeError)
        try {
            await manager.commitCheckpoint(claimed.work_run_id, checkpoint, 1)
        } catch (error) {
            expect((error as HostBridgeError).code).toBe("stale_version")
        }
    })

    test("concurrent claims for the same work run share one authoritative record", async () => {
        const { dispatcher, manager } = await createManager()
        const [first, second] = await Promise.all([
            claim(manager, { workRunId: "shared-work-run" }),
            claim(manager, { workRunId: "shared-work-run" }),
        ])
        expect(first.attempt_id).toBe(second.attempt_id)
        expect(dispatcher).toHaveBeenCalledTimes(1)
    })

    test("expired leases require reclaim before further writes", async () => {
        const dir = await mkdtemp(join(tmpdir(), "taric-work-lease-"))
        tempDirs.push(dir)
        const dispatcher = mock(async () => ({ ok: true, data: {} }))
        const manager = new TaricWorkManager({ rootDir: dir, dispatcher, leaseMs: 1 })
        const claimed = await claim(manager)
        await Bun.sleep(5)
        await expect(manager.resume(claimed.work_run_id, 1)).rejects.toBeInstanceOf(HostBridgeError)
        const next = await manager.reclaim(claimed.work_run_id, 1)
        expect(next.status).toBe("active")
    })

    test("creates and admits a host work item once per solver", async () => {
        const dir = await mkdtemp(join(tmpdir(), "taric-work-item-"))
        tempDirs.push(dir)
        const calls: Array<{ operation: string; request: Record<string, unknown> }> = []
        const dispatcher = mock(async (input: { operation: string; request: Record<string, unknown> }) => {
            calls.push(input)
            if (input.operation === "proposal.submit") return { ok: true, data: { id: "proposal-1" } }
            if (input.operation === "admission.evaluate") return { ok: true, data: { ok: true, record: { id: WORK_ITEM_ID } } }
            return { ok: true, data: {} }
        })
        const manager = new TaricWorkManager({ rootDir: dir, dispatcher })
        const first = await manager.ensureWorkItem({
            challengeId: "web-001",
            engagementId: ENGAGEMENT_ID,
            solverId: "solver-a",
            role: "executor",
            scopeRef: "01a16c36-afe4-7ae3-b24f-d83fb3837bc5",
        })
        const second = await manager.ensureWorkItem({
            challengeId: "web-001",
            engagementId: ENGAGEMENT_ID,
            solverId: "solver-a",
            role: "executor",
        })
        expect(first.work_item_id).toBe(WORK_ITEM_ID)
        expect(second.work_item_id).toBe(WORK_ITEM_ID)
        expect(calls).toHaveLength(2)
        expect(calls[0]).toMatchObject({
            operation: "proposal.submit",
            request: {
                subject_type: "work_item",
                expected_version: 0,
                content: {
                    kind: "work_item",
                    status: "queued",
                    scope_ref: "01a16c36-afe4-7ae3-b24f-d83fb3837bc5",
                    provenance: { source_kind: "host" },
                },
            },
        })
        expect(calls[1]).toMatchObject({
            operation: "admission.evaluate",
            request: { proposal_id: "proposal-1", expected_version: 0 },
        })
    })

    test("checkpoint authority renews a near-expired lease and keeps the owner agent stable", async () => {
        const dir = await mkdtemp(join(tmpdir(), "taric-work-authority-"))
        tempDirs.push(dir)
        const calls: string[] = []
        const dispatcher = mock(async (input: { operation: string }) => {
            calls.push(input.operation)
            if (input.operation === "work.claim") {
                return {
                    ok: true,
                    data: {
                        run_id: "01a16c3b-7336-7fb3-a165-68fdf3fe3e17",
                        attempt_ref: "01a16c3b-733a-7895-b1a2-2657ac3eb65b",
                        generation: 1,
                        read_seq: 4,
                        work_item_version: 2,
                        target_version: 2,
                        scope_version: 1,
                        lease_expires_at: new Date(Date.now() + 5_000).toISOString(),
                    },
                }
            }
            return { ok: true, data: { lease_expires_at: new Date(Date.now() + 300_000).toISOString() } }
        })
        const manager = new TaricWorkManager({ rootDir: dir, dispatcher })
        const claimed = await manager.claim({
            challengeId: "web-001",
            engagementId: ENGAGEMENT_ID,
            workItemId: WORK_ITEM_ID,
            solverId: "solver-a",
            role: "executor",
        })
        const authority = await manager.checkpointAuthority(claimed.work_run_id, claimed.generation)
        expect(calls).toEqual(["work.claim", "work.renew"])
        expect(authority).toMatchObject({
            work_run_ref: claimed.work_run_id,
            attempt_ref: claimed.attempt_id,
            generation: 1,
            work_item_version: 2,
            target_version: 2,
            owner: { host_id: "breachweave-host", agent_id: "executor-solver-a" },
        })
    })

    test("heartbeat renews only live work runs before their lease expires", async () => {
        const dir = await mkdtemp(join(tmpdir(), "taric-work-heartbeat-"))
        tempDirs.push(dir)
        const calls: Array<{ operation: string; request: Record<string, unknown> }> = []
        const dispatcher = mock(async (input: { operation: string; request: Record<string, unknown> }) => {
            calls.push(input)
            if (input.operation === "work.claim") {
                return { ok: true, data: { run_id: "01a16c3b-7336-7fb3-a165-68fdf3fe3e17", attempt_ref: "01a16c3b-733a-7895-b1a2-2657ac3eb65b", generation: 1, read_seq: 3 } }
            }
            return { ok: true, data: { lease_expires_at: new Date(Date.now() + 300_000).toISOString() } }
        })
        const manager = new TaricWorkManager({ rootDir: dir, dispatcher, leaseMs: 1_000 })
        const claimed = await manager.claim({
            challengeId: "web-001",
            engagementId: ENGAGEMENT_ID,
            workItemId: WORK_ITEM_ID,
            solverId: "solver-a",
            role: "executor",
        })
        expect(claimed.lease_expires_at).toBeDefined()
        expect(await manager.heartbeat({ shouldRenew: () => false })).toEqual({ renewed: 0, skipped: 1, failed: 0 })
        const renewed = await manager.heartbeat({ renewBeforeMs: 60_000, shouldRenew: (record) => record.solver_id === "solver-a" })
        expect(renewed).toEqual({ renewed: 1, skipped: 0, failed: 0 })
        expect(calls.map((call) => call.operation)).toEqual(["work.claim", "work.renew"])
        const lease = (await manager.get(claimed.work_run_id))?.lease_expires_at
        expect(lease).toBeDefined()
        expect(Date.parse(String(lease))).toBeGreaterThan(Date.now() + 60_000)
    })

    test("repair closes an admitted checkpoint once and skips it afterwards", async () => {
        const dir = await mkdtemp(join(tmpdir(), "taric-work-repair-"))
        tempDirs.push(dir)
        let commits = 0
        const dispatcher = mock(async (input: { operation: string; request: Record<string, unknown> }) => {
            if (input.operation === "work.claim") {
                return {
                    ok: true,
                    data: {
                        run_id: "01a16c3b-7336-7fb3-a165-68fdf3fe3e31",
                        attempt_ref: "01a16c3b-733a-7895-b1a2-2657ac3eb631",
                        generation: 1,
                        read_seq: 2,
                    },
                }
            }
            if (input.operation === "checkpoint.commit") {
                commits += 1
                if (commits === 1) return { ok: false, error: { code: "unavailable", message: "commit unavailable" } }
                return { ok: true, data: { checkpoint_id: "01a16c3b-7336-7fb3-a165-68fdf3fe3e32" } }
            }
            return { ok: true, data: {} }
        })
        const manager = new TaricWorkManager({ rootDir: dir, dispatcher })
        const claimed = await claim(manager)
        await manager.stageAdmittedCheckpoint(claimed.work_run_id, checkpoint, 1)
        await expect(manager.closeWithAdmittedCheckpoint(claimed.work_run_id, checkpoint, 1)).rejects.toBeInstanceOf(HostBridgeError)
        await manager.recordCheckpointCommitError(claimed.work_run_id, "commit unavailable")
        expect(await manager.listUncommittedAdmitted()).toHaveLength(1)

        const first = await manager.repairAdmittedCheckpoints(5)
        expect(first).toMatchObject({ repaired: 1, awaitingRepair: 0, failed: 0 })
        expect((await manager.get(claimed.work_run_id))?.status).toBe("checkpointed")
        expect((await manager.get(claimed.work_run_id))?.checkpoint_repaired_at).toBeDefined()

        const second = await manager.repairAdmittedCheckpoints(5)
        expect(second).toMatchObject({ repaired: 0, awaitingRepair: 0, failed: 0 })
        expect(commits).toBe(2)
    })

    test("repair records repeated failures without losing the admitted payload", async () => {
        const dir = await mkdtemp(join(tmpdir(), "taric-work-repair-fail-"))
        tempDirs.push(dir)
        let commits = 0
        const dispatcher = mock(async (input: { operation: string }) => {
            if (input.operation === "work.claim") {
                return {
                    ok: true,
                    data: {
                        run_id: "01a16c3b-7336-7fb3-a165-68fdf3fe3e41",
                        attempt_ref: "01a16c3b-733a-7895-b1a2-2657ac3eb641",
                        generation: 1,
                    },
                }
            }
            if (input.operation === "checkpoint.commit") {
                commits += 1
                return { ok: false, error: { code: "unavailable", message: `commit failure ${commits}` } }
            }
            return { ok: true, data: {} }
        })
        const manager = new TaricWorkManager({ rootDir: dir, dispatcher })
        const claimed = await claim(manager)
        await manager.stageAdmittedCheckpoint(claimed.work_run_id, checkpoint, 1)

        expect(await manager.repairAdmittedCheckpoints(5)).toMatchObject({
            repaired: 0,
            awaitingRepair: 1,
            failed: 1,
            lastError: "commit failure 1",
        })
        expect(await manager.repairAdmittedCheckpoints(5)).toMatchObject({
            repaired: 0,
            awaitingRepair: 1,
            failed: 1,
            lastError: "commit failure 2",
        })
        expect((await manager.get(claimed.work_run_id))?.checkpoint_repair_error).toBe("commit failure 2")
        expect((await manager.get(claimed.work_run_id))?.checkpoint_payload?.next_steps).toEqual(checkpoint.next_steps)
    })

    test("resolves the lease default and clamps unsafe values", () => {
        expect(resolveTaricLeaseMs(undefined)).toBe(300_000)
        expect(resolveTaricLeaseMs("not-a-number")).toBe(300_000)
        expect(resolveTaricLeaseMs("1")).toBe(60_000)
        expect(resolveTaricLeaseMs("120000")).toBe(120_000)
        expect(resolveTaricLeaseMs("999999999")).toBe(900_000)
    })
})
