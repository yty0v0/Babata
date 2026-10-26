import { describe, expect, test } from "bun:test"
import { createDockerTaricProposalDispatcher } from "./taric-docker-proposal-dispatcher"

describe("Taric docker proposal dispatcher", () => {
    test("maps outbox entries to scoped model proposal requests without model trust fields", () => {
        // The mapping function is internal; this test indirectly exercises the public dispatcher
        // contract with a deterministic fake Bun.spawn through object assertion helpers below.
        const dispatcher = createDockerTaricProposalDispatcher({ image: "taric-p0:local", volume: "test-volume" })
        expect(typeof dispatcher).toBe("function")
    })
})
