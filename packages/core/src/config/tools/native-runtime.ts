import { defineTool } from "@mariozechner/pi-coding-agent"
import type { ExtensionContext, ToolDefinition } from "@mariozechner/pi-coding-agent"
import type { Static } from "@sinclair/typebox"
import { Type } from "@sinclair/typebox"
import { readRunPolicy } from "./pentest-workspace"
import { targetAllowsUrl } from "../guardrail-policy"

const MAX_OUTPUT_CHARS = 6_000

function textBlock(text: string, details: Record<string, unknown> = {}) {
    return { content: [{ type: "text" as const, text }], details }
}

function requireText(value: string | undefined, field: string): string {
    const text = value?.trim()
    if (!text) throw new Error(`${field} is required`)
    return text
}

async function assertInScope(cwd: string, url: string): Promise<void> {
    const policy = await readRunPolicy(cwd)
    if (!targetAllowsUrl(policy.allowed_targets, url)) {
        throw new Error(`target ${url} is outside allowed_targets in run policy`)
    }
}

async function runCommand(command: string, args: string[], cwd: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    try {
        const proc = Bun.spawn([command, ...args], { cwd, stdout: "pipe", stderr: "pipe" })
        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ])
        return { ok: exitCode === 0, stdout, stderr }
    } catch {
        return { ok: false, stdout: "", stderr: `${command} is not available` }
    }
}

async function ensureBrowserSidecar(): Promise<string> {
    const baseUrl = process.env.TCH_BROWSER_SIDECAR_URL?.trim() || "http://127.0.0.1:9223"
    try {
        const response = await fetch(`${baseUrl}/health`)
        if (response.ok) return baseUrl
    } catch {
        // Start the sidecar below.
    }
    const proc = Bun.spawn(["node", "/opt/browser-sidecar.mjs"], {
        stdout: "ignore",
        stderr: "ignore",
        env: {
            ...process.env,
            PORT: "9223",
        },
    })
    proc.unref()
    for (let attempt = 0; attempt < 20; attempt += 1) {
        await Bun.sleep(250)
        try {
            const response = await fetch(`${baseUrl}/health`)
            if (response.ok) return baseUrl
        } catch {
            // Wait for sidecar startup.
        }
    }
    throw new Error("browser sidecar did not start")
}

async function callBrowserSidecar(params: BrowserActionInput): Promise<Record<string, unknown>> {
    const baseUrl = await ensureBrowserSidecar()
    const response = await fetch(`${baseUrl}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
    })
    const body = (await response.json()) as Record<string, unknown>
    if (!response.ok || body.available !== true) {
        throw new Error(typeof body.error === "string" ? body.error : "browser sidecar action failed")
    }
    return body
}

const BrowserActionParams = Type.Object({
    action: Type.Union([Type.Literal("open"), Type.Literal("snapshot"), Type.Literal("click"), Type.Literal("fill"), Type.Literal("submit"), Type.Literal("screenshot"), Type.Literal("network")]),
    url: Type.Optional(Type.String()),
    ref: Type.Optional(Type.String()),
    value: Type.Optional(Type.String()),
})

type BrowserActionInput = Static<typeof BrowserActionParams>

export const browserActionTool: ToolDefinition = defineTool({
    name: "browser_action",
    label: "Browser Action",
    description: "Use the native browser runtime for typed open, snapshot, click, fill, submit, screenshot, and network actions.",
    promptSnippet: "browser_action: use the native browser runtime for navigation and form interaction",
    parameters: BrowserActionParams,
    async execute(_toolCallId, params: BrowserActionInput, _signal, _onUpdate, ctx: ExtensionContext) {
        if (params.action === "open") await assertInScope(ctx.cwd, requireText(params.url, "url"))
        try {
            const result = await callBrowserSidecar(params)
            const detail = {
                available: true,
                action: params.action,
                ...(result.page_state ? { page_state: result.page_state } : {}),
                ...(result.captured_requests ? { captured_requests: result.captured_requests } : {}),
                ...(typeof result.screenshot_bytes === "number" ? { screenshot_bytes: result.screenshot_bytes } : {}),
            }
            return textBlock(typeof result.text === "string" ? result.text : "", detail)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return textBlock(`browser runtime unavailable: ${message}`, { available: false, action: params.action })
        }
    },
})

const CLOUD_COMMANDS: Record<string, string[]> = {
    aws: ["aws", "configservice", "get-compliance-summary-by-config-rule"],
    azure: ["az", "account", "show"],
    gcp: ["gcloud", "projects", "list"],
    kubernetes: ["kubectl", "get", "pods", "--all-namespaces"],
    cicd: ["gitlab-ci-lint", "--help"],
}

const CloudAuditParams = Type.Object({
    provider: Type.Union([Type.Literal("aws"), Type.Literal("azure"), Type.Literal("gcp"), Type.Literal("kubernetes"), Type.Literal("cicd")]),
    command: Type.Optional(Type.String()),
    allow_mutation: Type.Optional(Type.Boolean()),
})

type CloudAuditInput = Static<typeof CloudAuditParams>

export const cloudAuditTool: ToolDefinition = defineTool({
    name: "cloud_audit",
    label: "Cloud Audit",
    description: "Run read-only cloud, Kubernetes, or CI/CD audit commands when the provider CLI is available.",
    promptSnippet: "cloud_audit: run a read-only provider audit command when the relevant CLI is available",
    parameters: CloudAuditParams,
    async execute(_toolCallId, params: CloudAuditInput, _signal, _onUpdate, ctx: ExtensionContext) {
        if (params.allow_mutation === true) {
            throw new Error("cloud_audit is read-only by default; host mutation policy must explicitly allow changes")
        }
        const defaultCommand = CLOUD_COMMANDS[params.provider] ?? []
        const requested = params.command?.trim() || defaultCommand[defaultCommand.length - 1] || ""
        const args = params.command?.trim() ? [requested] : defaultCommand.slice(1)
        const executable = defaultCommand[0]
        const result = await runCommand(executable, args, ctx.cwd)
        if (!result.ok) {
            return textBlock(`${params.provider} audit unavailable: ${result.stderr.trim()}`, { provider: params.provider, available: false })
        }
        return textBlock(result.stdout.slice(0, MAX_OUTPUT_CHARS), { provider: params.provider, available: true })
    },
})
