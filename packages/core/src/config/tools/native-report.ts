import { defineTool } from "@mariozechner/pi-coding-agent"
import type { ExtensionContext, ToolDefinition } from "@mariozechner/pi-coding-agent"
import type { Static } from "@sinclair/typebox"
import { Type } from "@sinclair/typebox"
import { join } from "path"

const FINDINGS_FILE = ".native-findings.json"

interface NativeFinding {
    id: string
    title: string
    severity: "info" | "low" | "medium" | "high" | "critical"
    endpoint: string
    attack_vector: string
    cwe?: string
    description: string
    reproduction_steps: string[]
    business_impact: string
    recommendation: string
    proof_of_concept: string
    status: "reported" | "approved" | "duplicate"
    duplicate_of?: string
    created_at: string
    updated_at: string
}

function requireText(value: string | undefined, field: string): string {
    const text = value?.trim()
    if (!text) throw new Error(`${field} is required`)
    return text
}

function normalizeSeverity(value: string | undefined): NativeFinding["severity"] {
    if (value === "info" || value === "low" || value === "medium" || value === "high" || value === "critical") return value
    return "medium"
}

async function readFindings(cwd: string): Promise<NativeFinding[]> {
    const file = Bun.file(join(cwd, FINDINGS_FILE))
    if (!(await file.exists())) return []
    try {
        const value = await file.json()
        return Array.isArray(value) ? value as NativeFinding[] : []
    } catch {
        return []
    }
}

async function writeFindings(cwd: string, findings: NativeFinding[]): Promise<void> {
    await Bun.write(join(cwd, FINDINGS_FILE), JSON.stringify(findings, null, 2))
}

function similarityScore(left: NativeFinding, right: NativeFinding): number {
    let score = 0
    if (left.endpoint === right.endpoint) score += 50
    if (left.attack_vector.toLowerCase() === right.attack_vector.toLowerCase()) score += 30
    if (left.cwe && left.cwe === right.cwe) score += 20
    const leftTitle = left.title.toLowerCase()
    const rightTitle = right.title.toLowerCase()
    if (leftTitle.includes(rightTitle) || rightTitle.includes(leftTitle)) score += 10
    return score
}

function findSimilar(findings: NativeFinding[], candidate: NativeFinding): NativeFinding | undefined {
    return findings
        .filter((finding) => finding.status !== "duplicate")
        .map((finding) => ({ finding, score: similarityScore(finding, candidate) }))
        .sort((a, b) => b.score - a.score)[0]?.finding
}

function textBlock(text: string, details: Record<string, unknown> = {}) {
    return { content: [{ type: "text" as const, text }], details }
}

const ReportVulnerabilityParams = Type.Object({
    title: Type.String({ minLength: 1 }),
    severity: Type.Union([Type.Literal("info"), Type.Literal("low"), Type.Literal("medium"), Type.Literal("high"), Type.Literal("critical")]),
    description: Type.String(),
    endpoint: Type.String(),
    attack_vector: Type.String(),
    cwe: Type.Optional(Type.String()),
    reproduction_steps: Type.Array(Type.String()),
    business_impact: Type.String(),
    recommendation: Type.String(),
    proof_of_concept: Type.String(),
})

type ReportVulnerabilityInput = Static<typeof ReportVulnerabilityParams>

export const reportVulnerabilityTool: ToolDefinition = defineTool({
    name: "report_vulnerability",
    label: "Report Vulnerability",
    description: "Record a structured vulnerability finding with deduplication guidance.",
    promptSnippet: "report_vulnerability: record a structured finding for later challenge report assembly",
    parameters: ReportVulnerabilityParams,
    async execute(_toolCallId, params: ReportVulnerabilityInput, _signal, _onUpdate, ctx: ExtensionContext) {
        const now = new Date().toISOString()
        const candidate: NativeFinding = {
            id: `vuln-${crypto.randomUUID().slice(0, 8)}`,
            title: requireText(params.title, "title"),
            severity: normalizeSeverity(params.severity),
            endpoint: requireText(params.endpoint, "endpoint"),
            attack_vector: requireText(params.attack_vector, "attack_vector"),
            ...(params.cwe?.trim() ? { cwe: params.cwe.trim() } : {}),
            description: requireText(params.description, "description"),
            reproduction_steps: params.reproduction_steps.map((step) => requireText(step, "reproduction_steps")).filter(Boolean),
            business_impact: requireText(params.business_impact, "business_impact"),
            recommendation: requireText(params.recommendation, "recommendation"),
            proof_of_concept: requireText(params.proof_of_concept, "proof_of_concept"),
            status: "reported",
            created_at: now,
            updated_at: now,
        }
        const findings = await readFindings(ctx.cwd)
        const similar = findSimilar(findings, candidate)
        findings.push(candidate)
        await writeFindings(ctx.cwd, findings)
        return textBlock(
            similar
                ? `Finding recorded: ${candidate.id}\nPossible duplicate: ${similar.id} (${similar.title})`
                : `Finding recorded: ${candidate.id}`,
            { finding: candidate, similar_finding: similar ? { id: similar.id, title: similar.title } : undefined },
        )
    },
})

const TriageVulnerabilityParams = Type.Object({
    finding_id: Type.String(),
    decision: Type.Union([Type.Literal("approve"), Type.Literal("duplicate")]),
    duplicate_of: Type.Optional(Type.String()),
})

type TriageVulnerabilityInput = Static<typeof TriageVulnerabilityParams>

export const triageVulnerabilityTool: ToolDefinition = defineTool({
    name: "triage_vulnerability",
    label: "Triage Vulnerability",
    description: "Approve a finding or link it as a duplicate without dropping it.",
    promptSnippet: "triage_vulnerability: approve a distinct finding or link it as a duplicate",
    parameters: TriageVulnerabilityParams,
    async execute(_toolCallId, params: TriageVulnerabilityInput, _signal, _onUpdate, ctx: ExtensionContext) {
        const findings = await readFindings(ctx.cwd)
        const index = findings.findIndex((finding) => finding.id === params.finding_id)
        if (index < 0) throw new Error(`finding not found: ${params.finding_id}`)
        const now = new Date().toISOString()
        const updated: NativeFinding = {
            ...findings[index],
            status: params.decision === "approve" ? "approved" : "duplicate",
            ...(params.duplicate_of?.trim() ? { duplicate_of: params.duplicate_of.trim() } : {}),
            updated_at: now,
        }
        findings[index] = updated
        await writeFindings(ctx.cwd, findings)
        return textBlock(`Finding ${params.finding_id} is now ${updated.status}`, { finding: updated })
    },
})

export async function listNativeFindings(cwd: string): Promise<NativeFinding[]> {
    return readFindings(cwd)
}
