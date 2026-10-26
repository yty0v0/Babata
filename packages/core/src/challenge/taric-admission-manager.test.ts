import { afterEach, describe, expect, mock, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { HostBridgeError } from "./host-bridge-types"
import { TaricAdmissionManager, defaultTaricAdmissionMode } from "./taric-admission-manager"
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
        schema_version: "1.0.0",
        kind: "claim",
        proposition: "/admin is reachable",
        status: "proposed",
        evidence_refs: ["5eee9386-a285-70b9-8ce5-995fafcc348c"],
        limitations: ["single identity"],
    },
}

async function createOutbox(): Promise<TaricProposalOutbox> {
    const dir = await mkdtemp(join(tmpdir(), "taric-admission-outbox-"))
    tempDirs.push(dir)
    const outbox = new TaricProposalOutbox({ rootDir: dir })
    await outbox.enqueue({
        idempotency_key: "proposal-1",
        challenge_id: "web-001",
        engagement_id: "engagement-1",
        solver_id: "solver-a",
        role: "executor",
        proposal,
    })
    return outbox
}

describe("Taric admission manager", () => {
    test("defaults to HITL L1", () => {
        expect(defaultTaricAdmissionMode()).toBe("hitl_l1")
        expect(defaultTaricAdmissionMode("auto_l1")).toBe("auto_l1")
        expect(defaultTaricAdmissionMode("disabled")).toBe("disabled")
    })

    test("pending proposal remains unadmitted until reviewer approval", async () => {
        const outbox = await createOutbox()
        const proposalDispatcher = mock(async () => ({ ok: true, data: { id: "taric-proposal-1" } }))
        const admissionDispatcher = mock(async () => ({ ok: true, data: { ok: true } }))
        const manager = new TaricAdmissionManager({ outbox, proposalDispatcher, admissionDispatcher })

        const before = await outbox.get("proposal-1")
        expect(before?.admission_state).toBeUndefined()
        expect(admissionDispatcher).not.toHaveBeenCalled()

        const projected = (await manager.list())[0]
        expect(projected).toMatchObject({ admission_mode: "hitl_l1", challenge_id: "web-001", engagement_id: "engagement-1" })
    })

    test("approval replays proposal, calls admission, and records reviewer", async () => {
        const outbox = await createOutbox()
        const proposalDispatcher = mock(async () => ({ ok: true, data: { id: "taric-proposal-1" } }))
        const admissionDispatcher = mock(async ({ entry }: { entry: TaricProposalOutboxEntry }) => {
            expect(entry.taric_proposal_id).toBe("taric-proposal-1")
            return { ok: true, data: { ok: true, record: { trust_level: "L1" } } }
        })
        const manager = new TaricAdmissionManager({ outbox, proposalDispatcher, admissionDispatcher })
        expect((await manager.list())[0]).toMatchObject({ admission_mode: "hitl_l1" })

        const result = await manager.approve({ idempotencyKey: "proposal-1", reviewer: "admin" })
        expect(result.admission).toMatchObject({ data: { ok: true } })
        expect(await outbox.get("proposal-1")).toMatchObject({
            status: "acknowledged",
            taric_proposal_id: "taric-proposal-1",
            admission_state: "approved",
            reviewed_by: "admin",
        })
        expect(admissionDispatcher).toHaveBeenCalledTimes(1)
    })

    test("rejection does not call admission and preserves reason", async () => {
        const outbox = await createOutbox()
        const proposalDispatcher = mock(async () => ({ ok: true, data: { id: "taric-proposal-1" } }))
        const admissionDispatcher = mock(async () => ({ ok: true, data: { ok: true } }))
        const manager = new TaricAdmissionManager({ outbox, proposalDispatcher, admissionDispatcher })
        await manager.reject({ idempotencyKey: "proposal-1", reviewer: "admin", reason: "evidence is insufficient" })
        expect(await outbox.get("proposal-1")).toMatchObject({
            admission_state: "rejected",
            reviewed_by: "admin",
            review_reason: "evidence is insufficient",
        })
        expect(admissionDispatcher).not.toHaveBeenCalled()
    })

    test("runs the host admission follow-up for checkpoint closure", async () => {
        const outbox = await createOutbox()
        const proposalDispatcher = mock(async () => ({ ok: true, data: { id: "taric-proposal-1" } }))
        const admissionDispatcher = mock(async () => ({ ok: true, data: { ok: true } }))
        const onAdmitted = mock(async (_entry: TaricProposalOutboxEntry) => {})
        const manager = new TaricAdmissionManager({ outbox, proposalDispatcher, admissionDispatcher, onAdmitted })
        await manager.approve({ idempotencyKey: "proposal-1", reviewer: "admin" })
        expect(onAdmitted).toHaveBeenCalledTimes(1)
        expect(onAdmitted.mock.calls[0]?.[0]).toMatchObject({
            idempotency_key: "proposal-1",
            admission_state: "approved",
        })
        await manager.approve({ idempotencyKey: "proposal-1", reviewer: "admin" })
        expect(onAdmitted).toHaveBeenCalledTimes(2)
    })

    test("admission failure is fail-closed and recorded", async () => {
        const outbox = await createOutbox()
        const proposalDispatcher = mock(async () => ({ ok: true, data: { id: "taric-proposal-1" } }))
        const admissionDispatcher = mock(async () => ({ ok: false, error: { code: "validation_error", message: "evidence gate failed" } }))
        const manager = new TaricAdmissionManager({ outbox, proposalDispatcher, admissionDispatcher })
        let caught: unknown
        try {
            await manager.approve({ idempotencyKey: "proposal-1", reviewer: "admin" })
        } catch (error) {
            caught = error
        }
        expect(caught).toBeInstanceOf(HostBridgeError)
        expect((caught as HostBridgeError).code).toBe("unavailable")
        const failedEntry = await outbox.get("proposal-1")
        expect(failedEntry).toMatchObject({
            status: "acknowledged",
            admission_error: "evidence gate failed",
        })
        expect(failedEntry?.admission_state).toBeUndefined()
    })

    test("auto_l1 admits checkpoints but still requires review for claims", async () => {
        const outbox = await createOutbox()
        const checkpointProposal: NormalizedTaricProposal = {
            kind: "checkpoint",
            subject_type: "checkpoint",
            expected_version: 0,
            content: { next_steps: ["continue"], facts_used: [], open_questions: [] },
        }
        await outbox.enqueue({
            idempotency_key: "proposal-auto-checkpoint",
            challenge_id: "web-001",
            engagement_id: "engagement-1",
            solver_id: "solver-a",
            role: "executor",
            proposal: checkpointProposal,
        })
        const proposalDispatcher = mock(async () => ({ ok: true, data: { id: "taric-proposal-auto" } }))
        const admissionDispatcher = mock(async () => ({ ok: true, data: { ok: true } }))
        const onAdmitted = mock(async (_entry: TaricProposalOutboxEntry) => {})
        const manager = new TaricAdmissionManager({
            outbox,
            proposalDispatcher,
            admissionDispatcher,
            onAdmitted,
            mode: "auto_l1",
        })
        const result = await manager.admitPending()
        expect(result).toEqual({ admitted: 1, failed: 0 })
        expect(await outbox.get("proposal-auto-checkpoint")).toMatchObject({
            admission_state: "approved",
            reviewed_by: "auto-policy",
        })
        expect(onAdmitted).toHaveBeenCalledTimes(1)

        let claimError: unknown
        try {
            await manager.approve({ idempotencyKey: "proposal-1", reviewer: "admin" })
        } catch (error) {
            claimError = error
        }
        expect(claimError).toBeInstanceOf(HostBridgeError)
        expect((claimError as HostBridgeError).code).toBe("authorization_error")
        expect((await outbox.get("proposal-1"))?.admission_state).toBeUndefined()
    })

    test("refreshes checkpoint authority before submission", async () => {
        const outbox = await createOutbox()
        const checkpointProposal: NormalizedTaricProposal = {
            kind: "checkpoint",
            subject_type: "checkpoint",
            expected_version: 0,
            content: {
                work_run_ref: "01a16c3b-7336-7fb3-a165-68fdf3fe3e17",
                generation: 1,
                lease_expires_at: "2020-01-01T00:00:00.000Z",
                source_read_seq: 3,
            },
        }
        await outbox.enqueue({
            idempotency_key: "proposal-lease",
            challenge_id: "web-001",
            engagement_id: "engagement-1",
            solver_id: "solver-a",
            role: "executor",
            proposal: checkpointProposal,
        })
        const proposalDispatcher = mock(async (entry: TaricProposalOutboxEntry) => {
            expect(entry.proposal.content.lease_expires_at).toBe("2030-01-01T00:00:00.000Z")
            expect(entry.proposal.content.source_read_seq).toBe(11)
            return { ok: true, data: { id: "taric-proposal-2" } }
        })
        const admissionDispatcher = mock(async () => ({ ok: true, data: { ok: true } }))
        const manager = new TaricAdmissionManager({
            outbox,
            proposalDispatcher,
            admissionDispatcher,
            refreshProposal: async (entry) => ({
                ...entry.proposal,
                content: { ...entry.proposal.content, lease_expires_at: "2030-01-01T00:00:00.000Z", source_read_seq: 11 },
            }),
        })
        await manager.approve({ idempotencyKey: "proposal-lease", reviewer: "admin" })
        expect(await outbox.get("proposal-lease")).toMatchObject({
            admission_state: "approved",
            proposal: { content: { lease_expires_at: "2030-01-01T00:00:00.000Z", source_read_seq: 11 } },
        })
    })

    test("refuses to admit a checkpoint already submitted under a stale lease", async () => {
        const dir = await mkdtemp(join(tmpdir(), "taric-admission-stale-"))
        tempDirs.push(dir)
        const outbox = new TaricProposalOutbox({ rootDir: dir })
        await outbox.enqueue({
            idempotency_key: "proposal-stale",
            challenge_id: "web-001",
            engagement_id: "engagement-1",
            solver_id: "solver-a",
            role: "executor",
            proposal: {
                kind: "checkpoint",
                subject_type: "checkpoint",
                expected_version: 0,
                content: {
                    work_run_ref: "01a16c3b-7336-7fb3-a165-68fdf3fe3e17",
                    generation: 1,
                    lease_expires_at: "2020-01-01T00:00:00.000Z",
                },
            },
        })
        // Taric already holds this proposal binding the old lease.
        const submitted = await outbox.replay(mock(async () => ({ ok: true, data: { id: "taric-proposal-3" } })))
        expect(submitted.applied).toBe(1)

        const admissionDispatcher = mock(async () => ({ ok: true, data: { ok: true } }))
        const manager = new TaricAdmissionManager({
            outbox,
            proposalDispatcher: mock(async () => ({ ok: true, data: { id: "taric-proposal-3" } })),
            admissionDispatcher,
            refreshProposal: async (entry) => ({
                ...entry.proposal,
                content: { ...entry.proposal.content, lease_expires_at: "2030-01-01T00:00:00.000Z" },
            }),
        })
        let caught: unknown
        try {
            await manager.approve({ idempotencyKey: "proposal-stale", reviewer: "admin" })
        } catch (error) {
            caught = error
        }
        expect(caught).toBeInstanceOf(HostBridgeError)
        expect((caught as HostBridgeError).code).toBe("stale_version")
        expect(admissionDispatcher).not.toHaveBeenCalled()
    })
})
