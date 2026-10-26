import { describe, expect, mock, test } from "bun:test"
import { buildTaricIntegrationStatus, taricBackoffDelay, TaricHostStatePoller, verifyTaricAuditRecords } from "./taric-observability"

describe("Taric observability", () => {
    test("backoff advances through 1s, 5s, and 15s", () => {
        expect(taricBackoffDelay(0)).toBe(1_000)
        expect(taricBackoffDelay(1)).toBe(1_000)
        expect(taricBackoffDelay(2)).toBe(5_000)
        expect(taricBackoffDelay(3)).toBe(15_000)
    })

    test("poller returns health snapshots and degrades on failures", async () => {
        const poll = mock(async () => ({ ok: true }))
        const poller = new TaricHostStatePoller({ poll, timeoutMs: 1_000 })
        const snapshot = await poller.pollOnce()
        expect(snapshot.ok).toBe(true)
        expect(snapshot.latencyMs).toBeGreaterThanOrEqual(0)

        poll.mockImplementation(async () => {
            throw new Error("host.state unavailable")
        })
        const failed = await poller.pollOnce()
        expect(failed).toMatchObject({ ok: false, degraded: true, reason: "host.state unavailable" })
    })

    test("builds integration status with bounded degradation projection", () => {
        const status = buildTaricIntegrationStatus({
            enabled: true,
            sidecarRunning: true,
            sidecarPort: 9000,
            authorityReachable: true,
            outboxPending: 2,
            outboxFailed: 1,
            degradationReasons: ["authority timeout"],
        })
        expect(status).toMatchObject({
            enabled: true,
            sidecarPort: 9000,
            outboxPending: 2,
            outboxFailed: 1,
        })
        expect(status.degradationReasons).toEqual(["authority timeout"])
        expect(status.evidenceCoverage).toEqual({
            recentCheckpoints: 0,
            withEvidence: 0,
            withoutEvidence: 0,
            coverageRatio: 0,
            gaps: [],
        })
        expect(status.repair).toEqual({ repaired: 0, awaitingRepair: 0 })
    })

    test("projects evidence coverage and repair outcomes", () => {
        const status = buildTaricIntegrationStatus({
            evidenceCoverage: {
                recentCheckpoints: 4,
                withEvidence: 3,
                withoutEvidence: 1,
                coverageRatio: 0.75,
                gaps: [{ workRunId: "run-1", reason: "observation unavailable" }],
            },
            repair: {
                repaired: 2,
                awaitingRepair: 1,
                lastError: "commit unavailable",
            },
        })
        expect(status.evidenceCoverage.coverageRatio).toBe(0.75)
        expect(status.evidenceCoverage.gaps[0]).toMatchObject({ workRunId: "run-1" })
        expect(status.repair).toMatchObject({ repaired: 2, awaitingRepair: 1, lastError: "commit unavailable" })
    })

    test("audit verification reports identity and outcome drift", () => {
        const result = verifyTaricAuditRecords([
            { id: "", action: "", status: "" },
            { id: "ok", action: "proposal.submit", status: "completed", outcome: "success" },
            { id: "drift", action: "admission.evaluate", status: "completed" },
        ])
        expect(result.ok).toBe(false)
        expect(result.drift).toHaveLength(2)
    })
})
