import { describe, expect, test } from "bun:test"
import { TARIC_VERIFICATION_CHECKS, getTaricArtifactDigests, validateTaricVerificationReport } from "./verification"

function passedReport() {
    return {
        format: "breachweave-taric-verification/1",
        generatedAt: "2026-10-27T00:00:00.000Z",
        selectedProfile: "authenticated_proxy",
        status: "passed",
        sourceRevision: "test-revision",
        worktree: { dirtyPathCount: 1, digest: `sha256:${"a".repeat(64)}` },
        checks: Object.fromEntries(TARIC_VERIFICATION_CHECKS.map((name) => [name, { exitCode: 0, command: `bun ${name}` }])),
        artifactDigests: getTaricArtifactDigests(),
    }
}

describe("Taric verification gate", () => {
    test("accepts a passing report for the selected profile and exact locked artifact digests", () => {
        expect(validateTaricVerificationReport(passedReport(), "authenticated_proxy")).toEqual([])
    })

    test("blocks failed checks, profile mismatch, and artifact digest mismatch", () => {
        const report = passedReport()
        report.checks.core.exitCode = 1
        report.artifactDigests["@taric/core"].integrity = "sha512-mismatch"
        const errors = validateTaricVerificationReport(report, "embedded_bun")
        expect(errors).toEqual(expect.arrayContaining([
            "Taric verification checks have not passed",
            "verification report profile does not match selected profile embedded_bun",
            "one or more required Taric verification checks failed or are missing",
            "verification report artifact digests do not match the locked Taric manifest",
        ]))
    })

    test("blocks missing or incomplete reports", () => {
        expect(validateTaricVerificationReport(undefined, "authenticated_proxy")).toEqual(["verification report is missing or invalid"])
        const report = passedReport()
        delete report.checks.typecheck
        expect(validateTaricVerificationReport(report, "authenticated_proxy")).toContain("one or more required Taric verification checks failed or are missing")
    })
})
