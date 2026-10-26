import { defineTool } from "@mariozechner/pi-coding-agent"
import type { ToolDefinition } from "@mariozechner/pi-coding-agent"
import type { Static } from "@sinclair/typebox"
import { Type } from "@sinclair/typebox"
import * as skills from "../skills/index"

const SkillSearchParams = Type.Object({
    action: Type.Union([
        Type.Literal("list"),
        Type.Literal("search"),
        Type.Literal("load"),
        Type.Literal("chain"),
        Type.Literal("suggest"),
    ]),
    name: Type.Optional(Type.String({ maxLength: 128 })),
    query: Type.Optional(Type.String({ maxLength: 256 })),
    tag: Type.Optional(Type.String({ maxLength: 128 })),
    cwe: Type.Optional(Type.String({ maxLength: 32 })),
    owasp_id: Type.Optional(Type.String({ maxLength: 64 })),
    category: Type.Optional(Type.String({ maxLength: 128 })),
    tech: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 12 })),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
    findings: Type.Optional(
        Type.Array(
            Type.Object({
                skill_id: Type.String({ maxLength: 128 }),
                severity: Type.Optional(
                    Type.Union([
                        Type.Literal("info"),
                        Type.Literal("low"),
                        Type.Literal("medium"),
                        Type.Literal("high"),
                        Type.Literal("critical"),
                    ]),
                ),
                cwe_id: Type.Optional(Type.String({ maxLength: 32 })),
                tech_stack: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 12 })),
            }),
            { maxItems: 30 },
        ),
    ),
})

type SkillSearchInput = Static<typeof SkillSearchParams>

function text(content: string) {
    return { content: [{ type: "text" as const, text: content }], details: {} }
}

function skillLine(skill: Awaited<ReturnType<typeof skills.listSkillMetas>>[number]): string {
    const parts = [`- ${skill.name}`, skill.category ? `(${skill.category})` : "", skill.cweIds.length > 0 ? `[${skill.cweIds.join(", ")}]` : ""]
    return parts.filter(Boolean).join(" ")
}

export function createSkillLookupTool(dir: string): ToolDefinition {
    return defineTool({
        name: "skill_lookup",
        label: "Skill Lookup",
        description:
            "Search, load, and chain specialized penetration testing skills by keyword, CWE, technology, category, or finding.",
        promptSnippet: "skill_lookup: search or load specialized pentest skills by CWE, technology, category, or finding",
        parameters: SkillSearchParams,
        async execute(_toolCallId, params: SkillSearchInput) {
            if (params.action === "load") {
                if (!params.name) throw new Error("skill_lookup load requires a skill name")
                const loaded = await skills.getSkillContent(dir, params.name)
                if (!loaded) {
                    const available = (await skills.listSkillMetas(dir)).map((skill) => skill.name).join(", ")
                    throw new Error(`skill "${params.name}" not found. Available: ${available || "none"}`)
                }
                const related = loaded.relatedFiles.slice(0, 10).map((file) => `<file>${file}</file>`).join("\n")
                return text(
                    [
                        `<skill_content name="${params.name}">`,
                        loaded.content,
                        "",
                        `Base directory: ${loaded.baseDir}`,
                        "Relative paths in this skill are resolved against the base directory.",
                        "<skill_files>",
                        related,
                        "</skill_files>",
                        "</skill_content>",
                    ].join("\n"),
                )
            }

            if (params.action === "chain" || params.action === "suggest") {
                const findings = (params.findings ?? []).map((finding) => ({
                    skillId: finding.skill_id,
                    severity: finding.severity,
                    cweId: finding.cwe_id,
                    techStack: finding.tech_stack,
                }))
                const suggestions = await skills.suggestSkills(dir, findings)
                if (suggestions.length === 0) return text("No additional skills suggested for the current findings.")
                return text(
                    [
                        `## Suggested Next Skills (${suggestions.length})`,
                        "",
                        ...suggestions.map((suggestion) => `- ${suggestion.name} [${suggestion.priority}] - ${suggestion.reason}`),
                    ].join("\n"),
                )
            }

            if (params.action === "search") {
                const results = await skills.searchSkillMetas(dir, {
                    query: params.query,
                    tag: params.tag,
                    cwe: params.cwe,
                    owaspId: params.owasp_id,
                    category: params.category,
                    tech: params.tech,
                    limit: params.limit ?? 25,
                })
                if (results.length === 0) return text("No skills matched the search criteria.")
                return text(
                    [
                        `## Skill Search Results (${results.length})`,
                        "",
                        ...results.map(skillLine),
                    ].join("\n"),
                )
            }

            const all = await skills.listSkillMetas(dir)
            return text(
                [
                    `## Available Skills (${all.length})`,
                    "",
                    ...all.map(skillLine),
                ].join("\n"),
            )
        },
    })
}
