import { readdir } from "fs/promises"
import { join } from "path"
import { archiveChallengeRecord, listChallengeRecords, type ChallengeInfoRecord } from "../challenge/store"
import { deriveCompositeProjectKey } from "./types"

export type LegacyMigrationClassification = "trusted" | "legacy_unclassified" | "conflict"

export interface LegacyMigrationItem {
    challengeId: string
    classification: LegacyMigrationClassification
    contentDigest: string
    sourceReference: string
    createdAt: string
    projectId?: string
    sensitiveWarnings: readonly string[]
    conflicts: readonly string[]
}

export interface LegacyMigrationReport {
    rootDir: string
    generatedAt: string
    readOnly: true
    counts: {
        total: number
        trusted: number
        legacyUnclassified: number
        conflicts: number
        sensitive: number
    }
    items: readonly LegacyMigrationItem[]
}

export interface LegacyArchiveResult {
    archived: readonly string[]
    missing: readonly string[]
}

const SENSITIVE_FIELD_PATTERN = /(flag|token|secret|password|credential|authorization|cookie|api[_-]?key|private[_-]?key)/i
const SENSITIVE_VALUE_PATTERN = /flag\{[^}]*\}|bearer\s+[A-Za-z0-9._~+/=-]+|(?:sk|ak|pk)[_-][A-Za-z0-9._-]{12,}/gi

function digest(value: unknown): string {
    return new Bun.CryptoHasher("sha256").update(JSON.stringify(value)).digest("hex")
}

function warnings(value: unknown, path = "record", output: string[] = []): string[] {
    if (output.length >= 32) return output
    if (typeof value === "string") {
        if (SENSITIVE_VALUE_PATTERN.test(value)) output.push(`${path}: sensitive-looking value`)
        SENSITIVE_VALUE_PATTERN.lastIndex = 0
        return output
    }
    if (Array.isArray(value)) {
        value.slice(0, 100).forEach((item, index) => warnings(item, `${path}[${index}]`, output))
        return output
    }
    if (value && typeof value === "object") {
        Object.entries(value as Record<string, unknown>).slice(0, 200).forEach(([key, item]) => {
            const childPath = `${path}.${key}`
            if (SENSITIVE_FIELD_PATTERN.test(key)) output.push(`${childPath}: sensitive field`)
            warnings(item, childPath, output)
        })
    }
    return output
}

function sourceReference(record: ChallengeInfoRecord): string {
    return `challenge/${encodeURIComponent(record.id)}/challenge.json`
}

/** Read-only classification of legacy challenge records. No files are written. */
export async function dryRunLegacyMigration(rootDir: string): Promise<LegacyMigrationReport> {
    const records = await listChallengeRecords(rootDir)
    const projectOwners = new Map<string, string>()
    for (const record of records) {
        if (!record.project) continue
        const projectId = deriveCompositeProjectKey(record.project)
        if (!projectOwners.has(projectId)) projectOwners.set(projectId, record.id)
    }

    const items = records.map((record) => {
        const projectId = record.project ? deriveCompositeProjectKey(record.project) : undefined
        const conflicts: string[] = []
        if (projectId && projectOwners.get(projectId) !== record.id) conflicts.push(`project identity is also used by ${projectOwners.get(projectId)}`)
        const classification: LegacyMigrationClassification = conflicts.length > 0 ? "conflict" : record.project ? "trusted" : "legacy_unclassified"
        return {
            challengeId: record.id,
            classification,
            contentDigest: digest(record),
            sourceReference: sourceReference(record),
            createdAt: record.created_at,
            ...(projectId ? { projectId } : {}),
            sensitiveWarnings: warnings(record),
            conflicts,
        }
    })
    return {
        rootDir,
        generatedAt: new Date().toISOString(),
        readOnly: true,
        counts: {
            total: items.length,
            trusted: items.filter((item) => item.classification === "trusted").length,
            legacyUnclassified: items.filter((item) => item.classification === "legacy_unclassified").length,
            conflicts: items.filter((item) => item.classification === "conflict").length,
            sensitive: items.filter((item) => item.sensitiveWarnings.length > 0).length,
        },
        items,
    }
}

/** Archive only IDs explicitly selected by an operator after reviewing a dry run. */
export async function archiveLegacyUnclassified(
    report: LegacyMigrationReport,
    challengeIds: readonly string[],
    archiveRootDir?: string,
): Promise<LegacyArchiveResult> {
    const selected = new Set(challengeIds.map((id) => id.trim()).filter(Boolean))
    const allowed = new Set(report.items.filter((item) => item.classification !== "trusted").map((item) => item.challengeId))
    const archived: string[] = []
    const missing: string[] = []
    for (const id of selected) {
        if (!allowed.has(id)) throw new Error(`challenge "${id}" is not an unclassified or conflicting migration record`)
        const moved = await archiveChallengeRecord(report.rootDir, id, archiveRootDir)
        if (moved) archived.push(id)
        else missing.push(id)
    }
    return { archived, missing }
}

/** Return the archive manifest without loading or mutating the archived payload. */
export async function listLegacyArchiveEntries(archiveRootDir: string): Promise<string[]> {
    try {
        return (await readdir(archiveRootDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => join(archiveRootDir, entry.name)).sort()
    } catch {
        return []
    }
}
