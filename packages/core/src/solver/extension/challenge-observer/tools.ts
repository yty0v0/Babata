import { defineTool } from "@mariozechner/pi-coding-agent"
import type { Static } from "@sinclair/typebox"
import { Type } from "@sinclair/typebox"
import type { IdeaRecord, MemoryEntry } from "../../../challenge/memory"
import { requestHostBridge } from "../../../challenge/host-bridge-client"
import { parseObserverBoardChange } from "../../../challenge/observer-board-proposal"
import type { ObserverBoardChange } from "../../../challenge/observer-board-proposal"
import { listSolverBoardIdeas, listSolverBoardMemory, searchSolverBoardIdeas } from "../../board-store"
import { formatIdeaTable, formatMemoryTable } from "./board-format"

const EmptyParams = Type.Object({})
const ideaSearchToolParams = Type.Object({
    query: Type.String(),
})

const querySolverHistoryToolParams = Type.Object({
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
})

const steerToolParams = Type.Object({
    message: Type.String({ minLength: 1 }),
})

type IdeaSearchToolInput = Static<typeof ideaSearchToolParams>
type QuerySolverHistoryToolInput = Static<typeof querySolverHistoryToolParams>
type SteerToolInput = Static<typeof steerToolParams>

function clipText(value: string, maxChars: number): string {
    const text = value.trim()
    if (text.length <= maxChars) return text
    return `${text.slice(0, maxChars)}...`
}

function formatLayeredMemoryTable(localItems: MemoryEntry[], challengeItems: MemoryEntry[]): string {
    return [
        "## Solver Local Memory",
        formatMemoryTable(localItems),
        "",
        "## Challenge Memory",
        formatMemoryTable(challengeItems, { updatedAtFallback: true }),
    ].join("\n")
}

function formatLayeredIdeaTable(localItems: IdeaRecord[], challengeItems: IdeaRecord[]): string {
    return [
        "## Solver Local Ideas",
        formatIdeaTable(localItems),
        "",
        "## Challenge Ideas",
        formatIdeaTable(challengeItems, { updatedAtFallback: true }),
    ].join("\n")
}

interface ChallengeLayerRead<T> {
    items: T[]
    diagnostics?: { status?: string; diagnostic_code?: string; diagnosticCode?: string }
}

function challengeReadNotice(diagnostics?: ChallengeLayerRead<unknown>["diagnostics"]): string {
    if (!diagnostics || diagnostics.status === "complete") return ""
    const code = diagnostics.diagnostic_code ?? diagnostics.diagnosticCode
    return `\n\n> WARNING: challenge board read is ${diagnostics.status ?? "degraded"}; results may be incomplete${code ? ` (${code})` : ""}.`
}

async function listChallengeMemoryLayer(): Promise<ChallengeLayerRead<MemoryEntry>> {
    try {
        const result = await requestHostBridge<{ items: MemoryEntry[]; read_diagnostics?: ChallengeLayerRead<unknown>["diagnostics"] }>("challenge_memory_list", {})
        return { items: Array.isArray(result.items) ? result.items : [], diagnostics: result.read_diagnostics }
    } catch {
        return { items: [], diagnostics: { status: "failed", diagnostic_code: "host_bridge_read_failed" } }
    }
}

async function listChallengeIdeaLayer(): Promise<ChallengeLayerRead<IdeaRecord>> {
    try {
        const result = await requestHostBridge<{ items: IdeaRecord[]; read_diagnostics?: ChallengeLayerRead<unknown>["diagnostics"] }>("challenge_idea_list", {})
        return { items: Array.isArray(result.items) ? result.items : [], diagnostics: result.read_diagnostics }
    } catch {
        return { items: [], diagnostics: { status: "failed", diagnostic_code: "host_bridge_read_failed" } }
    }
}

async function searchChallengeIdeaLayer(query: string): Promise<ChallengeLayerRead<IdeaRecord>> {
    try {
        const result = await requestHostBridge<{ items: IdeaRecord[]; read_diagnostics?: ChallengeLayerRead<unknown>["diagnostics"] }>("challenge_idea_search", { query })
        return { items: Array.isArray(result.items) ? result.items : [], diagnostics: result.read_diagnostics }
    } catch {
        return { items: [], diagnostics: { status: "failed", diagnostic_code: "host_bridge_read_failed" } }
    }
}

interface SolverHistoryRecord {
    kind: "user" | "assistant" | "tool"
    entry_id: string
    timestamp: string
    summary: string
}

function safeJsonStringify(value: unknown): string {
    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}

function extractTextBlocks(content: unknown): string[] {
    if (typeof content === "string") return [content]
    if (!Array.isArray(content)) return []
    return content
        .filter((item): item is { type?: unknown; text?: unknown } => !!item && typeof item === "object")
        .filter((item): item is { type: "text"; text: string } => item.type === "text" && typeof item.text === "string")
        .map((item) => item.text.trim())
        .filter((item) => item.length > 0)
}

function extractToolCalls(content: unknown): Array<{ name: string; arguments: string }> {
    if (!Array.isArray(content)) return []
    return content
        .filter((item): item is { type?: unknown; name?: unknown; arguments?: unknown } => !!item && typeof item === "object")
        .filter((item): item is { type: "toolCall"; name: string; arguments?: unknown } => item.type === "toolCall" && typeof item.name === "string")
        .map((item) => ({
            name: item.name,
            arguments: clipText(safeJsonStringify(item.arguments ?? {}), 160),
        }))
}

function extractToolResultSummary(message: Record<string, unknown>): string {
    const text = extractTextBlocks(message.content).join("\n").trim()
    if (text) return clipText(text, 240)
    return clipText(safeJsonStringify(message.content ?? ""), 240)
}

function buildSolverHistoryRecords(entries: unknown[]): SolverHistoryRecord[] {
    const records: SolverHistoryRecord[] = []

    for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue
        if ((entry as { type?: unknown }).type !== "message") continue

        const message = (entry as { message?: unknown }).message
        if (!message || typeof message !== "object") continue

        const entryId = typeof (entry as { id?: unknown }).id === "string" ? (entry as { id: string }).id : "-"
        const timestamp =
            typeof (entry as { timestamp?: unknown }).timestamp === "string" ? (entry as { timestamp: string }).timestamp : "-"
        const role = (message as { role?: unknown }).role

        if (role === "assistant") {
            const assistantText = extractTextBlocks((message as { content?: unknown }).content).join("\n").trim()
            const toolCalls = extractToolCalls((message as { content?: unknown }).content)
            const summaryLines: string[] = []
            if (assistantText) {
                summaryLines.push(`assistant: ${clipText(assistantText, 240)}`)
            }
            for (const toolCall of toolCalls) {
                summaryLines.push(`tool_call: ${toolCall.name} ${toolCall.arguments}`)
            }
            if (summaryLines.length > 0) {
                records.push({
                    kind: "assistant",
                    entry_id: entryId,
                    timestamp,
                    summary: summaryLines.join("\n"),
                })
            }
            continue
        }

        if (role === "user") {
            const userText = extractTextBlocks((message as { content?: unknown }).content).join("\n").trim()
            if (!userText) continue
            records.push({
                kind: "user",
                entry_id: entryId,
                timestamp,
                summary: `user: ${clipText(userText, 240)}`,
            })
            continue
        }

        if (role === "toolResult") {
            const toolName = typeof (message as { toolName?: unknown }).toolName === "string" ? (message as { toolName: string }).toolName : "tool"
            const resultSummary = extractToolResultSummary(message as Record<string, unknown>)
            records.push({
                kind: "tool",
                entry_id: entryId,
                timestamp,
                summary: `tool_result: ${toolName}\nresult: ${resultSummary}`,
            })
        }
    }

    return records
}

function formatSolverHistory(records: SolverHistoryRecord[], totalEntries: number, offset: number): string {
    if (records.length === 0) {
        return ["## Solver History", `- total: ${totalEntries}`, "- showing: none"].join("\n")
    }

    return [
        "## Solver History",
        `- total: ${totalEntries}`,
        `- showing: ${offset + 1}-${offset + records.length}`,
        "",
        ...records.map((record, index) =>
            [`### ${offset + index + 1}. ${record.kind}`, `- entry_id: ${record.entry_id}`, `- timestamp: ${record.timestamp}`, record.summary].join("\n"),
        ),
    ].join("\n")
}

const evidenceFields = {
    refs: Type.Array(Type.String({ format: "uuid" }), { minItems: 1, maxItems: 20, description: "Real Taric evidence UUIDs from solver results or taric_board_query; never fabricate IDs." }),
    limitations: Type.Array(Type.String({ minLength: 1, maxLength: 8000 }), { minItems: 1, maxItems: 10, description: "Exact tested scope and remaining uncertainty; one failed payload does not refute an entire route." }),
}
const memoryFields = {
    kind: Type.Union([Type.Literal("fact"), Type.Literal("evidence"), Type.Literal("failure"), Type.Literal("note"), Type.Literal("hint")]),
    content: Type.String({ minLength: 1, maxLength: 8000 }),
    ...evidenceFields,
}
const ideaFields = {
    content: Type.String({ minLength: 1, maxLength: 8000 }),
    status: Type.Optional(Type.Union([Type.Literal("pending"), Type.Literal("testing"), Type.Literal("verified"), Type.Literal("failed"), Type.Literal("skipped")])),
    result: Type.Optional(Type.String({ minLength: 1, maxLength: 8000 })),
    ...evidenceFields,
}

interface ObserverProposalResponse {
    proposal_id?: string
    status?: string
    degraded?: boolean
    reason?: string
    candidate_only?: boolean
    canonical_changed?: boolean
}

interface ObserverProposalResult {
    isError?: boolean
    content: Array<{ type: "text"; text: string }>
    details: {
        submitted: boolean
        canonical_changed: false
        candidate_only?: boolean
        proposal_id?: string
        status?: string
        response?: ObserverProposalResponse
    }
}

async function submitObserverBoardChange(input: ObserverBoardChange): Promise<ObserverProposalResult> {
    try {
        const change = parseObserverBoardChange(input)
        const response = await requestHostBridge<ObserverProposalResponse>("taric_proposal_submit", { observer_board_change: change })
        const accepted = response.degraded !== true && typeof response.proposal_id === "string" && response.proposal_id.length > 0
            && ["pending", "inflight", "acknowledged"].includes(response.status ?? "")
            && response.candidate_only === true && response.canonical_changed === false
        if (!accepted) {
            return {
                isError: true,
                content: [{ type: "text" as const, text: "Board proposal unavailable: " + (response.reason ?? response.status ?? "host did not confirm a candidate") + ". No canonical change or local fallback was made." }],
                details: { submitted: false, canonical_changed: false, response },
            }
        }
        return {
            content: [{ type: "text" as const, text: "Proposed " + change.board + " " + change.operation + " (L0 candidate " + response.proposal_id + "; " + response.status + "). Await Taric governance; the original board record is unchanged." }],
            details: { submitted: true, candidate_only: true, canonical_changed: false, proposal_id: response.proposal_id, status: response.status },
        }
    } catch (error) {
        return {
            isError: true,
            content: [{ type: "text" as const, text: "Board proposal failed: " + (error instanceof Error ? error.message : String(error)) + ". No canonical change or local fallback was made." }],
            details: { submitted: false, canonical_changed: false },
        }
    }
}

function createObserverCurationTools() {
    return [
        defineTool({
            name: "memory_add", label: "Propose Memory",
            description: "Propose a new durable memory backed by real Taric evidence. Read the board first. This queues an L0 candidate through the host, never a local file or an admitted fact.",
            parameters: Type.Object(memoryFields, { additionalProperties: false }),
            async execute(_id, params) {
                return submitObserverBoardChange({ board: "memory", operation: "add", memory_kind: params.kind, content: params.content, refs: params.refs, limitations: params.limitations })
            },
        }),
        defineTool({
            name: "memory_update", label: "Propose Memory Revision",
            description: "Propose an evidenced replacement of a memory by its real Taric UUID. The original stays unchanged until host/Taric governance resolves the request; do not claim it was updated.",
            parameters: Type.Object({ id: Type.String({ format: "uuid" }), ...memoryFields }, { additionalProperties: false }),
            async execute(_id, params) {
                return submitObserverBoardChange({ board: "memory", operation: "update", target_ref: params.id, memory_kind: params.kind, content: params.content, refs: params.refs, limitations: params.limitations })
            },
        }),
        defineTool({
            name: "memory_delete", label: "Propose Memory Retirement",
            description: "Request retirement of a superseded or incorrect memory, with its real Taric UUID, evidence and reason. This is an immutable candidate request, not deletion or evidence destruction.",
            parameters: Type.Object({ id: Type.String({ format: "uuid" }), reason: Type.String({ minLength: 1, maxLength: 8000 }), ...evidenceFields }, { additionalProperties: false }),
            async execute(_id, params) {
                return submitObserverBoardChange({ board: "memory", operation: "retire", target_ref: params.id, content: params.reason, refs: params.refs, limitations: params.limitations })
            },
        }),
        defineTool({
            name: "idea_add", label: "Propose Idea",
            description: "Propose a new testable hypothesis only when the board lacks it. Cite real Taric evidence and limitations. Requested status is an observer assessment, never authoritative verification.",
            parameters: Type.Object(ideaFields, { additionalProperties: false }),
            async execute(_id, params) {
                return submitObserverBoardChange({ board: "idea", operation: "add", ...params })
            },
        }),
        defineTool({
            name: "idea_update", label: "Propose Idea Resolution",
            description: "Prefer closing an existing hypothesis over adding another. Supply its real Taric UUID, replacement content, scoped result and evidence. A verified/failed/skipped request is a candidate assessment; the original status is unchanged.",
            parameters: Type.Object({ ...ideaFields, id: Type.String({ format: "uuid" }), result: Type.String({ minLength: 1, maxLength: 8000 }) }, { additionalProperties: false }),
            async execute(_id, params) {
                const { id, ...change } = params
                return submitObserverBoardChange({ board: "idea", operation: "update", target_ref: id, ...change })
            },
        }),
        defineTool({
            name: "taric_board_query", label: "Taric Evidence Read",
            description: "Read a bounded, host-scoped Taric evidence/context/resource page when real evidence or target UUIDs are missing. Respect degraded/partial results and cursors. Read-only; never query unrelated projects.",
            parameters: Type.Object({
                operation: Type.Union([Type.Literal("evidence.query"), Type.Literal("resource.query"), Type.Literal("context.query")]),
                kind: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
                cursor: Type.Optional(Type.String({ maxLength: 512 })),
                page_size: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
            }, { additionalProperties: false }),
            async execute(_id, params) {
                const data = await requestHostBridge<Record<string, unknown>>("taric_board_query", {
                    ...params,
                    page_size: params.page_size ?? 10,
                    budget: params.operation === "context.query" ? 4000 : 20,
                })
                const json = JSON.stringify(data)
                const truncated = json.length > 16000
                return {
                    ...(data.degraded === true ? { isError: true } : {}),
                    content: [{ type: "text" as const, text: clipText(json, 16000) + (truncated ? "\nWARNING: display truncated; use a smaller page." : "") }],
                    details: { data, display_truncated: truncated },
                }
            },
        }),
    ]
}

export function createObserverSidecarTools(sendCorrectionNotice?: (message: string) => Promise<boolean> | boolean) {
    return createObserverSidecarToolsWithOptions({ sendCorrectionNotice })
}

export function createObserverSidecarToolsWithOptions(options?: {
    sendCorrectionNotice?: (message: string) => Promise<boolean> | boolean
    getSolverEntries?: () => Promise<unknown[]> | unknown[]
}) {
    const sendCorrectionNotice = options?.sendCorrectionNotice
    const getSolverEntries = options?.getSolverEntries
    return [
        ...challengeObserverAgentTools,
        ...createObserverCurationTools(),
        defineTool({
            name: "query_solver_history",
            label: "Query Solver History",
            description:
                "Inspect recent solver history when compressed context is insufficient. Pages through user instructions, assistant outputs, tool calls, and tool results.",
            promptSnippet:
                "query_solver_history: page through recent user instructions, assistant outputs, and tool activity when compressed context is insufficient",
            parameters: querySolverHistoryToolParams,
            async execute(_toolCallId, params: QuerySolverHistoryToolInput, _signal, _onUpdate, ctx) {
                const baseEntries = (await getSolverEntries?.()) ?? ctx.sessionManager.getEntries()
                const records = buildSolverHistoryRecords(baseEntries).reverse()
                const offset = params.offset ?? 0
                const limit = params.limit ?? 8
                const slice = records.slice(offset, offset + limit)
                return {
                    content: [{ type: "text", text: formatSolverHistory(slice, records.length, offset) }],
                    details: {
                        total_entries: records.length,
                        returned_count: slice.length,
                    },
                }
            },
        }),
        defineTool({
            name: "send_efficiency_reminder",
            label: "Efficiency Reminder",
            description:
                "As a last resort, send a concise evidence-based correction for persistent mainline drift or repeated low-information actions after board curation is insufficient. Identify the observed problem and the next minimal verification action. Do not interrupt healthy progress or claim that board state was changed.",
            promptSnippet:
                "send_efficiency_reminder: sparingly send an evidence-based mainline correction with one concrete next verification action",
            parameters: steerToolParams,
            async execute(_toolCallId, params: SteerToolInput) {
                const delivered = sendCorrectionNotice ? (await sendCorrectionNotice(params.message)) !== false : false
                return {
                    content: [
                        {
                            type: "text",
                            text: delivered
                                ? `sent efficiency reminder: ${clipText(params.message, 200)}`
                                : `suppressed efficiency reminder: ${clipText(params.message, 200)}`,
                        },
                    ],
                    details: { delivered, message: params.message },
                }
            },
        }),
    ]
}

export const challengeObserverAgentTools = [
    defineTool({
        name: "memory_list",
        label: "Memory List",
        description: "List durable memory. Use at the start, after compaction, or before retrying a line of attack when context may be stale.",
        promptSnippet: "memory_list: review durable facts/evidence/failures before choosing next step",
        parameters: EmptyParams,
        async execute() {
            const [items, challengeRead] = await Promise.all([listSolverBoardMemory(), listChallengeMemoryLayer()])
            const challengeItems = challengeRead.items
            return {
                content: [{ type: "text", text: formatLayeredMemoryTable(items, challengeItems) + challengeReadNotice(challengeRead.diagnostics) }],
                details: { items, challenge_items: challengeItems, challenge_read_diagnostics: challengeRead.diagnostics },
            }
        },
    }),
    defineTool({
        name: "idea_list",
        label: "Idea List",
        description: "List current attack hypotheses. Use it as read-only input before choosing or switching direction.",
        promptSnippet: "idea_list: review current attack hypotheses before choosing direction",
        parameters: EmptyParams,
        async execute() {
            const [items, challengeRead] = await Promise.all([listSolverBoardIdeas(), listChallengeIdeaLayer()])
            const challengeItems = challengeRead.items
            return {
                content: [{ type: "text", text: formatLayeredIdeaTable(items, challengeItems) + challengeReadNotice(challengeRead.diagnostics) }],
                details: { items, challenge_items: challengeItems, challenge_read_diagnostics: challengeRead.diagnostics },
            }
        },
    }),
    defineTool({
        name: "idea_search",
        label: "Idea Search",
        description: "Search current attack hypotheses by keyword before retrying a specific vector such as SQLi, upload, SSRF, RCE, format string, or overflow.",
        promptSnippet: "idea_search: check whether this vector is already on the current board",
        parameters: ideaSearchToolParams,
        async execute(_toolCallId, params: IdeaSearchToolInput) {
            const [items, challengeRead] = await Promise.all([searchSolverBoardIdeas(params.query), searchChallengeIdeaLayer(params.query)])
            const challengeItems = challengeRead.items
            return {
                content: [{ type: "text", text: formatLayeredIdeaTable(items, challengeItems) + challengeReadNotice(challengeRead.diagnostics) }],
                details: { query: params.query, items, challenge_items: challengeItems, challenge_read_diagnostics: challengeRead.diagnostics },
            }
        },
    }),
]
