import { readdir, readFile } from "fs/promises"
import { resolve } from "path"
import { parseFrontmatter, stripFrontmatter } from "@mariozechner/pi-coding-agent"
import type { Skill } from "@mariozechner/pi-coding-agent"

export interface PentestSkillMeta extends Skill {
    category?: string
    owaspId?: string
    cweIds: string[]
    techStack: string[]
    tags: string[]
    chainsWith: string[]
    prerequisites: string[]
    severityBoost: Record<string, string>
}

export interface SkillSearchInput {
    query?: string
    tag?: string
    cwe?: string
    owaspId?: string
    category?: string
    tech?: string[]
    limit?: number
}

export interface SkillFinding {
    skillId: string
    severity?: "info" | "low" | "medium" | "high" | "critical"
    cweId?: string
    techStack?: string[]
}

export interface SkillSuggestion {
    name: string
    reason: string
    priority: "high" | "medium" | "low"
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function recordValue(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    )
}

export async function parseSkillMeta(skill: Skill): Promise<PentestSkillMeta> {
    const raw = await readFile(skill.filePath, "utf-8")
    const { frontmatter } = parseFrontmatter<Record<string, unknown>>(raw)
    const meta = frontmatter ?? {}
    return {
        ...skill,
        category: typeof meta.category === "string" ? meta.category : undefined,
        owaspId: typeof meta.owasp_id === "string" ? meta.owasp_id : undefined,
        cweIds: stringArray(meta.cwe_ids).map((value) => value.toUpperCase()),
        techStack: stringArray(meta.tech_stack),
        tags: stringArray(meta.tags),
        chainsWith: stringArray(meta.chains_with),
        prerequisites: stringArray(meta.prerequisites),
        severityBoost: recordValue(meta.severity_boost),
    }
}

export async function buildSkillIndex(skills: Skill[]): Promise<Map<string, PentestSkillMeta>> {
    const entries = await Promise.all(skills.map((skill) => parseSkillMeta(skill).catch(() => undefined)))
    const result = new Map<string, PentestSkillMeta>()
    for (const entry of entries) {
        if (!entry) continue
        result.set(entry.name, entry)
    }
    return result
}

function lower(value: string | undefined): string {
    return value?.toLowerCase() ?? ""
}

export function searchSkills(index: Map<string, PentestSkillMeta>, input: SkillSearchInput = {}): PentestSkillMeta[] {
    const limit = Math.max(1, Math.min(input.limit ?? 50, 100))
    const query = lower(input.query)
    const cwe = lower(input.cwe)
    const category = lower(input.category)
    const tag = lower(input.tag)
    const tech = (input.tech ?? []).map((item) => lower(item))

    const scored: Array<{ entry: PentestSkillMeta; score: number }> = []

    for (const entry of index.values()) {
        let score = 0
        if (cwe && entry.cweIds.some((item) => item.toLowerCase() === cwe)) score += 60
        if (category && lower(entry.category) === category) score += 50
        if (tag && entry.tags.some((item) => item.toLowerCase() === tag)) score += 45
        if (tech.length > 0 && entry.techStack.some((item) => tech.includes(lower(item)))) score += 40
        if (input.owaspId && lower(entry.owaspId) === lower(input.owaspId)) score += 55
        if (query) {
            if (entry.name.toLowerCase() === query) score += 100
            else if (entry.name.toLowerCase().startsWith(query)) score += 70
            else if (entry.name.toLowerCase().includes(query)) score += 30
            if (entry.description.toLowerCase().includes(query)) score += 10
            if (entry.tags.some((item) => item.toLowerCase().includes(query))) score += 15
            if (entry.cweIds.some((item) => item.toLowerCase().includes(query))) score += 20
            if (lower(entry.category).includes(query)) score += 12
        }
        if (score > 0) scored.push({ entry, score })
    }

    if (scored.length === 0 && !input.query && !input.cwe && !input.category && !input.tag && !input.tech?.length && !input.owaspId) {
        return [...index.values()].slice(0, limit)
    }

    return scored
        .sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name))
        .slice(0, limit)
        .map((item) => item.entry)
}

export async function readSkillText(skill: PentestSkillMeta): Promise<{ content: string; baseDir: string; relatedFiles: string[] }> {
    const content = stripFrontmatter(await readFile(skill.filePath, "utf-8")).trim()
    const relatedFiles: string[] = []
    try {
        const entries = await readdir(skill.baseDir, { withFileTypes: true })
        for (const entry of entries) {
            if (entry.name === "SKILL.md") continue
            relatedFiles.push(resolve(skill.baseDir, entry.name))
            if (relatedFiles.length >= 10) break
        }
    } catch {
        // A single-file skill has no related files.
    }
    return { content, baseDir: skill.baseDir, relatedFiles }
}

export function chainSuggestions(index: Map<string, PentestSkillMeta>, findings: SkillFinding[]): SkillSuggestion[] {
    const result: SkillSuggestion[] = []
    const seen = new Set<string>()
    const active = new Set(findings.map((finding) => finding.skillId))

    for (const finding of findings) {
        const entry = index.get(finding.skillId)
        if (!entry) continue

        for (const target of entry.chainsWith) {
            if (active.has(target) || seen.has(target)) continue
            seen.add(target)
            const boost = entry.severityBoost[target]
            result.push({
                name: target,
                reason: boost ?? `chains with ${finding.skillId}`,
                priority: boost ? "high" : "medium",
            })
        }

        for (const stack of finding.techStack ?? []) {
            const matching = searchSkills(index, { tech: [stack], limit: 10 }).filter((skill) => skill.name !== finding.skillId)
            for (const skill of matching) {
                if (active.has(skill.name) || seen.has(skill.name)) continue
                seen.add(skill.name)
                result.push({
                    name: skill.name,
                    reason: `matches technology ${stack}`,
                    priority: "low",
                })
            }
        }
    }

    const order = { high: 0, medium: 1, low: 2 } as const
    return result.sort((left, right) => order[left.priority] - order[right.priority] || left.name.localeCompare(right.name))
}
