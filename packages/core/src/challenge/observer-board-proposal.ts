import { normalizeTaricProposal } from "./taric-proposal-schema"
import type { NormalizedTaricProposal } from "./taric-proposal-schema"

export interface ObserverBoardChange {
    board: "memory" | "idea"
    operation: "add" | "update" | "retire"
    content: string
    refs: string[]
    limitations: string[]
    target_ref?: string
    memory_kind?: "fact" | "evidence" | "failure" | "note" | "hint"
    status?: "pending" | "testing" | "verified" | "failed" | "skipped"
    result?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KEYS = new Set(["board", "operation", "content", "refs", "limitations", "target_ref", "memory_kind", "status", "result"])

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("observer_board_change must be an object")
    return value as Record<string, unknown>
}

function text(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) throw new Error(field + " must be nonempty text")
    if (value.length > 8000) throw new Error(field + " exceeds 8000 characters")
    return value.trim()
}

export function parseObserverBoardChange(value: unknown): ObserverBoardChange {
    const data = object(value)
    for (const key of Object.keys(data)) {
        if (!KEYS.has(key)) throw new Error("unsupported observer board field: " + key)
    }
    if (data.board !== "memory" && data.board !== "idea") throw new Error("board must be memory or idea")
    if (data.operation !== "add" && data.operation !== "update" && data.operation !== "retire") throw new Error("invalid board operation")
    if (data.board === "idea" && data.operation === "retire") throw new Error("retire ideas with an update to skipped and an evidenced result")
    const content = text(data.content, "content")
    if (!Array.isArray(data.refs) || data.refs.length < 1 || data.refs.length > 20) throw new Error("refs must contain 1 to 20 Taric evidence UUIDs")
    const refs = [...new Set(data.refs.map((ref: unknown) => {
        const value = text(ref, "refs")
        if (!UUID.test(value)) throw new Error("refs must be Taric evidence UUIDs")
        return value.toLowerCase()
    }))]
    if (!Array.isArray(data.limitations) || data.limitations.length < 1 || data.limitations.length > 10) throw new Error("limitations must contain 1 to 10 scoped limitations")
    const limitations = [...new Set(data.limitations.map((item: unknown) => text(item, "limitations")))]
    const target = data.target_ref === undefined ? undefined : text(data.target_ref, "target_ref").toLowerCase()
    if (data.operation === "add" && target !== undefined) throw new Error("add must not specify target_ref")
    if (data.operation !== "add" && (!target || !UUID.test(target))) throw new Error("update/retire requires a real Taric target_ref UUID")
    if (data.memory_kind !== undefined && !["fact", "evidence", "failure", "note", "hint"].includes(data.memory_kind as string)) throw new Error("invalid memory_kind")
    if (data.status !== undefined && !["pending", "testing", "verified", "failed", "skipped"].includes(data.status as string)) throw new Error("invalid idea status")
    if (data.board === "memory" && (data.status !== undefined || data.result !== undefined)) throw new Error("memory changes must not set idea status/result")
    if (data.board === "idea" && data.memory_kind !== undefined) throw new Error("ideas must not set memory_kind")
    const result = data.result === undefined ? undefined : text(data.result, "result")
    if (data.board === "idea" && (data.operation === "update" || ["verified", "failed", "skipped"].includes(String(data.status))) && !result) throw new Error("idea resolution requires an evidenced result")
    return {
        board: data.board, operation: data.operation, content, refs, limitations,
        ...(target ? { target_ref: target } : {}),
        ...(data.memory_kind ? { memory_kind: data.memory_kind as ObserverBoardChange["memory_kind"] } : {}),
        ...(data.status ? { status: data.status as ObserverBoardChange["status"] } : {}),
        ...(result ? { result } : {}),
    }
}

export function normalizeObserverBoardProposal(value: unknown, projectKey: string, source: string): { change: ObserverBoardChange; proposal: NormalizedTaricProposal } {
    const change = parseObserverBoardChange(value)
    const intent = "Observer board " + change.operation + " request (candidate only; target remains unchanged)."
    const proposition = change.operation === "add" ? change.content : [intent, "Target: " + change.target_ref, change.content].join("\n")
    const details = [proposition]
    if (change.status) details.push("Requested idea status (not authoritative): " + change.status)
    if (change.result) details.push("Observed result: " + change.result)
    const proposal = normalizeTaricProposal({
        kind: "claim", expected_version: 0,
        content: {
            proposition: details.join("\n"),
            evidence_refs: change.refs,
            limitations: [
                "Observer curation proposal; not an admitted fact or a canonical board mutation.",
                ...change.limitations,
            ],
        },
    })
    // This title is host-derived. Keep the provider's project classification;
    // never accept project identity, authority or an update version from a model.
    proposal.content.title = "BreachWeave [" + projectKey + "] " + (change.board === "memory"
        ? "memory (" + (change.operation === "retire" ? "note" : change.memory_kind ?? "note") + "): " + source
        : "idea: " + change.content.slice(0, 120))
    return { change, proposal }
}
