import { describe, expect, test } from "bun:test"
import { normalizeObserverBoardProposal, parseObserverBoardChange } from "./observer-board-proposal"

const evidence = "5eee9386-a285-70b9-8ce5-995fafcc348c"
const target = "3e8a43c3-76d2-7070-9185-7b83cae723cd"
const memory = { board: "memory", operation: "add", memory_kind: "failure", content: "Payload A returned 403 with the anonymous identity", refs: [evidence], limitations: ["Only payload A; other payloads and identities are untested"] }

describe("observer board candidate validation", () => {
    test("normalizes durable evidence and host project title without authority fields", () => {
        const { change, proposal } = normalizeObserverBoardProposal({ ...memory, refs: [evidence.toUpperCase(), evidence] }, "project-a", "observer:solver-a")
        expect(change.refs).toEqual([evidence])
        expect(proposal).toMatchObject({ kind: "claim", subject_type: "claim", expected_version: 0 })
        expect(proposal.content).toMatchObject({ title: "BreachWeave [project-a] memory (failure): observer:solver-a", status: "proposed", evidence_refs: [evidence] })
        expect(proposal.content.proposition).toBe(memory.content)
        expect(proposal.target_id).toBeUndefined()
        expect(proposal.content).not.toHaveProperty("trust_level")
    })

    test("idea closure remains a candidate assessment with a stable target reference", () => {
        const { proposal } = normalizeObserverBoardProposal({ board: "idea", operation: "update", target_ref: target, content: "Anonymous upload execution", status: "failed", result: "The uploaded file was served as text", refs: [evidence], limitations: ["Only the tested file extension and handler"] }, "project-a", "observer:solver-a")
        expect(proposal.content.title).toBe("BreachWeave [project-a] idea: Anonymous upload execution")
        expect(proposal.content.proposition).toContain(target)
        expect(proposal.content.proposition).toContain("Requested idea status (not authoritative): failed")
        expect(proposal.content.status).toBe("proposed")
        expect(proposal.expected_version).toBe(0)
        expect(proposal.target_id).toBeUndefined()
        expect(proposal.subject_ref).toBeUndefined()
    })

    test("retirement is an immutable note request rather than a delete", () => {
        const { proposal } = normalizeObserverBoardProposal({ ...memory, operation: "retire", target_ref: target }, "project-a", "observer:solver-a")
        expect(proposal.content.title).toContain("memory (note)")
        expect(proposal.content.proposition).toContain("retire request")
        expect(proposal.content.proposition).toContain("target remains unchanged")
    })

    for (const [name, patch] of Object.entries({
        "invented references": { refs: ["tool:curl"] },
        "no evidence": { refs: [] },
        "unscoped conclusion": { limitations: [] },
        "blank content": { content: "  " },
        "fake target": { operation: "update", target_ref: "mem_local" },
        "target on create": { target_ref: target },
        "missing update target": { operation: "update" },
        "model project": { project_key: "other-project" },
        "model trust": { trust_level: "L2" },
        "model version": { expected_version: 8 },
        "model engagement": { engagement_id: target },
        "unknown operation": { operation: "delete" },
        "wrong memory kind type": { memory_kind: ["fact"] },
        "idea fields on memory": { status: "verified" },
    })) {
        test("rejects " + name, () => {
            expect(() => parseObserverBoardChange({ ...memory, ...patch })).toThrow()
        })
    }

    test("resolved ideas require a result and cannot be retired through a hidden delete", () => {
        const idea = { board: "idea", operation: "add", content: "Test upload handling", refs: [evidence], limitations: ["Unverified"] }
        expect(parseObserverBoardChange(idea).board).toBe("idea")
        expect(() => parseObserverBoardChange({ ...idea, status: "verified" })).toThrow("result")
        expect(() => parseObserverBoardChange({ ...idea, operation: "update", target_ref: target })).toThrow("result")
        expect(() => parseObserverBoardChange({ ...idea, operation: "retire", target_ref: target })).toThrow("retire ideas")
    })
})
