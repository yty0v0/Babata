import { describe, expect, test } from "bun:test"
import { formatIdeaTable, formatMemoryTable } from "./board-format"
import type { IdeaRecord, MemoryEntry } from "../../../challenge/memory"

const memory: MemoryEntry = { id: "memory-1", challengeId: "challenge-1", kind: "fact", content: "Observed response", refs: [], source: "taric:candidate", trustState: "candidate", created_at: "2026-10-31", updated_at: "2026-10-31" }
const idea: IdeaRecord = { id: "idea-1", content: "Check handler", normalized: "check handler", status: "pending", result: "", trustState: "candidate", created_at: "2026-10-31", updated_at: "2026-10-31" }

describe("observer board trust presentation", () => {
    test("memory and idea tables explicitly label candidates and admitted records", () => {
        const memories = formatMemoryTable([memory, { ...memory, id: "memory-2", trustState: "admitted" }])
        const ideas = formatIdeaTable([idea, { ...idea, id: "idea-2", trustState: "admitted" }])
        for (const table of [memories, ideas]) {
            expect(table).toContain("Trust")
            expect(table).toContain("candidate")
            expect(table).toContain("admitted")
        }
    })

    test("legacy status does not imply Taric admission and markdown remains escaped", () => {
        const table = formatIdeaTable([{ ...idea, trustState: undefined, content: "A|B\nC" }])
        expect(table).toContain("legacy/unclassified")
        expect(table).toContain("A\\|B<br>C")
        expect(table).not.toContain("admitted")
    })
})
