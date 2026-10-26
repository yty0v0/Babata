import { describe, expect, test } from "bun:test"
import { applyCoverageUpdate, assertIndependentL2Review, buildCoverageGapMatrix, propagateResourceImpact, rebuildCoverageProjection } from "./coverage-governance"
import { hashChallengeAsset, normalizeChallengeRecord } from "./store"
import type { ChallengeRecord } from "./store"

function challenge(): ChallengeRecord {
    return normalizeChallengeRecord({
        id: "governance-test",
        name: "Governance Test",
        description: "",
        assets: {
            urls: [
                { asset: "https://a.example", asset_hash: hashChallengeAsset("https://a.example"), scanned: false, coverage_state: "untested" },
                { asset: "https://b.example", asset_hash: hashChallengeAsset("https://b.example"), scanned: false, coverage_state: "blocked", coverage_reason: "auth required" },
            ],
            ips: [],
        },
        planner_enabled: false,
        difficulty: "local",
        level: 1,
        hint_viewed: false,
        instance_status: "stopped",
        entrypoint: null,
        title: "Governance Test",
    })
}

describe("coverage governance", () => {
    test("applies and rebuilds coverage projection from Taric references", () => {
        const base = challenge()
        const updated = applyCoverageUpdate(base, {
            group: "urls",
            asset: "https://a.example",
            state: "positive",
            coverageRecordId: "coverage-1",
            proposalId: "proposal-1",
        })
        expect(updated.assets?.urls[0]).toMatchObject({
            scanned: true,
            coverage_state: "positive",
            taric_refs: { coverage_record_id: "coverage-1", proposal_id: "proposal-1" },
        })
        expect(rebuildCoverageProjection(updated).assets?.urls[0]?.scanned).toBe(true)
    })

    test("builds gap matrix for blocked and untested assets", () => {
        const gaps = buildCoverageGapMatrix(challenge())
        expect(gaps).toHaveLength(2)
        expect(gaps[0]).toMatchObject({ asset: "https://a.example", state: "untested" })
        expect(gaps[1]).toMatchObject({ asset: "https://b.example", state: "blocked", reason: "auth required" })
    })

    test("propagates resource impact through dependencies", () => {
        const affected = propagateResourceImpact({
            dependencies: { a: ["b"], b: ["c"], d: [] },
            invalidated: ["a"],
        })
        expect(affected).toEqual(["a", "b", "c"])
    })

    test("requires independent reviewers for high-risk L2 findings", () => {
        expect(assertIndependentL2Review({ authorId: "observer", riskClass: "high", reviewers: ["reviewer-a", "reviewer-b"] })).toBe(true)
        expect(assertIndependentL2Review({ authorId: "observer", riskClass: "high", reviewers: ["observer"] })).toBe(false)
        expect(assertIndependentL2Review({ authorId: "observer", riskClass: "medium", reviewers: ["reviewer-a"] })).toBe(true)
    })
})
