import type { AttackTimelineEvent } from "./api"

function record(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function matchingToolCall(event: AttackTimelineEvent, events: AttackTimelineEvent[], toolName: string, toolCallId: unknown) {
    if (typeof toolCallId !== "string" || !toolCallId) return
    const matches = events.filter((item) => {
        const call = record(record(item.payload)?.toolCall)
        return item.kind === "tool_call" && item.challengeId === event.challengeId && item.solverId === event.solverId && item.timestamp <= event.timestamp && call?.id === toolCallId && call.name === toolName
    })
    // Ambiguous linkage must never attach another candidate's evidence.
    if (matches.length !== 1) return
    return record(record(matches[0].payload)?.toolCall)
}

export function submittedCandidate(event: AttackTimelineEvent, events: AttackTimelineEvent[]) {
    const toolNames: Partial<Record<AttackTimelineEvent["kind"], string>> = {
        memory_added: "memory_add", memory_updated: "memory_update", idea_added: "idea_add", idea_updated: "idea_update",
    }
    const toolName = toolNames[event.kind]
    const result = record(record(event.payload)?.toolResult)
    const details = record(result?.details)
    if (!toolName || result?.toolName !== toolName || result.isError === true || details?.candidate_only !== true) return
    const args = record(matchingToolCall(event, events, toolName, result.toolCallId)?.arguments)
    return {
        content: typeof args?.content === "string" ? args.content : "",
        refs: Array.isArray(args?.refs) ? args.refs.filter((ref): ref is string => typeof ref === "string") : [],
        proposalId: typeof details.proposal_id === "string" ? details.proposal_id : "",
        status: typeof details.status === "string" ? details.status : "",
        canonicalChanged: typeof details.canonical_changed === "boolean" ? details.canonical_changed : undefined,
    }
}

export function isRepresentedReportResult(event: AttackTimelineEvent, events: AttackTimelineEvent[]) {
    const result = record(record(event.payload)?.toolResult)
    if (event.kind !== "tool_result" || result?.toolName !== "challenge_submit_report" || result.isError === true) return false
    const args = record(matchingToolCall(event, events, "challenge_submit_report", result.toolCallId)?.arguments)
    if (typeof args?.report !== "string" || !args.report || typeof args.asset_hash !== "string") return false
    const report = args.report.trim()
    const assetHash = args.asset_hash
    return events.some((item) => {
        const submission = record(record(item.payload)?.submission)
        return item.kind === "report_submitted" && item.challengeId === event.challengeId && item.solverId === event.solverId && item.timestamp <= event.timestamp && typeof submission?.report === "string" && submission.report.trim() === report && submission.asset_hash === assetHash
    })
}
