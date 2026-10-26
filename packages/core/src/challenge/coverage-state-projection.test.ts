import { describe, expect, test } from "bun:test"
import { computeChallengeCompleted, hashChallengeAsset, normalizeChallengeRecord, projectScannedFromCoverage } from "./store"
import type { ChallengeRecord } from "./store"

function recordWithAssets(assets: ChallengeRecord["assets"]): ChallengeRecord {
    return normalizeChallengeRecord({
        id: "coverage-test",
        name: "Coverage Test",
        description: "",
        assets,
        planner_enabled: false,
        difficulty: "local",
        level: 1,
        hint_viewed: false,
        instance_status: "stopped",
        entrypoint: null,
        title: "Coverage Test",
    })
}

describe("coverage state projection", () => {
    test("positive and negative coverage project to scanned", () => {
        expect(projectScannedFromCoverage("positive")).toBe(true)
        expect(projectScannedFromCoverage("negative")).toBe(true)
        expect(projectScannedFromCoverage("unknown")).toBe(false)
        expect(projectScannedFromCoverage("untested")).toBe(false)
    })

    test("completion uses coverage state when present", () => {
        const challenge = recordWithAssets({
            urls: [
                { asset: "https://a.example", asset_hash: hashChallengeAsset("https://a.example"), scanned: false, coverage_state: "negative", coverage_reason: "no finding" },
                { asset: "https://b.example", asset_hash: hashChallengeAsset("https://b.example"), scanned: true, coverage_state: "positive" },
            ],
            ips: [],
        })
        expect(computeChallengeCompleted(challenge)).toBe(true)
        expect(challenge.assets?.urls[0]?.scanned).toBe(true)
    })

    test("unknown coverage is not completion", () => {
        const challenge = recordWithAssets({
            urls: [
                { asset: "https://a.example", asset_hash: hashChallengeAsset("https://a.example"), scanned: false, coverage_state: "unknown" },
            ],
            ips: [],
        })
        expect(computeChallengeCompleted(challenge)).toBe(false)
    })

    test("legacy records without coverage state still complete from scanned", () => {
        const challenge = recordWithAssets({
            urls: [
                { asset: "https://a.example", asset_hash: hashChallengeAsset("https://a.example"), scanned: true },
            ],
            ips: [],
        })
        expect(computeChallengeCompleted(challenge)).toBe(true)
    })
})
