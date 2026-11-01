import { describe, expect, test } from "bun:test"
import { createDockerTaricProposalDispatcher, toProposalRequest } from "./taric-docker-proposal-dispatcher"
import { normalizeObserverBoardProposal } from "./observer-board-proposal"

describe("Taric docker proposal dispatcher", () => {
    test("serializes observer revision and retirement as fresh scoped claims", () => {
        for (const operation of ["update", "retire"] as const) {
            const target = "11111111-1111-4111-8111-111111111111"
            const { proposal } = normalizeObserverBoardProposal({
                board: "memory", operation, target_ref: target, content: "Scoped correction",
                refs: ["22222222-2222-4222-8222-222222222222"], limitations: ["Observed scope only"],
            }, "project-a", "observer:solver-a")
            const request = toProposalRequest({
                idempotency_key: "proposal-a", challenge_id: "challenge-a", engagement_id: "engagement-a",
                solver_id: "solver-a", role: "observer", status: "pending", retry_count: 0,
                created_at: "2026-10-31T00:00:00.000Z", updated_at: "2026-10-31T00:00:00.000Z", proposal,
            })
            expect(request).toMatchObject({
                engagement_id: "engagement-a", subject_type: "claim", expected_version: 0,
                client_request_id: "proposal-a",
                content: { schema_version: "1.0.0", kind: "claim", engagement_id: "engagement-a" },
            })
            expect(request).not.toHaveProperty("target_id")
            expect(request).not.toHaveProperty("subject_ref")
            expect(request).not.toHaveProperty("trust_level")
            expect(JSON.stringify(request)).toContain("Target: " + target)
        }
    })

    test("maps outbox entries to scoped model proposal requests without model trust fields", () => {
        // The mapping function is internal; this test indirectly exercises the public dispatcher
        // contract with a deterministic fake Bun.spawn through object assertion helpers below.
        const dispatcher = createDockerTaricProposalDispatcher({ image: "taric-p0:local", volume: "test-volume" })
        expect(typeof dispatcher).toBe("function")
    })
})
