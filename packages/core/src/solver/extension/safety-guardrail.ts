import { resolve } from "node:path"
import type { ExtensionFactory } from "@mariozechner/pi-coding-agent"
import { evaluateGuardrailToolCall } from "../../config/guardrail-policy"
import type { HostGuardrailSettings } from "../../config/types"
import {
    appendGuardrailAuditEvent,
    guardrailAuditPath,
    inputDigest,
    type GuardrailAuditDecision,
} from "../guardrail-audit"

export interface SafetyGuardrailOptions {
    workspaceRoot: string
    settings?: HostGuardrailSettings
    solverId?: string
    challengeId?: string
    role?: string
}

function auditLogPath(workspaceRoot: string, settings?: HostGuardrailSettings): string {
    const configured = settings?.auditLogPath?.trim()
    if (configured) return resolve(configured)
    return guardrailAuditPath(workspaceRoot)
}

export function safetyGuardrailExtension(options: SafetyGuardrailOptions): ExtensionFactory {
    const { workspaceRoot, settings, solverId, challengeId, role } = options
    const phase = settings?.phase === "enforce" ? "enforce" : "observe"
    const path = auditLogPath(workspaceRoot, settings)

    return (pi) => {
        pi.on("tool_call", async (event) => {
            const input = (event.input ?? {}) as Record<string, unknown>
            const decision = await evaluateGuardrailToolCall(
                event.toolName,
                input,
                workspaceRoot,
                settings,
            )

            if (decision.allowed) return

            const reason = decision.reason ?? "safety guardrail rejected this tool call"
            const auditDecision: GuardrailAuditDecision = phase === "enforce" ? "blocked" : "observed"
            await appendGuardrailAuditEvent(path, {
                timestamp: new Date().toISOString(),
                solverId,
                challengeId,
                role,
                toolName: event.toolName,
                ruleId: decision.ruleId,
                decision: auditDecision,
                reason,
                inputDigest: inputDigest(input),
                phase,
            })

            if (phase === "enforce") {
                return { block: true, reason }
            }
        })
    }
}
