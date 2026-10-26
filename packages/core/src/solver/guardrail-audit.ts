import { appendFile, readFile } from "node:fs/promises"
import { resolve } from "node:path"

export type GuardrailAuditDecision = "allowed" | "observed" | "blocked"

export interface GuardrailAuditEvent {
    timestamp: string
    solverId?: string
    challengeId?: string
    role?: string
    toolName: string
    ruleId?: string
    decision: GuardrailAuditDecision
    reason?: string
    inputDigest?: string
    phase: "observe" | "enforce"
}

export function guardrailAuditPath(workspaceRoot: string): string {
    return resolve(workspaceRoot, "guardrail-audit.jsonl")
}

export function inputDigest(input: Record<string, unknown>): string {
    try {
        return Bun.hash(JSON.stringify(input)).toString(16)
    } catch {
        return ""
    }
}

export async function appendGuardrailAuditEvent(
    path: string,
    event: GuardrailAuditEvent,
): Promise<void> {
    await appendFile(path, `${JSON.stringify(event)}\n`, "utf-8").catch(() => {})
}

export async function readGuardrailAuditFile(path: string): Promise<GuardrailAuditEvent[]> {
    let text: string
    try {
        text = await readFile(path, "utf8")
    } catch {
        return []
    }

    const events: GuardrailAuditEvent[] = []
    for (const rawLine of text.split("\n")) {
        const line = rawLine.trim()
        if (!line) continue
        try {
            const parsed = JSON.parse(line) as GuardrailAuditEvent
            if (parsed && typeof parsed.toolName === "string" && typeof parsed.decision === "string") {
                events.push(parsed)
            }
        } catch {
            // Ignore malformed audit lines and keep the remaining records readable.
        }
    }
    return events
}

export async function readSolverGuardrailAudit(workspaceRoot: string): Promise<GuardrailAuditEvent[]> {
    return readGuardrailAuditFile(guardrailAuditPath(workspaceRoot))
}

export function aggregateGuardrailAudit(records: Array<{ solverId: string; events: GuardrailAuditEvent[] }>) {
    const events = records
        .flatMap((entry) => entry.events.map((event) => ({ ...event, solverId: event.solverId ?? entry.solverId })))
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    return {
        events,
        observed: events.filter((event) => event.decision === "observed").length,
        blocked: events.filter((event) => event.decision === "blocked").length,
        allowed: events.filter((event) => event.decision === "allowed").length,
    }
}
