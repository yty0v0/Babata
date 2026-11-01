import { TARIC_ARTIFACT_MANIFEST } from "./compatibility"

export type TaricDeploymentProfile = "embedded_bun" | "authenticated_proxy"

export const TARIC_VERIFICATION_CHECKS = ["typecheck", "focused", "core", "build"] as const

export interface TaricVerificationArtifact {
    version: string
    integrity: string
}

export interface TaricVerificationReport {
    format: "breachweave-taric-verification/1"
    generatedAt: string
    selectedProfile: TaricDeploymentProfile
    status: "passed" | "blocked"
    sourceRevision: string
    worktree: {
        dirtyPathCount: number
        digest: string
    }
    checks: Record<(typeof TARIC_VERIFICATION_CHECKS)[number], { exitCode: number; command: string }>
    artifactDigests: Record<string, TaricVerificationArtifact>
}

export function getTaricArtifactDigests(): Record<string, TaricVerificationArtifact> {
    return Object.fromEntries(
        Object.entries({ ...TARIC_ARTIFACT_MANIFEST.packages, ...TARIC_ARTIFACT_MANIFEST.upstreamComponents })
            .map(([name, artifact]) => [name, { version: artifact.version, integrity: artifact.integrity }]),
    )
}

export function validateTaricVerificationReport(
    value: unknown,
    selectedProfile: TaricDeploymentProfile,
): string[] {
    if (!value || typeof value !== "object" || Array.isArray(value)) return ["verification report is missing or invalid"]
    const report = value as Partial<TaricVerificationReport>
    const errors: string[] = []
    if (report.format !== "breachweave-taric-verification/1") errors.push("verification report format is unsupported")
    const checksPassed = Boolean(report.checks) && TARIC_VERIFICATION_CHECKS.every((name) => report.checks?.[name]?.exitCode === 0)
    if (report.status !== "passed" || !checksPassed) errors.push("Taric verification checks have not passed")
    if (report.selectedProfile !== selectedProfile) errors.push(`verification report profile does not match selected profile ${selectedProfile}`)
    if (!checksPassed) {
        errors.push("one or more required Taric verification checks failed or are missing")
    }
    const expectedArtifacts = getTaricArtifactDigests()
    const actualArtifacts = report.artifactDigests
    if (!actualArtifacts || Object.keys(expectedArtifacts).some((name) => {
        const expected = expectedArtifacts[name]
        const actual = actualArtifacts[name]
        return !actual || actual.version !== expected.version || actual.integrity !== expected.integrity
    })) {
        errors.push("verification report artifact digests do not match the locked Taric manifest")
    }
    return errors
}

export async function assertTaricVerificationReport(path: string, profile: TaricDeploymentProfile): Promise<void> {
    let value: unknown
    try {
        value = await Bun.file(path).json()
    } catch {
        throw new Error(`Taric profile ${profile} is not verified; run bun run verify:taric for this profile`)
    }
    const errors = validateTaricVerificationReport(value, profile)
    if (errors.length > 0) {
        throw new Error(`Taric profile ${profile} is not verified: ${errors.join("; ")}`)
    }
}
