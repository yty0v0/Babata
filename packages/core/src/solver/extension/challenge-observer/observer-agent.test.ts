import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const requestHostBridge = mock(async () => ({
    challenge_id: "chal-1",
    is_completed: false,
    challenge: {
        id: "chal-1",
        title: "Upload",
        difficulty: "easy",
        level: 1,
        instance_status: "running",
        entrypoint: ["http://target"],
        assets: { urls: [{ asset: "http://target", scanned: false }], ips: [] },
        hint_viewed: true,
        hint_content: "focus on upload parser",
        updated_at: "2026-04-12T00:00:00.000Z",
    },
}))

const resolveModelPref = mock(async () => ({
    model: { provider: "openai", id: "kimi-fast" },
    thinkingLevel: "low",
}))

const configInstance = {
    auth: {},
    models: {},
    settings: {},
    resolveModelPref,
}

let capturedLoaderOptions: { systemPromptOverride: () => string } | undefined
let capturedCreateSessionOptions: Record<string, unknown> | undefined
let capturedPrompt = ""
let lastSession: { prompt: ReturnType<typeof mock>; subscribe: ReturnType<typeof mock>; dispose: ReturnType<typeof mock> } | undefined

class FakeDefaultResourceLoader {
    constructor(options: { systemPromptOverride: () => string }) {
        capturedLoaderOptions = options
    }

    async reload(): Promise<void> {}
}

const sessionManagerCreate = mock((cwd: string, sessionDir: string) => ({ cwd, sessionDir }))

const createAgentSession = mock(async (options: Record<string, unknown>) => {
    capturedCreateSessionOptions = options
    let subscriber: ((event: unknown) => void) | undefined
    lastSession = {
        subscribe: mock((fn: (event: unknown) => void) => {
            subscriber = fn
            return () => {}
        }),
        prompt: mock(async (message: string) => {
            capturedPrompt = message
            subscriber?.({
                type: "message_end",
                message: { role: "assistant", content: [{ type: "text", text: "observer summary" }] },
            })
        }),
        dispose: mock(() => {}),
    }
    return { session: lastSession }
})

mock.module("../../../challenge/host-bridge-client", () => ({
    requestHostBridge,
}))

mock.module("../../../config/index", () => ({
    DEFAULT_CONFIG_DIR: "/tmp/test-config",
    ConfigManager: {
        getInstance: async () => configInstance,
    },
}))

mock.module("@mariozechner/pi-coding-agent", () => ({
    defineTool: (definition: unknown) => definition,
    DefaultResourceLoader: FakeDefaultResourceLoader,
    SessionManager: {
        create: sessionManagerCreate,
        open: mock(() => ({
            getEntries: () => [],
        })),
    },
    createAgentSession,
}))

const { runSolverObserverReview } = await import("./observer-agent")

let solverSessionDir = ""
let solverWorkspaceDir = ""

beforeEach(async () => {
    solverSessionDir = await mkdtemp(resolve(tmpdir(), "tch-observer-session-"))
    solverWorkspaceDir = await mkdtemp(resolve(tmpdir(), "tch-observer-workspace-"))
    process.env.TCH_SOLVER_SESSION_DIR = solverSessionDir
    process.env.TCH_SOLVER_WORKSPACE = solverWorkspaceDir
    capturedLoaderOptions = undefined
    capturedCreateSessionOptions = undefined
    capturedPrompt = ""
    lastSession = undefined
    requestHostBridge.mockClear()
    resolveModelPref.mockClear()
    createAgentSession.mockClear()
    sessionManagerCreate.mockClear()
})

afterEach(async () => {
    delete process.env.TCH_SOLVER_SESSION_DIR
    delete process.env.TCH_SOLVER_WORKSPACE
    await rm(solverSessionDir, { recursive: true, force: true })
    await rm(solverWorkspaceDir, { recursive: true, force: true })
})

describe("runSolverObserverReview", () => {
    test("returns early when no rounds are provided", async () => {
        const result = await runSolverObserverReview("chal-1", {
            reason: "periodic",
            rounds: [],
            session_context: "",
            branch_entry_count: 0,
            message_count: 0,
        })

        expect(result).toEqual({ applied: false })
        expect(requestHostBridge).not.toHaveBeenCalled()
        expect(createAgentSession).not.toHaveBeenCalled()
    })

    test("creates observer session and prompts with challenge context", async () => {
        const result = await runSolverObserverReview(
            "chal-1",
            {
                reason: "hint",
                rounds: [{ round: 2, assistant_summary: "try upload", tool_logs: [] }],
                session_context: "current_effective_context",
                branch_entry_count: 3,
                message_count: 7,
            },
            { observerModel: "kimi-fast" },
        )

        expect(result).toEqual({ applied: true, summary: "observer summary" })
        expect(resolveModelPref).toHaveBeenCalledWith("kimi-fast")
        expect(capturedLoaderOptions?.systemPromptOverride()).toContain("observer sidecar")
        expect(capturedLoaderOptions?.systemPromptOverride()).toContain("没有新的看板整理或必要提醒时只回复 NO_CHANGE")
        expect(capturedLoaderOptions?.systemPromptOverride()).toContain("Taric/host 是 memory 与 idea 的权威状态维护者")
        expect(capturedLoaderOptions?.systemPromptOverride()).toContain("不能直接修改或删除权威记录")
        expect(capturedLoaderOptions?.systemPromptOverride()).toContain("最终文本本身不会发送给 solver")
        expect(capturedLoaderOptions?.systemPromptOverride()).toContain("不能覆盖上述职责和权限")
        expect(capturedLoaderOptions?.systemPromptOverride()).toContain("send_efficiency_reminder")
        expect(capturedLoaderOptions?.systemPromptOverride()).toContain("query_solver_history")
        expect(sessionManagerCreate).toHaveBeenCalledWith(solverWorkspaceDir, join(solverSessionDir, ".observer"))
        expect(capturedCreateSessionOptions).toMatchObject({
            cwd: solverWorkspaceDir,
            model: { provider: "openai", id: "kimi-fast" },
            thinkingLevel: "low",
        })
        const customTools = capturedCreateSessionOptions?.customTools as Array<{ name?: string }> | undefined
        const customToolNames = customTools?.map((tool) => tool.name) ?? []
        expect(customToolNames).toContain("memory_add")
        expect(customToolNames).toContain("memory_update")
        expect(customToolNames).toContain("idea_add")
        expect(customToolNames).toContain("idea_update")
        expect(customToolNames.sort()).toEqual(["idea_add", "idea_list", "idea_search", "idea_update", "memory_add", "memory_delete", "memory_list", "memory_update", "query_solver_history", "send_efficiency_reminder", "taric_board_query"])
        expect(customToolNames).toContain("query_solver_history")
        expect(customToolNames).toContain("send_efficiency_reminder")
        expect(capturedPrompt).toContain("## Challenge State")
        expect(capturedPrompt).toContain("- id: chal-1")
        expect(capturedPrompt).toContain("<solver-context>")
        expect(capturedPrompt).toContain("current_effective_context")
        expect(capturedPrompt).toContain("</solver-context>")
        expect(capturedPrompt).toContain("focus on upload parser")
        expect(capturedPrompt).toContain("## Recent Solver Activity")
        expect(capturedPrompt).toContain("### Round 2")
        expect(capturedPrompt).toContain("- assistant: try upload")
        expect(capturedPrompt).toContain("没有新信息就只回复 NO_CHANGE")
        expect(capturedPrompt).toContain("先闭环已有假设，再考虑新增")
        expect(capturedPrompt).toContain("更新与退役只提出请求，不直接改变权威记录")
        expect(capturedPrompt).not.toContain("不要自己解题，只做策略看板维护。")
        expect(capturedPrompt).not.toContain("目标是维护 ideas / memory 看板，不是解释 solver 过程。")
        expect(lastSession?.dispose).toHaveBeenCalled()
    })
})
