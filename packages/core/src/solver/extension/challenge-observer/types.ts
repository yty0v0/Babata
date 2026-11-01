export interface ObserverToolLog {
    tool_name: string
    args_summary: string
    result_summary: string
    is_error: boolean
}

export interface ObserverRoundPayload {
    round: number
    assistant_summary: string
    tool_logs: ObserverToolLog[]
}

export interface ObserverReviewPayload {
    reason: "periodic" | "hint" | "report_submission" | "agent_end"
    rounds: ObserverRoundPayload[]
    session_context: string
    branch_entry_count: number
    message_count: number
}
