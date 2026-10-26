import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { TaricArtifactStore } from "./taric-artifact-store"
import { TaricAuthoritativeState } from "./taric-authoritative-state"
import type { TaricEngagementService } from "./taric-engagement-service"
import type { TaricWorkManager, TaricWorkRecord } from "./taric-work-manager"

const tempDirs: string[] = []

afterEach(async () => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop()
        if (dir) await rm(dir, { recursive: true, force: true })
    }
})

function workRecord(overrides: Partial<TaricWorkRecord> = {}): TaricWorkRecord {
    return {
        work_run_id: "work-run-1",
        attempt_id: "attempt-1",
        agent_id: "executor-solver-a",
        generation: 1,
        challenge_id: "web-001",
        engagement_id: "engagement-1",
        work_item_id: "work-item-1",
        asset_hash: "asset-hash-1",
        host_id: "breachweave-host",
        solver_id: "solver-a",
        role: "executor",
        status: "active",
        read_seq: 1,
        created_at: "2026-10-24T00:00:00.000Z",
        updated_at: "2026-10-24T01:00:00.000Z",
        ...overrides,
    }
}

function createEngagement(active = true) {
    return {
        bindingRegistry: {
            async getActiveBinding() {
                return active ? { engagement_id: "engagement-1", status: "active" } : undefined
            },
        },
    } as unknown as TaricEngagementService
}

function createState(records: TaricWorkRecord[], active = true) {
    return new TaricAuthoritativeState({
        work: {
            async list() {
                return records
            },
        } as unknown as TaricWorkManager,
        engagement: createEngagement(active),
    })
}

describe("TaricAuthoritativeState", () => {
    test("builds a host-injected context pack with admitted checkpoints, work items, and coverage gaps", async () => {
        const state = createState([
            workRecord(),
            workRecord({
                work_run_id: "work-run-2",
                work_item_id: "work-item-2",
                status: "checkpointed",
                checkpoint_id: "checkpoint-2",
                checkpoint_payload: {
                    next_steps: ["test SQL injection"],
                    facts_used: ["login endpoint is reachable"],
                    open_questions: [],
                },
                committed_evidence_refs: ["evidence-1"],
            }),
        ])

        const pack = await state.contextPack("web-001", "solver-a", "executor")
        expect(pack.activeWorkItems).toHaveLength(2)
        expect(pack.admittedCheckpoints).toHaveLength(1)
        expect(pack.coverageGaps).toHaveLength(1)
        expect(state.formatContextPack(pack)).toContain("Taric authoritative blackboard context")
        expect(state.formatContextPack(pack)).not.toContain("raw artifact bytes")
    })

    test("rejects a report without a current checkpoint", async () => {
        const state = createState([workRecord()])
        const result = await state.assertReportGate({
            challengeId: "web-001",
            solverId: "solver-a",
            assetHash: "asset-hash-1",
        })
        expect(result.ok).toBe(false)
        expect(result.failure?.kind).toBe("missing_checkpoint")
    })

    test("rejects a checkpoint without evidence or explicit gap", async () => {
        const state = createState([
            workRecord({
                status: "checkpointed",
                checkpoint_id: "checkpoint-1",
                committed_evidence_refs: [],
                evidence_gap: undefined,
            }),
        ])
        const result = await state.assertReportGate({
            challengeId: "web-001",
            solverId: "solver-a",
            assetHash: "asset-hash-1",
        })
        expect(result.ok).toBe(false)
        expect(result.failure?.kind).toBe("missing_evidence")
    })

    test("accepts a checkpoint with an explicit evidence gap", async () => {
        const state = createState([
            workRecord({
                status: "checkpointed",
                checkpoint_id: "checkpoint-1",
                committed_evidence_refs: [],
                evidence_gap: "target asset is unavailable for evidence binding",
            }),
        ])
        const result = await state.assertReportGate({
            challengeId: "web-001",
            solverId: "solver-a",
            assetHash: "asset-hash-1",
        })
        expect(result.ok).toBe(true)
        expect(result.checkpointId).toBe("checkpoint-1")
    })

    test("captures and hashes a host-side tool result artifact", async () => {
        const dir = await mkdtemp(join(tmpdir(), "taric-authoritative-state-"))
        tempDirs.push(dir)
        const artifacts = new TaricArtifactStore({ rootDir: dir })
        const state = new TaricAuthoritativeState({
            work: { async list() { return [] } } as unknown as TaricWorkManager,
            artifacts,
            engagement: createEngagement(),
        })
        const result = await state.captureToolResult({
            engagementId: "engagement-1",
            workRunId: "work-run-1",
            attemptId: "attempt-1",
            toolName: "bash",
            text: "Authorization: Bearer secret-token\nThis is a sufficiently long command result with evidence content.",
        })
        expect(result.captured).toBe(true)
        expect(result.hash).toStartWith("sha256:")
        const stored = await artifacts.get(result.artifactId!)
        expect(stored?.status).toBe("committed")
        const bytes = await artifacts.readAuthorized(result.artifactId!, "operator")
        expect(new TextDecoder().decode(bytes)).toContain("<redacted>")
    })

    test("builds memory and idea projections from admitted checkpoint payloads", async () => {
        const state = createState([
            workRecord({
                status: "checkpointed",
                checkpoint_id: "checkpoint-1",
                checkpoint_payload: {
                    next_steps: ["enumerate admin endpoints"],
                    facts_used: ["target is DVWA"],
                    open_questions: ["does WAF block SQLi?"],
                    completed_steps: ["recon completed"],
                    negative_results: ["no open directory listing"],
                },
            }),
        ])
        const projection = await state.buildProjection("web-001")
        expect(projection.memory.some((item) => item.content === "target is DVWA")).toBe(true)
        expect(projection.memory.some((item) => item.content === "no open directory listing")).toBe(true)
        expect(projection.ideas.some((item) => item.content === "enumerate admin endpoints")).toBe(true)
    })
})
