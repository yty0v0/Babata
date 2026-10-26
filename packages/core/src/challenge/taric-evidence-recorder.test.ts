import { afterEach, describe, expect, mock, test } from "bun:test"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { buildTaricObservationStatement, TaricEvidenceRecorder } from "./taric-evidence-recorder"

const ENGAGEMENT_ID = "01a16c36-afe4-7a6f-8841-c44a7ecf48ea"
const RESOURCE_PROPOSAL_ID = "01a16c3b-7336-7fb3-a165-68fdf3fe3e11"
const RESOURCE_ID = "01a16c3b-7336-7fb3-a165-68fdf3fe3e12"
const OBSERVATION_PROPOSAL_ID = "01a16c3b-7336-7fb3-a165-68fdf3fe3e13"
const OBSERVATION_ID = "01a16c3b-7336-7fb3-a165-68fdf3fe3e14"
const ARTIFACT_ID = "01a16c3b-7336-7fb3-a165-68fdf3fe3e15"
const POLICY_DIGEST = `sha256:${"1".repeat(64)}`
const tempDirs: string[] = []

afterEach(async () => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop()
        if (dir) await rm(dir, { recursive: true, force: true })
    }
})

const target = {
    assetHash: "3e27a17e84f5f8486fbc14488e12e6ff",
    asset: "https://target.example",
    assetType: "endpoint" as const,
}

function artifact(hash = `sha256:${"a".repeat(64)}`) {
    return {
        artifact_id: ARTIFACT_ID,
        content_ref: `taric-artifact:${ARTIFACT_ID}`,
        content_hash: hash,
        byte_length: 512,
    }
}

async function createRecorder(dispatcher: ReturnType<typeof createDispatcher>["dispatcher"]) {
    const dir = await mkdtemp(join(tmpdir(), "taric-evidence-recorder-"))
    tempDirs.push(dir)
    return new TaricEvidenceRecorder({ dispatcher, policyDigest: POLICY_DIGEST, rootDir: dir })
}

function createDispatcher(options: { failObservation?: boolean } = {}) {
    const calls: Array<{ operation: string; request: Record<string, unknown>; principalRole?: string }> = []
    const proposals = new Map<string, string>()
    const records = new Map<string, string>()
    const dispatcher = mock(async (input: { operation: string; request: Record<string, unknown> }) => {
        calls.push(input)
        const key = typeof input.request.idempotency_key === "string" ? input.request.idempotency_key : ""
        if (input.operation === "proposal.submit") {
            if (options.failObservation && input.request.subject_type === "observation") {
                return { ok: false, error: { code: "unavailable", message: "observation unavailable" } }
            }
            const existing = proposals.get(key)
            if (existing) return { ok: true, data: { id: existing } }
            const id = input.request.subject_type === "resource" ? RESOURCE_PROPOSAL_ID : OBSERVATION_PROPOSAL_ID
            proposals.set(key, id)
            return { ok: true, data: { id } }
        }
        const proposalId = String(input.request.proposal_id)
        const existing = records.get(proposalId)
        if (existing) return { ok: true, data: { ok: true, record: { id: existing } } }
        const id = proposalId === RESOURCE_PROPOSAL_ID ? RESOURCE_ID : OBSERVATION_ID
        records.set(proposalId, id)
        return { ok: true, data: { ok: true, record: { id } } }
    })
    return { dispatcher, calls }
}

describe("Taric evidence recorder", () => {
    test("binds a checkpoint observation to a real resource and artifact hashes", async () => {
        const { dispatcher, calls } = createDispatcher()
        const recorder = await createRecorder(dispatcher)
        const result = await recorder.bind({
            engagementId: ENGAGEMENT_ID,
            checkpointId: "checkpoint-1",
            observedAt: "2026-10-24T01:02:03.000Z",
            completedSteps: ["captured admin response"],
            artifacts: [artifact()],
            target,
        })
        expect(result).toEqual({
            status: "bound",
            resourceRef: RESOURCE_ID,
            observationRef: OBSERVATION_ID,
            observationRefs: [OBSERVATION_ID],
            evidenceRefs: [OBSERVATION_ID],
        })
        expect(calls.map((call) => call.operation)).toEqual([
            "proposal.submit",
            "admission.evaluate",
            "proposal.submit",
            "admission.evaluate",
        ])
        expect(calls[0]?.principalRole).toBe("host")
        expect(calls[1]?.principalRole).toBe("operator")
        const observationContent = (calls[2]?.request.content ?? {}) as Record<string, unknown>
        expect(observationContent).toMatchObject({
            kind: "observation",
            resource_ref: RESOURCE_ID,
            observed_at: "2026-10-24T01:02:03.000Z",
        })
        expect(observationContent.statement).toContain(`sha256:${"a".repeat(64)}`)
        expect(JSON.stringify(observationContent)).not.toContain("raw response body")
    })

    test("skips without calling Taric when the checkpoint has no artifacts", async () => {
        const { dispatcher, calls } = createDispatcher()
        const recorder = await createRecorder(dispatcher)
        const result = await recorder.bind({
            engagementId: ENGAGEMENT_ID,
            checkpointId: "checkpoint-empty",
            completedSteps: [],
            artifacts: [],
            target,
        })
        expect(result.status).toBe("skipped")
        expect(calls).toHaveLength(0)
    })

    test("returns a gap instead of fabricating ids when recording fails", async () => {
        const { dispatcher } = createDispatcher({ failObservation: true })
        const recorder = await createRecorder(dispatcher)
        const result = await recorder.bind({
            engagementId: ENGAGEMENT_ID,
            checkpointId: "checkpoint-gap",
            completedSteps: ["step"],
            artifacts: [artifact()],
            target,
        })
        expect(result).toMatchObject({
            status: "gap",
            reason: "observation unavailable",
            observationRefs: [],
            evidenceRefs: [],
        })
    })

    test("reuses stable resource and observation idempotency keys on retry", async () => {
        const { dispatcher, calls } = createDispatcher()
        const input = {
            engagementId: ENGAGEMENT_ID,
            checkpointId: "checkpoint-retry",
            observedAt: "2026-10-24T01:02:03.000Z",
            completedSteps: ["step"],
            artifacts: [artifact()],
            target,
        }
        const dir = await mkdtemp(join(tmpdir(), "taric-evidence-retry-"))
        tempDirs.push(dir)
        const first = await new TaricEvidenceRecorder({ dispatcher, policyDigest: POLICY_DIGEST, rootDir: dir }).bind(input)
        const second = await new TaricEvidenceRecorder({ dispatcher, policyDigest: POLICY_DIGEST, rootDir: dir }).bind(input)
        expect(second).toEqual(first)
        const proposalKeys = calls
            .filter((call) => call.operation === "proposal.submit")
            .map((call) => call.request.idempotency_key)
        expect(proposalKeys).toHaveLength(3)
        expect(proposalKeys[1]).toBe(proposalKeys[2])
    })

    test("builds bounded, redacted statements without artifact bodies", () => {
        const statement = buildTaricObservationStatement({
            checkpointId: "checkpoint-secret",
            completedSteps: ["Authorization: Bearer abc123 " + "x".repeat(500)],
            artifacts: [artifact()],
        })
        expect(statement.length).toBeLessThanOrEqual(1_800)
        expect(statement).not.toContain("abc123")
        expect(statement).toContain("Raw artifact content was not copied")
    })
})
