import { expect, test } from "bun:test"
import type { TFunction } from "i18next"
import { buildSolverCardData } from "./solver-event-card-data"
import type { AttackTimelineEvent } from "./api"
import { submittedCandidate } from "./timeline-event-details"
import { keyTimelineEvents } from "./timeline-key-events"
import { buildExecutionOverviewFromTimeline } from "./execution-overview-from-timeline"

function event(patch: Partial<AttackTimelineEvent>): AttackTimelineEvent {
    return { id: "event", challengeId: "project", solverId: "solver", timestamp: 10, lane: "board", kind: "memory_added", title: "Memory", summary: "Candidate", ...patch }
}
const call = event({ id: "call", timestamp: 1, kind: "tool_call", payload: { toolCall: { id: "call-id", name: "memory_add", arguments: { content: "Original test evidence", refs: ["ref", 12] } } } })
const candidate = event({ payload: { toolResult: { toolCallId: "call-id", toolName: "memory_add", isError: false, details: { candidate_only: true, canonical_changed: false, proposal_id: "proposal", status: "pending" } } } })

test("pending candidates show the exact submitted body without changing historical payloads", () => {
    const before = JSON.stringify([call, candidate])
    expect(submittedCandidate(candidate, [call, candidate])).toEqual({ content: "Original test evidence", refs: ["ref"], proposalId: "proposal", status: "pending", canonicalChanged: false })
    expect(JSON.stringify([call, candidate])).toBe(before)
})
test("candidate linkage rejects cross-agent, cross-project, future and duplicate calls", () => {
    for (const patch of [{ solverId: "other" }, { challengeId: "other" }, { timestamp: 11 }, { payload: { toolCall: { id: "call-id", name: "idea_add", arguments: { content: "Wrong tool" } } } }]) {
        expect(submittedCandidate(candidate, [{ ...call, ...patch }, candidate])?.content).toBe("")
    }
    expect(submittedCandidate(candidate, [call, { ...call, id: "duplicate" }, candidate])?.content).toBe("")
})
test("missing call ids cannot match unrelated tool calls", () => {
    const broken = event({ payload: { toolResult: { toolName: "memory_add", details: { candidate_only: true } } } })
    expect(submittedCandidate(broken, [event({ kind: "tool_call", payload: { toolCall: { name: "memory_add", arguments: { content: "Unrelated" } } } })])?.content).toBe("")
    expect(submittedCandidate(broken, [])?.canonicalChanged).toBeUndefined()
})
test("canonical entries and failed mutations do not become candidates", () => {
    expect(submittedCandidate(event({ payload: { entry: { content: "Canonical" } } }), [call])).toBeUndefined()
    expect(submittedCandidate(event({ payload: { toolResult: { toolName: "memory_add", isError: true, details: { candidate_only: true } } } }), [call])).toBeUndefined()
})
test("idea candidates use their corresponding idea tool call", () => {
    const ideaCall = event({ id: "idea-call", timestamp: 1, kind: "tool_call", payload: { toolCall: { id: "idea-id", name: "idea_add", arguments: { content: "Proposed next step" } } } })
    const idea = event({ kind: "idea_added", payload: { toolResult: { toolName: "idea_add", toolCallId: "idea-id", details: { candidate_only: true, status: "pending" } } } })
    expect(submittedCandidate(idea, [call, ideaCall])?.content).toBe("Proposed next step")
})
const reportCall = event({ id: "report-call", timestamp: 1, kind: "tool_call", payload: { toolCall: { id: "report-id", name: "challenge_submit_report", arguments: { asset_hash: "asset", report: "Full test report" } } } })
const report = event({ id: "report", kind: "report_submitted", lane: "submission", payload: { submission: { asset_hash: "asset", report: "Full test report" } } })
const result = event({ id: "result", timestamp: 11, kind: "tool_result", title: "challenge_submit_report finished", payload: { toolResult: { toolCallId: "report-id", toolName: "challenge_submit_report", isError: false } } })
test("the same report and its successful tool result count once", () => {
    const events = [reportCall, report, result]
    expect(keyTimelineEvents(events).map((item) => item.id)).toEqual(["report"])
    expect(buildExecutionOverviewFromTimeline(events).stats.flag).toBe(1)
})
test("unmatched, failed or cross-agent report results remain inspectable", () => {
    expect(keyTimelineEvents([reportCall, result])).toContain(result)
    expect(keyTimelineEvents([reportCall, { ...report, solverId: "another" }, result])).toContain(result)
    const failure = { ...result, payload: { toolResult: { toolCallId: "report-id", toolName: "challenge_submit_report", isError: true } } }
    expect(keyTimelineEvents([reportCall, report, failure])).toContain(failure)
})


test("report matching tolerates storage trimming but never merges different reports", () => {
    const trimmedCall = { ...reportCall, payload: { toolCall: { id: "report-id", name: "challenge_submit_report", arguments: { asset_hash: "asset", report: "Full test report\n" } } } }
    expect(keyTimelineEvents([trimmedCall, report, result]).map((item) => item.id)).toEqual(["report"])
    const different = { ...report, payload: { submission: { asset_hash: "asset", report: "Another report" } } }
    expect(keyTimelineEvents([reportCall, different, result])).toContain(result)
})


test("collaboration cards show submitted candidate evidence without presenting it as canonical", () => {
    const translate = ((key: string) => key) as TFunction
    const data = buildSolverCardData({ id: "solver", firstSeen: 1, lastSeen: 10, eventCount: 2, observerEventCount: 0 }, [call, candidate], translate)
    const card = data.recentEvents.find((item) => item.kind === "memory_added")
    expect(card?.desc).toBe("flow.detail.candidateLabel · Original test evidence")
    const canonical = event({ payload: { entry: { content: "Canonical" } }, summary: "Existing approved summary" })
    const canonicalData = buildSolverCardData({ id: "solver", firstSeen: 1, lastSeen: 10, eventCount: 1, observerEventCount: 0 }, [canonical], translate)
    expect(canonicalData.recentEvents[0].desc).toBe("Existing approved summary")
})
