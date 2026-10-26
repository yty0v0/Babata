import type { HostBridgeHandler } from "../runtime/types"
import { CHALLENGE_ENV_CHALLENGE_ID, CHALLENGE_ENV_TARIC_ATTEMPT_ID, CHALLENGE_ENV_TARIC_ENGAGEMENT_ID, CHALLENGE_ENV_TARIC_WORK_RUN_ID } from "./env"
import { HostBridgeError } from "./host-bridge-types"
import type { TaricAuthoritativeState } from "./taric-authoritative-state"

function getObjectValue(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return value as Record<string, unknown>
}

function getOptionalString(data: Record<string, unknown>, key: string): string | undefined {
    const value = data[key]
    if (typeof value !== "string") return
    const text = value.trim()
    return text || undefined
}

export function createTaricToolResultCaptureHandler(state: TaricAuthoritativeState): HostBridgeHandler {
    return {
        async handle(context) {
            if (context.action !== "taric_tool_result_capture") return { handled: false }
            const challengeId = getOptionalString(getObjectValue(context.params), "challenge_id")
                ?? context.getSolverEnvValue(CHALLENGE_ENV_CHALLENGE_ID)
            if (challengeId && !(await state.isChallengeBound(challengeId))) {
                throw new HostBridgeError("authorization_error", "challenge has no active Taric binding for tool-result capture")
            }
            const engagementId =
                getOptionalString(getObjectValue(context.params), "engagement_id") ??
                context.getSolverEnvValue(CHALLENGE_ENV_TARIC_ENGAGEMENT_ID)
            if (!engagementId) {
                throw new HostBridgeError("validation_error", "Taric engagement id is required for tool-result capture")
            }
            const workRunId =
                getOptionalString(getObjectValue(context.params), "work_run_id") ??
                context.getSolverEnvValue(CHALLENGE_ENV_TARIC_WORK_RUN_ID)
            const attemptId =
                getOptionalString(getObjectValue(context.params), "attempt_id") ??
                context.getSolverEnvValue(CHALLENGE_ENV_TARIC_ATTEMPT_ID)
            const toolName = getOptionalString(getObjectValue(context.params), "tool_name") ?? "tool"
            const text = getOptionalString(getObjectValue(context.params), "text") ?? ""
            const result = await state.captureToolResult({
                ...(challengeId ? { challengeId } : {}),
                engagementId,
                ...(workRunId ? { workRunId } : {}),
                ...(attemptId ? { attemptId } : {}),
                role: context.getSolver?.()?.role,
                toolName,
                text,
            })
            return { handled: true, data: result }
        },
    }
}
