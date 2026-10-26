export type HostBridgeAction =
    | "challenge_get_state"
    | "challenge_get_hint"
    | "challenge_submit_report"
    | "challenge_is_completed"
    | "challenge_memory_list"
    | "challenge_memory_add"
    | "challenge_idea_list"
    | "challenge_idea_search"
    | "challenge_idea_add"
    | "taric_board_query"
    | "taric_proposal_submit"
    | "taric_tool_result_capture"

export type HostBridgeErrorCode =
    | "authorization_error"
    | "validation_error"
    | "rate_limited"
    | "timeout"
    | "unavailable"
    | "conflict"
    | "stale_version"
    | "internal_error"

export class HostBridgeError extends Error {
    readonly code: HostBridgeErrorCode
    readonly details?: Record<string, unknown>

    constructor(code: HostBridgeErrorCode, message: string, details?: Record<string, unknown>) {
        super(message)
        this.name = "HostBridgeError"
        this.code = code
        this.details = details
    }
}

export function serializeHostBridgeError(error: unknown): string {
    if (error instanceof HostBridgeError) {
        return JSON.stringify({ code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) })
    }
    const message = error instanceof Error ? error.message : String(error)
    return JSON.stringify({ code: "internal_error", message })
}

export function isHostBridgeErrorCode(value: unknown): value is HostBridgeErrorCode {
    return (
        value === "authorization_error" ||
        value === "validation_error" ||
        value === "rate_limited" ||
        value === "timeout" ||
        value === "unavailable" ||
        value === "conflict" ||
        value === "stale_version" ||
        value === "internal_error"
    )
}

export interface HostBridgeRequestEvent {
    type: "host_bridge_request"
    request_id: string
    action: HostBridgeAction
    params: unknown
}
