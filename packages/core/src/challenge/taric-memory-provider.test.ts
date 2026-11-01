import { describe, expect, test } from "bun:test"
import { deriveCompositeProjectKey } from "../project/types"
import type { TaricHostBinding, TaricHostModule } from "../taric"
import { TaricMemoryProvider } from "./taric-memory-provider"
import { normalizeObserverBoardProposal } from "./observer-board-proposal"

const project = {
    mode: "competition" as const,
    provider: "local_practice" as const,
    tenant_id: "tenant-a",
    platform_id: "platform-a",
    competition_id: "competition-a",
    team_id: "team-a",
    challenge_code: "challenge-a",
    memory_mode: "taric_best_effort" as const,
    taric_engagement_id: "engagement-a",
}
const projectKey = deriveCompositeProjectKey(project)
const binding: TaricHostBinding = {
    projectId: projectKey,
    tenantId: project.tenant_id,
    engagementId: project.taric_engagement_id,
    hostPrincipalId: "host",
    modelPrincipalId: "model",
}
const scope = { challengeId: "challenge-a", project, projectKey }

type Page = { read_seq: number; next_cursor?: string; proposals?: unknown[]; records?: unknown[] }
function hostWith(pages: { proposal: Page[]; resource: Page[] }): TaricHostModule {
    let proposalIndex = 0
    let resourceIndex = 0
    return {
        getBinding: () => binding,
        initialize: async () => ({ status: "healthy" }),
        assertAvailable: () => undefined,
        invokeHost: async (operation: string) => {
            if (operation !== "proposal.list") throw new Error(`unexpected operation ${operation}`)
            return { ok: true, data: pages.proposal[proposalIndex++] }
        },
        query: async () => ({ ok: true, data: pages.resource[resourceIndex++] }),
    } as unknown as TaricHostModule
}

describe("TaricMemoryProvider bounded read adapter", () => {
    test("reads authoritative and candidate pages with a shared watermark and suppresses duplicate ids", async () => {
        const duplicate = { id: "claim-1", title: `BreachWeave [${projectKey}] memory (fact): seed`, proposition: "stored fact", engagement_id: "engagement-a" }
        const host = hostWith({
            proposal: [{ read_seq: 9, proposals: [{ id: "proposal-1", subject_type: "claim", content: { ...duplicate, proposition: "candidate fact" }, engagement_id: "engagement-a" }] }],
            resource: [{ read_seq: 9, records: [duplicate, duplicate] }],
        })
        const provider = new TaricMemoryProvider({ host, mode: "taric_best_effort" })
        const board = await provider.readBoard(scope)
        expect(board.memory.map((item) => [item.content, item.trustState])).toEqual([
            ["stored fact", "admitted"],
            ["candidate fact", "candidate"],
        ])
        expect(board.diagnostics).toMatchObject({ status: "complete", watermark: 9, canonical: { duplicatesSuppressed: 1 } })
    })

    test("projects observer curation candidates without mutating the canonical target or promoting idea status", async () => {
        const targetId = "11111111-1111-4111-8111-111111111111"
        const evidenceId = "22222222-2222-4222-8222-222222222222"
        const common = { content: "Scoped observation", refs: [evidenceId], limitations: ["Only the observed request is covered"] }
        const changes = [
            { ...common, board: "memory", operation: "add", memory_kind: "fact" },
            { ...common, board: "memory", operation: "update", memory_kind: "failure", target_ref: targetId },
            { ...common, board: "memory", operation: "retire", target_ref: targetId },
            { ...common, board: "idea", operation: "update", target_ref: targetId, status: "failed", result: "The observed payload was rejected" },
        ]
        const proposals = changes.map((change, index) => ({
            id: "candidate-" + index,
            subject_type: "claim",
            status: "pending",
            engagement_id: "engagement-a",
            content: normalizeObserverBoardProposal(change, projectKey, "observer:solver-a").proposal.content,
        }))
        proposals.push({
            ...proposals[0]!, id: "outside-project",
            content: normalizeObserverBoardProposal(changes[0], "other-project", "observer:solver-a").proposal.content,
        })
        const original = { id: targetId, title: "BreachWeave [" + projectKey + "] memory (fact): seed", proposition: "Original admitted fact", evidence_refs: [evidenceId], engagement_id: "engagement-a" }
        const provider = new TaricMemoryProvider({
            host: hostWith({ proposal: [{ read_seq: 8, proposals }], resource: [{ read_seq: 8, records: [original] }] }),
            mode: "taric_required",
        })
        const board = await provider.readBoard(scope)
        expect(board.memory).toHaveLength(4)
        expect(board.memory.find((item) => item.id === targetId)).toMatchObject({ content: "Original admitted fact", trustState: "admitted" })
        expect(board.memory.filter((item) => item.trustState === "candidate").map((item) => item.kind)).toEqual(["fact", "failure", "note"])
        expect(board.memory.find((item) => item.id === "candidate-1")?.content).toContain("Target: " + targetId)
        expect(board.memory.find((item) => item.id === "candidate-2")?.content).toContain("target remains unchanged")
        expect(board.ideas).toHaveLength(1)
        expect(board.ideas[0]).toMatchObject({ status: "pending", trustState: "candidate" })
        expect(board.ideas[0]?.content).toContain("Requested idea status (not authoritative): failed")
        expect(original.proposition).toBe("Original admitted fact")
    })

    test("rejects missing or mismatched trusted project binding rather than querying a default scope", async () => {
        const host = hostWith({ proposal: [], resource: [] })
        const provider = new TaricMemoryProvider({ host, mode: "taric_required" })
        await expect(provider.readBoard({ challengeId: "challenge-a" })).rejects.toThrow("validated composite project scope")
        await expect(provider.readBoard({ ...scope, projectKey: "other" as typeof projectKey })).rejects.toThrow("does not match the host-bound project")
    })

    test("fails the combined read when read_seq drifts between candidate and canonical projections", async () => {
        const provider = new TaricMemoryProvider({
            host: hostWith({
                proposal: [{ read_seq: 9, proposals: [] }],
                resource: [{ read_seq: 10, records: [] }],
            }),
            mode: "taric_required",
        })
        await expect(provider.readBoard(scope)).rejects.toThrow("changed read_seq")
        expect(provider.getReadDiagnostics()).toMatchObject({ status: "failed", watermark: 9 })
    })

    test("rejects records without stable identity instead of silently dropping them", async () => {
        const provider = new TaricMemoryProvider({
            host: hostWith({
                proposal: [{ read_seq: 1, proposals: [] }],
                resource: [{ read_seq: 1, records: [{ title: "missing id" }] }],
            }),
            mode: "taric_required",
        })
        await expect(provider.readBoard(scope)).rejects.toThrow("without an id")
    })
    test("bounds pagination and reports a safe max-pages continuation", async () => {
        const provider = new TaricMemoryProvider({
            host: hostWith({
                proposal: [
                    { read_seq: 3, proposals: [], next_cursor: "p1" },
                    { read_seq: 3, proposals: [] },
                ],
                resource: [
                    { read_seq: 3, records: [], next_cursor: "r1" },
                    { read_seq: 3, records: [], next_cursor: "r2" },
                ],
            }),
            mode: "taric_required",
            readLimits: { maxPages: 2 },
        })
        await provider.readBoard(scope)
        expect(provider.getReadDiagnostics()).toMatchObject({
            status: "truncated",
            canonical: { status: "truncated", truncationReason: "max_pages", hasMore: true, continuationSafe: true },
        })
    })

    test("rejects repeated and oversized continuation cursors", async () => {
        const repeated = new TaricMemoryProvider({
            host: hostWith({
                proposal: [{ read_seq: 1, proposals: [], next_cursor: "same" }, { read_seq: 1, proposals: [], next_cursor: "same" }],
                resource: [],
            }),
            mode: "taric_required",
        })
        await expect(repeated.readBoard(scope)).rejects.toThrow("repeated a continuation cursor")

        const oversized = new TaricMemoryProvider({
            host: hostWith({ proposal: [{ read_seq: 1, proposals: [], next_cursor: "x".repeat(513) }], resource: [] }),
            mode: "taric_required",
        })
        await expect(oversized.readBoard(scope)).rejects.toThrow("invalid continuation cursor")
    })

    test("turns a stalled Taric read into a typed timeout failure", async () => {
        const host = hostWith({ proposal: [{ read_seq: 1, proposals: [] }], resource: [] })
        host.invokeHost = async () => new Promise(() => {})
        const provider = new TaricMemoryProvider({
            host,
            mode: "taric_required",
            readLimits: { requestTimeoutMs: 100, deadlineMs: 500 },
        })
        await expect(provider.readBoard(scope)).rejects.toThrow("read timed out")
        expect(provider.getReadDiagnostics()).toMatchObject({ status: "failed", candidates: { errorCode: "timeout" } })
    })

})
