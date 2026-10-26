import { projectScannedFromCoverage } from "./store"
import type { ChallengeAssetsRecord, ChallengeRecord } from "./store"

export interface CoverageUpdate {
    group: "urls" | "ips"
    asset: string
    state: NonNullable<ChallengeAssetsRecord["urls"][number]["coverage_state"]>
    reason?: string
    coverageRecordId?: string
    proposalId?: string
}

export interface CoverageGap {
    group: "urls" | "ips"
    asset: string
    state: NonNullable<ChallengeAssetsRecord["urls"][number]["coverage_state"]>
    reason?: string
}

export function applyCoverageUpdate(challenge: ChallengeRecord, update: CoverageUpdate): ChallengeRecord {
    const assets = challenge.assets ?? { urls: [], ips: [] }
    const items = assets[update.group] ?? []
    if (!items.some((item) => item.asset === update.asset)) {
        throw new Error(`asset "${update.asset}" not found in ${update.group}`)
    }
    return {
        ...challenge,
        assets: {
            ...assets,
            [update.group]: items.map((item) =>
                item.asset !== update.asset
                    ? item
                    : {
                          ...item,
                          scanned: projectScannedFromCoverage(update.state),
                          coverage_state: update.state,
                          coverage_reason: update.reason?.trim() || undefined,
                          taric_refs: {
                              ...(update.coverageRecordId ? { coverage_record_id: update.coverageRecordId } : {}),
                              ...(update.proposalId ? { proposal_id: update.proposalId } : {}),
                          },
                      },
            ),
        },
    }
}

export function rebuildCoverageProjection(challenge: ChallengeRecord): ChallengeRecord {
    const assets = challenge.assets ?? { urls: [], ips: [] }
    const rebuildGroup = (items: ChallengeAssetsRecord["urls"] | ChallengeAssetsRecord["ips"]) =>
        items.map((item) => ({
            ...item,
            scanned: item.coverage_state ? projectScannedFromCoverage(item.coverage_state) : item.scanned,
        }))
    return {
        ...challenge,
        assets: {
            urls: rebuildGroup(assets.urls),
            ips: rebuildGroup(assets.ips),
        },
    }
}

export function buildCoverageGapMatrix(challenge: ChallengeRecord): CoverageGap[] {
    const assets = challenge.assets ?? { urls: [], ips: [] }
    const gaps: CoverageGap[] = []
    for (const group of ["urls", "ips"] as const) {
        for (const item of assets[group]) {
            const state = item.coverage_state ?? (item.scanned ? "unknown" : "untested")
            if (state === "blocked" || state === "untested" || state === "unknown") {
                gaps.push({
                    group,
                    asset: item.asset,
                    state,
                    reason: item.coverage_reason,
                })
            }
        }
    }
    return gaps
}

export function propagateResourceImpact(input: {
    dependencies: Record<string, string[]>
    invalidated: string[]
}): string[] {
    const affected = new Set<string>()
    const queue = [...new Set(input.invalidated.filter((ref) => ref.trim()))]
    while (queue.length > 0) {
        const current = queue.shift()!
        if (affected.has(current)) continue
        affected.add(current)
        for (const dependent of input.dependencies[current] ?? []) {
            if (!affected.has(dependent)) queue.push(dependent)
        }
    }
    return [...affected].sort()
}

export function assertIndependentL2Review(input: {
    authorId: string
    riskClass: "informational" | "low" | "medium" | "high" | "critical"
    reviewers: string[]
}): boolean {
    const reviewers = [...new Set(input.reviewers.filter((id) => id.trim() && id.trim() !== input.authorId))]
    if (input.riskClass === "high" || input.riskClass === "critical") return reviewers.length >= 2
    return reviewers.length >= 1
}
