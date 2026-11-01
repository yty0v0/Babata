import { expect, test } from "bun:test"
import type { AttackTimelineEvent } from "./api"
import { timelineEventTitle } from "./timeline-event-title"

const translations: Record<string, string> = {
    "flow.timeline.solver.message": "测试智能体 · {{role}}",
    "flow.timeline.observer.message": "观察员 · {{role}}",
    "flow.timeline.report.submitted": "测试报告已提交",
    "flow.timeline.roles.assistant": "助手",
    "flow.timeline.roles.user": "用户",
}

const translate = ((key: string, options?: { role?: string }) =>
    (translations[key] ?? key).replace("{{role}}", options?.role ?? "")) as Parameters<typeof timelineEventTitle>[1]

function event(kind: AttackTimelineEvent["kind"], title: string, lane: AttackTimelineEvent["lane"] = "solver"): AttackTimelineEvent {
    return {
        id: "event_1",
        timestamp: 0,
        challengeId: "challenge_1",
        lane,
        kind,
        title,
        summary: "",
    }
}

test("timeline message titles localize role names and speaker", () => {
    expect(timelineEventTitle(event("message", "Solver assistant"), translate)).toBe("测试智能体 · 助手")
    expect(timelineEventTitle(event("message", "Observer user", "observer"), translate)).toBe("观察员 · 用户")
})

test("report submission title is localized", () => {
    expect(timelineEventTitle(event("report_submitted", "Report submitted", "submission"), translate)).toBe("测试报告已提交")
})


test("English role labels respect the active translator", () => {
    const english = ((key: string, options?: { role?: string }) => {
        if (key === "flow.timeline.roles.assistant") return "Assistant"
        if (key === "flow.timeline.solver.message") return `Solver ${options?.role}`
        return key
    }) as Parameters<typeof timelineEventTitle>[1]
    expect(timelineEventTitle(event("message", "Solver assistant"), english)).toBe("Solver Assistant")
    expect(timelineEventTitle(event("message", "Solver custom-role"), english)).toBe("Solver custom-role")
})
