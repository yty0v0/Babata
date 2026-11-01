import { beforeEach, describe, expect, mock, test } from "bun:test"
import { CHALLENGE_ENV_TARIC_BINDING_ACTIVE } from "../../../challenge/env"

const localMemory = {
    id: "mem_local",
    challengeId: "board",
    kind: "fact" as const,
    content: "local fact",
    refs: [],
    source: "observer",
    created_at: "2026-04-12T00:00:00.000Z",
    updated_at: "2026-04-12T00:00:00.000Z",
}

const globalMemory = {
    id: "mem_global",
    challengeId: "chal-1",
    kind: "evidence" as const,
    content: "global evidence",
    refs: ["tool:curl"],
    source: "observer:solver-a",
    created_at: "2026-04-12T00:00:00.000Z",
    updated_at: "2026-04-12T00:00:00.000Z",
}

const localIdea = {
    id: "idea_local",
    content: "local idea",
    normalized: "local idea",
    status: "pending" as const,
    result: "",
    created_at: "2026-04-12T00:00:00.000Z",
    updated_at: "2026-04-12T00:00:00.000Z",
}

const globalIdea = {
    id: "idea_global",
    content: "global idea",
    normalized: "global idea",
    status: "testing" as const,
    result: "shared result",
    created_at: "2026-04-12T00:00:00.000Z",
    updated_at: "2026-04-12T00:00:00.000Z",
}

const appendSolverBoardMemory = mock(async () => localMemory)
const listSolverBoardMemory = mock(async () => [localMemory])
const updateSolverBoardMemory = mock(async () => localMemory)
const deleteSolverBoardMemory = mock(async () => localMemory)
const listSolverBoardIdeas = mock(async () => [localIdea])
const searchSolverBoardIdeas = mock(async () => [localIdea])
const addSolverBoardIdea = mock(async () => ({ created: true, item: localIdea }))
const updateSolverBoardIdea = mock(async () => localIdea)

const requestHostBridge = mock(async (action: string): Promise<Record<string, unknown>> => {
    switch (action) {
        case "challenge_memory_list":
            return { items: [globalMemory] }
        case "challenge_memory_add":
            return { entry: globalMemory }
        case "challenge_idea_list":
            return { items: [globalIdea] }
        case "challenge_idea_search":
            return { items: [globalIdea] }
        case "challenge_idea_add":
            return { created: true, item: globalIdea }
        default:
            return {}
    }
})

mock.module("../../board-store", () => ({
    appendSolverBoardMemory,
    listSolverBoardMemory,
    updateSolverBoardMemory,
    deleteSolverBoardMemory,
    listSolverBoardIdeas,
    searchSolverBoardIdeas,
    addSolverBoardIdea,
    updateSolverBoardIdea,
}))

mock.module("../../../challenge/host-bridge-client", () => ({
    requestHostBridge,
}))

const { createObserverSidecarToolsWithOptions, challengeObserverAgentTools } = await import("./tools")

interface TestTool {
    name: string
    execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal?: AbortSignal,
        onUpdate?: unknown,
        ctx?: unknown,
    ) => Promise<{ content: Array<{ type: string; text: string }>; details: Record<string, unknown> }>
}

function getTool(name: string): TestTool {
    const tool = (createObserverSidecarToolsWithOptions() as unknown as TestTool[]).find((item) => item.name === name)
    if (!tool) throw new Error(`tool not found: ${name}`)
    return tool
}

beforeEach(() => {
    appendSolverBoardMemory.mockClear()
    listSolverBoardMemory.mockClear()
    updateSolverBoardMemory.mockClear()
    deleteSolverBoardMemory.mockClear()
    listSolverBoardIdeas.mockClear()
    searchSolverBoardIdeas.mockClear()
    addSolverBoardIdea.mockClear()
    updateSolverBoardIdea.mockClear()
    requestHostBridge.mockClear()
})

describe("challenge observer board tools", () => {
    test("memory_list returns solver local and challenge global layers", async () => {
        const tool = getTool("memory_list")

        const result = await tool.execute("tool-1", {})

        expect(requestHostBridge).toHaveBeenCalledWith("challenge_memory_list", {})
        expect(result.content[0].text).toContain("## Solver Local Memory")
        expect(result.content[0].text).toContain("mem_local")
        expect(result.content[0].text).toContain("## Challenge Memory")
        expect(result.content[0].text).toContain("mem_global")
    })

    test("memory_list marks incomplete challenge reads instead of presenting an empty authoritative layer", async () => {
        requestHostBridge.mockImplementationOnce(async () => ({ items: [], read_diagnostics: { status: "truncated", diagnostic_code: "max_pages" } }))
        const tool = getTool("memory_list")

        const result = await tool.execute("tool-1", {})

        expect(result.content[0].text).toContain("WARNING: challenge board read is truncated")
        expect(result.content[0].text).toContain("max_pages")
        expect(result.details.challenge_read_diagnostics).toMatchObject({ status: "truncated", diagnostic_code: "max_pages" })
    })

    test("idea_list returns solver local and challenge global layers", async () => {
        const tool = getTool("idea_list")

        const result = await tool.execute("tool-1", {})

        expect(requestHostBridge).toHaveBeenCalledWith("challenge_idea_list", {})
        expect(result.content[0].text).toContain("## Solver Local Ideas")
        expect(result.content[0].text).toContain("idea_local")
        expect(result.content[0].text).toContain("## Challenge Ideas")
        expect(result.content[0].text).toContain("idea_global")
    })
    test("only observer exposes proposal tools, regardless of binding; solver stays read-only", () => {
        const previous = process.env[CHALLENGE_ENV_TARIC_BINDING_ACTIVE]
        try {
            for (const active of ["0", "1"]) {
                process.env[CHALLENGE_ENV_TARIC_BINDING_ACTIVE] = active
                const names = createObserverSidecarToolsWithOptions().map((tool) => tool.name).sort()
                expect(names).toEqual(["idea_add", "idea_list", "idea_search", "idea_update", "memory_add", "memory_delete", "memory_list", "memory_update", "query_solver_history", "send_efficiency_reminder", "taric_board_query"])
                expect(challengeObserverAgentTools.map((tool) => tool.name).sort()).toEqual(["idea_list", "idea_search", "memory_list"])
            }
            expect(appendSolverBoardMemory).not.toHaveBeenCalled()
            expect(updateSolverBoardMemory).not.toHaveBeenCalled()
            expect(deleteSolverBoardMemory).not.toHaveBeenCalled()
            expect(addSolverBoardIdea).not.toHaveBeenCalled()
            expect(updateSolverBoardIdea).not.toHaveBeenCalled()
        } finally {
            if (previous === undefined) delete process.env[CHALLENGE_ENV_TARIC_BINDING_ACTIVE]
            else process.env[CHALLENGE_ENV_TARIC_BINDING_ACTIVE] = previous
        }
    })

    test("idea_search keeps local and challenge evidence available", async () => {
        const result = await getTool("idea_search").execute("search", { query: "upload" })
        expect(searchSolverBoardIdeas).toHaveBeenCalledWith("upload")
        expect(requestHostBridge).toHaveBeenCalledWith("challenge_idea_search", { query: "upload" })
        expect(result.content[0].text).toContain("idea_local")
        expect(result.content[0].text).toContain("idea_global")
    })

    test("missing reminder callback reports undelivered", async () => {
        const result = await getTool("send_efficiency_reminder").execute("reminder", { message: "Check the response before concluding." })
        expect(result.details.delivered).toBe(false)
        expect(result.content[0].text).toContain("suppressed")
    })

    test("reminder delivery respects host acceptance and suppression", async () => {
        for (const accepted of [true, false]) {
            const sendCorrectionNotice = mock(async (_message: string) => accepted)
            const tools = createObserverSidecarToolsWithOptions({ sendCorrectionNotice }) as unknown as TestTool[]
            const tool = tools.find((item) => item.name === "send_efficiency_reminder")!
            const result = await tool.execute("reminder", { message: "Repeated requests added no evidence; compare the response." })
            expect(sendCorrectionNotice).toHaveBeenCalledTimes(1)
            expect(result.details.delivered).toBe(accepted)
            expect(requestHostBridge).not.toHaveBeenCalled()
        }
    })

    test("history review pages solver entries instead of observer messages", async () => {
        const getSolverEntries = mock(() => [
            { id: "user-1", type: "message", message: { role: "user", content: [{ type: "text", text: "Check upload scope" }] } },
            { id: "assistant-1", type: "message", message: { role: "assistant", content: [{ type: "text", text: "Verify upload response" }] } },
            { id: "tool-1", type: "message", message: { role: "toolResult", toolName: "http", content: [{ type: "text", text: "HTTP 403" }] } },
        ])
        const tools = createObserverSidecarToolsWithOptions({ getSolverEntries }) as unknown as TestTool[]
        const tool = tools.find((item) => item.name === "query_solver_history")!
        const result = await tool.execute("history", { offset: 1, limit: 1 }, undefined, undefined, {
            sessionManager: { getEntries: () => { throw new Error("observer history must not be read") } },
        })
        expect(result.details).toMatchObject({ total_entries: 3, returned_count: 1 })
        expect(result.content[0].text).toContain("Verify upload response")
        expect(result.content[0].text).not.toContain("Check upload scope")
    })
    test("all observer curation operations submit only host-validated Taric candidates", async () => {
        const refs = ["5eee9386-a285-70b9-8ce5-995fafcc348c"]
        const target = "3e8a43c3-76d2-7070-9185-7b83cae723cd"
        const limitations = ["Only this request and identity; other branches remain untested"]
        for (const [name, params, expected] of [
            ["memory_add", { kind: "fact", content: "Observed HTTP status", refs, limitations }, { board: "memory", operation: "add", memory_kind: "fact" }],
            ["memory_update", { id: target, kind: "failure", content: "Only payload A failed", refs, limitations }, { board: "memory", operation: "update", target_ref: target }],
            ["memory_delete", { id: target, reason: "Superseded by the new scoped observation", refs, limitations }, { board: "memory", operation: "retire", target_ref: target }],
            ["idea_add", { content: "Test upload handling", refs, limitations }, { board: "idea", operation: "add" }],
            ["idea_update", { id: target, content: "Anonymous upload execution", status: "failed", result: "Served as text for this file type", refs, limitations }, { board: "idea", operation: "update", target_ref: target }],
        ] as const) {
            requestHostBridge.mockResolvedValueOnce({ proposal_id: target, status: "pending", candidate_only: true, canonical_changed: false })
            const result = await getTool(name).execute(name, params)
            expect(result.details).toMatchObject({ submitted: true, candidate_only: true, canonical_changed: false, proposal_id: target })
            expect(result.content[0]?.text).toContain("original board record is unchanged")
            expect(requestHostBridge.mock.calls.at(-1)?.[0]).toBe("taric_proposal_submit")
            expect((requestHostBridge.mock.calls.at(-1) as unknown[])[1]).toMatchObject({ observer_board_change: expected })
        }
        expect(appendSolverBoardMemory).not.toHaveBeenCalled()
        expect(updateSolverBoardMemory).not.toHaveBeenCalled()
        expect(deleteSolverBoardMemory).not.toHaveBeenCalled()
        expect(addSolverBoardIdea).not.toHaveBeenCalled()
        expect(updateSolverBoardIdea).not.toHaveBeenCalled()
        expect(requestHostBridge.mock.calls.some((call) => ["challenge_memory_add", "challenge_idea_add"].includes(call[0]))).toBe(false)
    })

    test("unavailable or unconfirmed host submission never claims a board change", async () => {
        const params = { kind: "fact", content: "Observed result", refs: ["5eee9386-a285-70b9-8ce5-995fafcc348c"], limitations: ["One request"] }
        for (const response of [{ degraded: true, reason: "taric_proposal_disabled" }, {}, { proposal_id: "candidate", status: "failed", candidate_only: true, canonical_changed: false }]) {
            requestHostBridge.mockResolvedValueOnce(response)
            const result = await getTool("memory_add").execute("proposal", params)
            expect(result.details).toMatchObject({ submitted: false, canonical_changed: false })
            expect(result.content[0]?.text).toContain("No canonical change or local fallback")
        }
        requestHostBridge.mockRejectedValueOnce(new Error("host offline"))
        const failed = await getTool("memory_add").execute("offline", params)
        expect(failed.details.submitted).toBe(false)
        expect(failed.content[0]?.text).toContain("host offline")
        expect(appendSolverBoardMemory).not.toHaveBeenCalled()
    })

    test("fabricated references fail before host submission", async () => {
        const result = await getTool("idea_add").execute("invalid", { content: "Test route", refs: ["tool:curl"], limitations: ["Untested"] })
        expect(result.details.submitted).toBe(false)
        expect(requestHostBridge).not.toHaveBeenCalled()
    })

    test("Taric evidence reads are bounded and preserve degraded results", async () => {
        requestHostBridge.mockResolvedValueOnce({ degraded: true, reason: "taric_read_board_unavailable" })
        const result = await getTool("taric_board_query").execute("evidence", { operation: "evidence.query" })
        expect(requestHostBridge).toHaveBeenCalledWith("taric_board_query", { operation: "evidence.query", page_size: 10, budget: 20 })
        expect(result.content[0]?.text).toContain("taric_read_board_unavailable")
    })

    test("uses a Taric context budget accepted by the context-pack contract", async () => {
        requestHostBridge.mockResolvedValueOnce({ records: [], read_seq: 1 })
        const result = await getTool("taric_board_query").execute("context", { operation: "context.query" })
        expect(requestHostBridge).toHaveBeenCalledWith("taric_board_query", { operation: "context.query", page_size: 10, budget: 4000 })
        expect(result.details).toBeDefined()
    })

})
