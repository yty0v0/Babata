import { defineTool } from "@mariozechner/pi-coding-agent"
import type { ExtensionContext, ToolDefinition } from "@mariozechner/pi-coding-agent"
import type { Static } from "@sinclair/typebox"
import { Type } from "@sinclair/typebox"
import { readRunPolicy } from "./pentest-workspace"
import { targetAllowsUrl } from "../guardrail-policy"

export { targetAllowsUrl } from "../guardrail-policy"

const MAX_BODY_CHARS = 2_000
const MAX_RAW_CHARS = 32_000
const RAW_REQUEST_TIMEOUT_MS = 15_000

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS"
type MutationField = "path" | "query" | "header" | "cookie" | "body"

interface CapturedRequest {
    url: string
    method: HttpMethod
    headers: Record<string, string>
    cookies: Record<string, string>
    body?: string
}

interface Mutation {
    field: MutationField
    key: string
    value: string
    mode: "set" | "append" | "remove"
}

function textBlock(text: string, details: Record<string, unknown> = {}) {
    return {
        content: [{ type: "text" as const, text }],
        details,
    }
}

function requireText(value: string | undefined, field: string): string {
    const text = value?.trim()
    if (!text) throw new Error(`${field} is required`)
    return text
}

function normalizeHost(value: string): string {
    const text = value.trim()
    if (text.includes("://")) {
        try {
            return new URL(text).hostname
        } catch {
            // Fall through to plain host normalization.
        }
    }
    return text.replace(/^https?:\/\//i, "").split("/")[0].split(":")[0]
}

function normalizeHeaders(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    )
}

function normalizeMutations(value: unknown): Mutation[] {
    if (!Array.isArray(value)) return []
    return value
        .map((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return
            const raw = item as Record<string, unknown>
            if (typeof raw.field !== "string" || typeof raw.key !== "string" || typeof raw.value !== "string") return
            if (!["path", "query", "header", "cookie", "body"].includes(raw.field)) return
            const mode = raw.mode === "append" || raw.mode === "remove" ? raw.mode : "set"
            return { field: raw.field as MutationField, key: raw.key, value: raw.value, mode }
        })
        .filter((item): item is Mutation => Boolean(item))
}

export function applyMutation(request: CapturedRequest, mutation: Mutation): CapturedRequest {
    const url = new URL(request.url)
    const headers = { ...request.headers }
    const cookies = { ...request.cookies }
    const body = request.body ?? ""

    if (mutation.field === "path") {
        if (mutation.mode === "remove") {
            url.pathname = "/"
        } else if (mutation.mode === "append") {
            url.pathname = `${url.pathname.replace(/\/$/, "")}/${mutation.value.replace(/^\//, "")}`
        } else {
            url.pathname = mutation.value.startsWith("/") ? mutation.value : `/${mutation.value}`
        }
    }
    if (mutation.field === "query") {
        if (mutation.mode === "remove") url.searchParams.delete(mutation.key)
        else if (mutation.mode === "append") url.searchParams.append(mutation.key, mutation.value)
        else url.searchParams.set(mutation.key, mutation.value)
    }
    if (mutation.field === "header") {
        if (mutation.mode === "remove") delete headers[mutation.key.toLowerCase()]
        else if (mutation.mode === "append") headers[mutation.key.toLowerCase()] = `${headers[mutation.key.toLowerCase()] ?? ""}, ${mutation.value}`.replace(/^, /, "")
        else headers[mutation.key.toLowerCase()] = mutation.value
    }
    if (mutation.field === "cookie") {
        if (mutation.mode === "remove") delete cookies[mutation.key]
        else cookies[mutation.key] = mutation.value
    }
    if (mutation.field === "body") {
        return { ...request, url: url.toString(), headers, cookies, body: mutation.value }
    }

    if (Object.keys(cookies).length > 0) {
        headers.cookie = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ")
    }
    return { ...request, url: url.toString(), headers, cookies, body }
}

function redactHeaders(headers: Headers): Record<string, string> {
    const redacted: Record<string, string> = {}
    for (const [key, value] of headers.entries()) {
        redacted[key] = /authorization|cookie|set-cookie/i.test(key) ? "<redacted>" : value
    }
    return redacted
}

async function sendRequest(request: CapturedRequest, signal?: AbortSignal): Promise<{
    status: number
    headers: Record<string, string>
    body: string
    byteLength: number
}> {
    const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body ? { body: request.body } : {}),
        signal,
    })
    const bytes = new Uint8Array(await response.arrayBuffer())
    const body = new TextDecoder().decode(bytes).slice(0, MAX_BODY_CHARS)
    return {
        status: response.status,
        headers: redactHeaders(response.headers),
        body,
        byteLength: bytes.length,
    }
}

export function sendRawRequest(host: string, port: number, tls: boolean, raw: string): Promise<string> {
    return new Promise((resolve, reject) => {
        let settled = false
        let timeout: ReturnType<typeof setTimeout> | undefined
        const decoder = new TextDecoder()
        let response = ""
        const finish = (text: string) => {
            if (settled) return
            settled = true
            if (timeout) clearTimeout(timeout)
            resolve(text)
        }
        const fail = (error: unknown) => {
            if (settled) return
            settled = true
            if (timeout) clearTimeout(timeout)
            reject(error)
        }
        const maybeFinishContentLengthResponse = () => {
            const headerEnd = response.indexOf("\r\n\r\n")
            if (headerEnd < 0) return
            const headers = response.slice(0, headerEnd)
            const match = headers.match(/(?:^|\r\n)content-length\s*:\s*(\d+)/i)
            if (!match) return
            const body = response.slice(headerEnd + 4)
            if (new TextEncoder().encode(body).byteLength >= Number(match[1])) finish(response)
        }

        Bun.connect({
            hostname: host,
            port,
            ...(tls ? { tls: true } : {}),
            data: undefined,
            socket: {
                open(socket) {
                    socket.write(raw)
                },
                data(_socket, chunk) {
                    response += decoder.decode(chunk, { stream: true })
                    maybeFinishContentLengthResponse()
                },
                end() {
                    response += decoder.decode()
                    finish(response)
                },
                close() {
                    finish(response)
                },
                error(_socket, error) {
                    fail(error)
                },
                connectError(_socket, error) {
                    fail(error)
                },
            },
        }).catch(fail)
        timeout = setTimeout(() => fail(new Error(`raw HTTP request timed out after ${RAW_REQUEST_TIMEOUT_MS}ms`)), RAW_REQUEST_TIMEOUT_MS)
    })
}

async function assertInScope(cwd: string, url: string): Promise<void> {
    const policy = await readRunPolicy(cwd)
    if (!targetAllowsUrl(policy.allowed_targets, url)) {
        throw new Error(`target ${url} is outside allowed_targets in run policy`)
    }
}

export function summarizeDifference(baseline: Awaited<ReturnType<typeof sendRequest>>, exploit: Awaited<ReturnType<typeof sendRequest>>) {
    const changed = []
    if (baseline.status !== exploit.status) changed.push(`status ${baseline.status} -> ${exploit.status}`)
    if (baseline.byteLength !== exploit.byteLength) changed.push(`bytes ${baseline.byteLength} -> ${exploit.byteLength}`)
    if (baseline.body !== exploit.body) changed.push("response body changed")
    return changed.length > 0 ? changed.join("; ") : "no observable difference"
}

const HttpReplayParams = Type.Object({
    url: Type.String({ description: "Target URL. Must be inside the current run policy." }),
    method: Type.Optional(Type.Union([Type.Literal("GET"), Type.Literal("POST"), Type.Literal("PUT"), Type.Literal("PATCH"), Type.Literal("DELETE"), Type.Literal("HEAD"), Type.Literal("OPTIONS")])),
    headers: Type.Optional(Type.Record(Type.String(), Type.String())),
    cookies: Type.Optional(Type.Record(Type.String(), Type.String())),
    body: Type.Optional(Type.String()),
    mutations: Type.Optional(Type.Array(Type.Object({
        field: Type.Union([Type.Literal("path"), Type.Literal("query"), Type.Literal("header"), Type.Literal("cookie"), Type.Literal("body")]),
        key: Type.String(),
        value: Type.String(),
        mode: Type.Optional(Type.Union([Type.Literal("set"), Type.Literal("append"), Type.Literal("remove")])),
    }))),
    compare: Type.Optional(Type.Object({
        baseline: Type.Array(Type.Object({
            field: Type.Union([Type.Literal("path"), Type.Literal("query"), Type.Literal("header"), Type.Literal("cookie"), Type.Literal("body")]),
            key: Type.String(),
            value: Type.String(),
            mode: Type.Optional(Type.Union([Type.Literal("set"), Type.Literal("append"), Type.Literal("remove")])),
        })),
        exploit: Type.Array(Type.Object({
            field: Type.Union([Type.Literal("path"), Type.Literal("query"), Type.Literal("header"), Type.Literal("cookie"), Type.Literal("body")]),
            key: Type.String(),
            value: Type.String(),
            mode: Type.Optional(Type.Union([Type.Literal("set"), Type.Literal("append"), Type.Literal("remove")])),
        })),
    })),
})

type HttpReplayInput = Static<typeof HttpReplayParams>

export const httpReplayTool: ToolDefinition = defineTool({
    name: "http_replay",
    label: "HTTP Replay",
    description: "Send a structured HTTP request, mutate fields, and compare baseline vs exploit responses.",
    promptSnippet: "http_replay: send a structured in-scope HTTP request with optional mutations and baseline/exploit compare",
    parameters: HttpReplayParams,
    async execute(_toolCallId, params: HttpReplayInput, signal, _onUpdate, ctx: ExtensionContext) {
        const url = requireText(params.url, "url")
        await assertInScope(ctx.cwd, url)
        const baseRequest: CapturedRequest = {
            url,
            method: params.method ?? "GET",
            headers: normalizeHeaders(params.headers),
            cookies: normalizeHeaders(params.cookies),
            ...(params.body !== undefined ? { body: params.body } : {}),
        }
        const mutations = normalizeMutations(params.mutations)
        const request = mutations.reduce(applyMutation, baseRequest)
        const response = await sendRequest(request, signal)

        if (params.compare) {
            const baselineRequest = normalizeMutations(params.compare.baseline).reduce(applyMutation, baseRequest)
            const exploitRequest = normalizeMutations(params.compare.exploit).reduce(applyMutation, baseRequest)
            const [baseline, exploit] = await Promise.all([sendRequest(baselineRequest, signal), sendRequest(exploitRequest, signal)])
            return textBlock(
                [
                    `Baseline: ${baseline.status} (${baseline.byteLength} bytes)`,
                    `Exploit: ${exploit.status} (${exploit.byteLength} bytes)`,
                    `Difference: ${summarizeDifference(baseline, exploit)}`,
                    "",
                    "Baseline body (bounded):",
                    baseline.body,
                    "",
                    "Exploit body (bounded):",
                    exploit.body,
                ].join("\n"),
                { baseline, exploit, difference: summarizeDifference(baseline, exploit) },
            )
        }

        return textBlock(
            [`HTTP ${response.status} (${response.byteLength} bytes)`, "", response.body].join("\n"),
            { response },
        )
    },
})

const HttpReplayRawParams = Type.Object({
    raw: Type.String({ description: "Raw HTTP request text. Header order, casing, and malformed bytes are preserved." }),
    host: Type.String({ description: "Target host for raw request resolution." }),
    port: Type.Optional(Type.Number({ minimum: 1, maximum: 65535 })),
    tls: Type.Optional(Type.Boolean()),
})

type HttpReplayRawInput = Static<typeof HttpReplayRawParams>

export const httpReplayRawTool: ToolDefinition = defineTool({
    name: "http_replay_raw",
    label: "HTTP Raw Replay",
    description: "Send a byte-exact raw HTTP request to an in-scope host.",
    promptSnippet: "http_replay_raw: send byte-exact raw HTTP text for request-smuggling or malformed-header cases",
    parameters: HttpReplayRawParams,
    async execute(_toolCallId, params: HttpReplayRawInput, _signal, _onUpdate, ctx: ExtensionContext) {
        const raw = requireText(params.raw, "raw")
        const host = normalizeHost(requireText(params.host, "host"))
        const scheme = params.tls === true ? "https" : "http"
        const port = params.port
        const url = `${scheme}://${host}${port ? `:${port}` : ""}/`
        await assertInScope(ctx.cwd, url)
        const responseText = await sendRawRequest(host, port ?? (scheme === "https" ? 443 : 80), scheme === "https", raw)
        return textBlock(responseText.slice(0, MAX_RAW_CHARS), {
            host,
            port,
            tls: params.tls === true,
            normalized: false,
        })
    },
})

const CsrfExtractParams = Type.Object({
    url: Type.String(),
    headers: Type.Optional(Type.Record(Type.String(), Type.String())),
    cookies: Type.Optional(Type.Record(Type.String(), Type.String())),
})

type CsrfExtractInput = Static<typeof CsrfExtractParams>

export const csrfExtractTool: ToolDefinition = defineTool({
    name: "csrf_extract",
    label: "CSRF Extract",
    description: "Fetch an authenticated page and extract a CSRF token from common fields, meta tags, or headers.",
    promptSnippet: "csrf_extract: extract a CSRF token and field name from an authenticated in-scope page",
    parameters: CsrfExtractParams,
    async execute(_toolCallId, params: CsrfExtractInput, signal, _onUpdate, ctx: ExtensionContext) {
        const url = requireText(params.url, "url")
        await assertInScope(ctx.cwd, url)
        const headers = normalizeHeaders(params.headers)
        const cookies = normalizeHeaders(params.cookies)
        if (Object.keys(cookies).length > 0) {
            headers.cookie = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ")
        }
        const response = await fetch(url, { headers, signal })
        const body = await response.text()
        const patterns = [
            /name=["']([^"']*(?:csrf|token|nonce)[^"']*)["'][^>]*value=["']([^"']+)["']/i,
            /name=["']([^"']*)["'][^>]*value=["']([^"']{8,})["']/i,
            /<meta[^>]+name=["']csrf[^"']*["'][^>]+content=["']([^"']+)["']/i,
            /<meta[^>]+name=["']([^"']*(?:csrf|token|nonce)[^"']*)["'][^>]+content=["']([^"']+)["']/i,
        ]
        for (const pattern of patterns) {
            const match = body.match(pattern)
            if (match) {
                return textBlock(`token field: ${match[1]}\ntoken: ${match[2]}\nsource: page`, { field: match[1], value: match[2], source: "page" })
            }
        }
        return textBlock("CSRF token not found", { found: false })
    },
})

const AttackScriptParams = Type.Object({
    operation: Type.Union([
        Type.Literal("jwt_tamper"),
        Type.Literal("race_test"),
        Type.Literal("multipart_upload"),
        Type.Literal("ssrf_listener"),
        Type.Literal("wayback_extract"),
        Type.Literal("subdomain_takeover"),
        Type.Literal("cloud_storage_enum"),
    ]),
    token: Type.Optional(Type.String()),
    algorithm: Type.Optional(Type.String()),
    claim: Type.Optional(Type.String()),
    value: Type.Optional(Type.String()),
    url: Type.Optional(Type.String()),
    requests: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
    port: Type.Optional(Type.Number({ minimum: 1024, maximum: 65535 })),
    output_path: Type.Optional(Type.String()),
    bucket: Type.Optional(Type.String()),
    provider: Type.Optional(Type.String()),
})

type AttackScriptInput = Static<typeof AttackScriptParams>

const ATTACK_SCRIPT_OPERATIONS = new Set([
    "jwt_tamper",
    "race_test",
    "multipart_upload",
    "ssrf_listener",
    "wayback_extract",
    "subdomain_takeover",
    "cloud_storage_enum",
])

function decodeJwtPart(value: string): unknown {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))))
}

async function runAttackScript(params: AttackScriptInput, ctx: ExtensionContext, signal?: AbortSignal) {
    if (params.operation === "jwt_tamper") {
        const token = requireText(params.token, "token")
        const [header, payload] = token.split(".")
        return {
            header: decodeJwtPart(header),
            payload: decodeJwtPart(payload),
            note: "Tampering requires an explicit signing key. Use the returned claims to construct a signed token.",
        }
    }
    if (params.operation === "race_test") {
        const url = requireText(params.url, "url")
        await assertInScope(ctx.cwd, url)
        const count = Math.floor(params.requests ?? 5)
        const responses = await Promise.all(Array.from({ length: count }, async () => {
            const started = Date.now()
            const response = await fetch(url, { signal })
            return { status: response.status, elapsedMs: Date.now() - started }
        }))
        return { responses, distinctStatuses: [...new Set(responses.map((item) => item.status))] }
    }
    if (params.operation === "multipart_upload") {
        const url = requireText(params.url, "url")
        await assertInScope(ctx.cwd, url)
        const form = new FormData()
        form.append("file", new Blob([params.value ?? ""]), "native-tool-upload.txt")
        const response = await fetch(url, { method: "POST", body: form, signal })
        const body = await response.text()
        return { status: response.status, body: body.slice(0, MAX_BODY_CHARS) }
    }
    if (params.operation === "wayback_extract") {
        const target = requireText(params.url, "url")
        const response = await fetch(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(target)}&output=json&fl=timestamp,original,statuscode&limit=50`, { signal })
        if (!response.ok) return { available: false, status: response.status }
        return { available: true, rows: await response.json() }
    }
    return {
        available: false,
        operation: params.operation,
        reason: "This operation requires a controlled external runtime or provider credential not available in this environment.",
    }
}

export const attackScriptTool: ToolDefinition = defineTool({
    name: "attack_script",
    label: "Attack Script Dispatcher",
    description: "Run an allowlisted specialized attack operation with typed parameters.",
    promptSnippet: "attack_script: dispatch an allowlisted JWT, race, upload, SSRF, Wayback, takeover, or cloud-storage operation",
    parameters: AttackScriptParams,
    async execute(_toolCallId, params: AttackScriptInput, signal, _onUpdate, ctx: ExtensionContext) {
        if (!ATTACK_SCRIPT_OPERATIONS.has(params.operation)) {
            throw new Error(`unsupported attack_script operation: ${params.operation}`)
        }
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 30_000)
        if (typeof timer === "object" && "unref" in timer) {
            ;(timer as { unref: () => void }).unref()
        }
        try {
            const effectiveSignal = signal ?? controller.signal
            const result = await runAttackScript(params, ctx, effectiveSignal)
            return textBlock(JSON.stringify(result, null, 2).slice(0, MAX_RAW_CHARS), result)
        } finally {
            clearTimeout(timer)
        }
    },
})
