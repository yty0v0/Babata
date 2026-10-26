import { readFile, realpath } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"
import { readRunPolicy } from "./tools/pentest-workspace"
import type { HostGuardrailSettings } from "./types"

export interface GuardrailDecision {
    allowed: boolean
    ruleId?: string
    reason?: string
}

const SENSITIVE_ROOTS = ["/proc", "/sys", "/dev", "/etc", "/root", "/opt/agent-assets"]
const INTERPRETERS = ["sh", "bash", "python", "python3", "perl", "ruby", "php"]
const SCRIPT_EXTENSIONS = [".sh", ".py", ".pl", ".rb", ".php"]

const DEEP_ALLOWED_TOOLS = new Set([
    "read",
    "bash",
    "edit",
    "write",
    "grep",
    "find",
    "ls",
    "skill_lookup",
    "subagent",
    "security_kimi_search",
    "http_replay",
    "http_replay_raw",
    "csrf_extract",
    "attack_script",
    "report_vulnerability",
    "triage_vulnerability",
    "browser_action",
    "cloud_audit",
    "challenge_get_hint",
    "challenge_submit_report",
    "taric_board_query",
    "taric_proposal_submit",
    "memory_list",
    "memory_add",
    "memory_update",
    "memory_delete",
    "idea_list",
    "idea_add",
    "idea_update",
    "idea_delete",
    "idea_search",
    "memory_idea_list",
    "memory_idea_add",
    "memory_idea_search",
    "memory_idea_update",
])

function normalizePath(raw: string): string {
    const value = raw.trim().replace(/^['"]|['"]$/g, "")
    if (/^[a-zA-Z]:[\\/]/.test(value)) return value.replace(/\\/g, "/")
    if (value.startsWith("~/")) return `/root/${value.slice(2)}`
    const parts: string[] = []
    for (const part of value.replace(/\\/g, "/").split("/")) {
        if (part === "" || part === ".") continue
        if (part === "..") {
            parts.pop()
            continue
        }
        parts.push(part)
    }
    return `/${parts.join("/")}`
}

function pathParent(value: string): string {
    const index = value.lastIndexOf("/")
    return index <= 0 ? "/" : value.slice(0, index)
}

async function realPath(value: string): Promise<string> {
    try {
        return await realpath(value)
    } catch {
        try {
            return await realpath(pathParent(value)).then((parent) => `${parent}/${value.slice(value.lastIndexOf("/") + 1)}`)
        } catch {
            return value
        }
    }
}

function isSensitivePath(value: string): boolean {
    const path = normalizePath(value)
    return SENSITIVE_ROOTS.some((root) => path === root || path.startsWith(`${root}/`))
}

function isWithinWorkspace(value: string, workspaceRoot: string): boolean {
    const path = normalizePath(value)
    const workspace = normalizePath(workspaceRoot)
    return path === workspace || path.startsWith(`${workspace}/`)
}

function firstString(input: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
        const value = input[key]
        if (typeof value === "string" && value.trim()) return value
    }
    return undefined
}

function textValues(value: unknown, depth = 0): string[] {
    if (depth > 6) return []
    if (typeof value === "string") return [value]
    if (Array.isArray(value)) return value.flatMap((item) => textValues(item, depth + 1))
    if (typeof value === "object" && value !== null) {
        return Object.values(value).flatMap((item) => textValues(item, depth + 1))
    }
    return []
}

function shellWords(command: string): string[] {
    const out: string[] = []
    let current = ""
    let quote = ""
    let escaped = false
    let started = false

    const push = () => {
        if (started) out.push(current)
        current = ""
        started = false
    }

    for (const char of command) {
        if (escaped) {
            current += char
            escaped = false
            continue
        }
        if (char === "\\") {
            escaped = true
            continue
        }
        if (quote) {
            if (char === quote) quote = ""
            else current += char
            continue
        }
        if (char === "'" || char === '"') {
            quote = char
            started = true
            continue
        }
        if (/\s/.test(char)) {
            push()
            continue
        }
        started = true
        current += char
    }
    push()
    return out
}

function resolvedExecutableIndex(tokens: string[]): number {
    let index = 0
    for (let depth = 0; depth < 8; depth += 1) {
        while (index < tokens.length && tokens[index].includes("=")) index += 1
        const token = tokens[index]
        if (token === "timeout") {
            index += 1
            while (index < tokens.length && tokens[index].startsWith("-")) index += 1
            if (index < tokens.length && /^\d+(\.\d+)?[smh]?$/i.test(tokens[index])) index += 1
            continue
        }
        if (token === "sudo" || token === "doas" || token === "command" || token === "nohup") {
            index += 1
            while (index < tokens.length && tokens[index].startsWith("-")) index += 1
            continue
        }
        if (token === "env" || token === "busybox") {
            index += 1
            while (index < tokens.length && tokens[index].startsWith("-")) index += 1
            continue
        }
        break
    }
    while (index < tokens.length && tokens[index].includes("=")) index += 1
    return index
}

function executableName(command: string): string {
    const tokens = shellWords(command)
    if (tokens.length === 0) return ""
    const index = resolvedExecutableIndex(tokens)
    const executable = tokens[index] ?? ""
    return executable.slice(executable.lastIndexOf("/") + 1)
}

function isDangerousWrite(command: string): boolean {
    const lower = command.toLowerCase()
    const executable = executableName(lower)
    if (["mkfs", "mkfs.ext2", "mkfs.ext3", "mkfs.ext4", "mkfs.xfs", "mkfs.btrfs", "wipefs", "fdisk", "parted", "diskpart", "format", "shutdown", "reboot", "poweroff"].includes(executable)) {
        return true
    }
    if (/\brm\s+(-[a-z]+\s+)*-\s*-?[rf]{1,2}\s+\/(\s|$)/i.test(command)) return true
    if (isDangerousDeviceWrite(command)) return true
    if (/:\s*\(\)\s*\{[^}]*\|[^}]*&\s*\};?\s*:/i.test(command)) return true
    return false
}

function isDangerousDeviceWrite(command: string): boolean {
    return /of=\/dev\/(?!(?:null|zero|random|urandom|stdout|stderr|stdin)(?=\/|\s|$)|fd\/\d+(?=\/|\s|$))[^\s;"'|&><]*/i.test(command)
}

function isReverseShell(command: string): boolean {
    const lower = command.toLowerCase()
    if (/\/dev\/tcp\//.test(lower)) return true
    if (/(^|\s)(nc|ncat|netcat)\s+.*\s+-e\b/.test(lower)) return true
    if (/\b(socat)\b[\s\S]*(exec:)/.test(lower)) return true
    if (/\b(bash|sh)\s+-i\b/.test(lower) && /[>&]/.test(lower)) return true
    if (/\bpython3?\s+-c\b/.test(lower) && /\bsocket\b|subprocess|os\.dup2|pty\.spawn/.test(lower)) return true
    if (/\bsocket\s*\.\s*connect\b|os\.dup2|pty\.spawn/.test(lower)) return true
    if (/\bsocket\b[\s\S]*\.\s*connect\s*\(/.test(lower)) return true
    if (/\bruby\b[\s\S]*(?:\s|^)(?:-e|-rsocket)\b/.test(lower) && /\btcpsocket\b|\bsocket\./.test(lower)) return true
    if (/\bperl\s+-e\b/.test(lower) && /\bsocket\b|exec/.test(lower)) return true
    if (/\bphp\s+-r\b/.test(lower) && /fsockopen|stream_socket_client/.test(lower)) return true
    return false
}

function pathTokenCandidates(command: string): string[] {
    const matches = command.match(/[^\s"';|&><]+/g) ?? []
    return matches.map((token) => token.replace(/^["']|["']$/g, "")).filter((token) => token.length > 0)
}

function extractCommandUrls(command: string): string[] {
    const matches = command.match(/\bhttps?:\/\/[^\s"'`<>()[\]{},;]+/gi) ?? []
    return matches.map((url) => url.replace(/[.,;]+$/, ""))
}

function extractBareHostPortTargets(command: string): string[] {
    const matches = command.match(/(?:^|\s)((?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}|(?:\d{1,3}\.){3}\d{1,3}):\d{1,5}(?:\/[^\s"'`<>()[\]{},;]*)?/gi) ?? []
    return matches
        .map((match) => match.trim())
        .filter((match) => !/^https?:\/\//i.test(match))
}

function extractCommandTargets(command: string): string[] {
    return [...extractCommandUrls(command), ...extractBareHostPortTargets(command)]
}

function normalizeScopeTarget(rawUrl: string): string {
    const value = rawUrl.trim()
    if (/^https?:\/\//i.test(value)) return value
    if (/^(?:(?:\d{1,3}\.){3}\d{1,3}|[a-zA-Z0-9.-]+):\d{1,5}(?:\/|$)/i.test(value)) return `http://${value}`
    return value
}

function stripHeredocBodies(command: string): string {
    const lines = command.split(/\r?\n/)
    let marker = ""
    const output: string[] = []
    for (const line of lines) {
        if (!marker) {
            const match = line.match(/<<\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/)
            if (match?.index !== undefined) {
                output.push(line.slice(0, match.index))
                marker = match[1]
                continue
            }
            output.push(line)
            continue
        }
        if (line.trim() === marker) {
            marker = ""
        }
    }
    return output.join("\n")
}

function splitCommandSegments(command: string): string[] {
    const segments: string[] = []
    let current = ""
    let quote = ""
    let escaped = false

    const push = () => {
        if (current.trim()) segments.push(current.trim())
        current = ""
    }

    for (let index = 0; index < command.length; index += 1) {
        const char = command[index]
        if (escaped) {
            current += char
            escaped = false
            continue
        }
        if (char === "\\") {
            current += char
            escaped = true
            continue
        }
        if (quote) {
            current += char
            if (char === quote) quote = ""
            continue
        }
        if (char === "'" || char === '"') {
            quote = char
            current += char
            continue
        }
        if (char === ";" || char === "\n") {
            push()
            continue
        }
        if (char === "|" || char === "&") {
            push()
            continue
        }
        current += char
    }
    push()
    return segments
}

function isSafeWriteSink(value: string): boolean {
    const path = normalizePath(value)
    return ["/dev/null", "/dev/zero", "/dev/random", "/dev/urandom", "/dev/stdout", "/dev/stderr", "/dev/stdin"].includes(path)
}

function isDestructiveRootTarget(value: string): boolean {
    const path = normalizePath(value)
    return path === "/" || path === "/*"
}

function extractRedirectionTargets(command: string): string[] {
    const targets: string[] = []
    const pattern = /(?:^|\s)([0-9]*)(>>?)\s*([^\s;"'|&><()[\]{}]+)/g
    for (const match of command.matchAll(pattern)) {
        const target = match[3]?.replace(/^["']|["']$/g, "")
        if (target) targets.push(target)
    }
    return targets
}

function extractOutputFlagPaths(command: string): string[] {
    const targets: string[] = []
    const pattern = /(?:^|\s)(?:-o|--output|-O|--output-document)\s+([^\s;"'|&><()[\]{}]+)/g
    for (const match of command.matchAll(pattern)) {
        const target = match[1]?.replace(/^["']|["']$/g, "")
        if (target) targets.push(target)
    }
    return targets
}

function commandExecutable(tokens: string[]): string {
    const index = resolvedExecutableIndex(tokens)
    const executable = tokens[index] ?? ""
    return executable.slice(executable.lastIndexOf("/") + 1)
}

function extractMutationCommandPathArgs(command: string): string[] {
    const mutationCommands = new Set(["rm", "cp", "mv", "touch", "mkdir", "chmod", "chown", "ln", "truncate", "tee", "dd", "sed", "perl", "find"])
    const paths: string[] = []
    for (const segment of splitCommandSegments(command)) {
        const tokens = shellWords(segment)
        if (tokens.length === 0) continue
        const base = commandExecutable(tokens)
        if (!mutationCommands.has(base)) continue
        if (base === "find" && !tokens.includes("-delete")) continue
        const isInlineEdit = (base === "sed" || base === "perl") && tokens.some((token) => token === "-i" || token.startsWith("-i"))
        if ((base === "sed" || base === "perl") && !isInlineEdit) continue
        const start = resolvedExecutableIndex(tokens) + 1
        for (let index = start; index < tokens.length; index += 1) {
            const token = tokens[index]
            if (!token || token === "-" || token === "--" || token.startsWith("-")) continue
            if (token.includes("=")) continue
            paths.push(token)
        }
    }
    return paths
}

function commandMutatesSensitivePath(command: string, workspaceRoot: string): boolean {
    const writeTargets = [...extractRedirectionTargets(command), ...extractOutputFlagPaths(command)].filter(
        (target) => !isSafeWriteSink(target),
    )
    const mutationTargets = extractMutationCommandPathArgs(command)
    return [...writeTargets, ...mutationTargets].some((target) => pathIsForbiddenMutationTarget(target, workspaceRoot))
}

function isWebshellPayload(command: string): boolean {
    const lower = command.toLowerCase()
    if (!/\<\?php|\<\?=/.test(lower)) return false
    if (/\b(shell_exec|system\s*\(|passthru\s*\(|exec\s*\(|eval\s*\(|assert\s*\(|base64_decode\s*\(|proc_open\s*\(|popen\s*\(|pcntl_exec\s*\(|call_user_func\s*\(|create_function\s*\()/i.test(lower)) return true
    if (/\bpreg_replace\b[\s\S]*\/e[imsx]*["']/i.test(lower)) return true
    return false
}

function indirectScriptPaths(command: string, depth = 0): string[] {
    const tokens = shellWords(command)
    if (tokens.length === 0 || depth > 3) return []
    let start = 0
    if (tokens[0] === "timeout") {
        start = 1
        while (start < tokens.length && tokens[start].startsWith("-")) start += 1
        if (start < tokens.length && /^\d+(\.\d+)?[smh]?$/i.test(tokens[start])) start += 1
    }
    const executable = tokens[start] ?? ""
    const base = executable.slice(executable.lastIndexOf("/") + 1)
    if (INTERPRETERS.includes(base)) {
        let index = start + 1
        while (
            index < tokens.length &&
            tokens[index].startsWith("-") &&
            tokens[index] !== "-" &&
            tokens[index] !== "-c" &&
            tokens[index] !== "-lc"
        ) {
            index += 1
        }
        if (tokens[index] === "-c" || tokens[index] === "-lc") {
            return []
        }
        if (tokens[index] === "-" || tokens[index]?.startsWith("<<")) {
            return []
        }
        const script = tokens[index]
        if (script) return [script]
    }
    if (SCRIPT_EXTENSIONS.some((extension) => base.endsWith(extension))) return [executable]
    return []
}

export function targetAllowsUrl(allowedTargets: string[], rawUrl: string): boolean {
    if (allowedTargets.length === 0) return true
    try {
        const url = new URL(rawUrl)
        return allowedTargets.some((target) => {
            try {
                const allowed = new URL(target)
                if (allowed.protocol !== url.protocol || effectivePort(allowed) !== effectivePort(url)) return false
                return isSameOrSubdomain(allowed.hostname, url.hostname)
            } catch {
                return url.host === target || url.origin === target
            }
        })
    } catch {
        return false
    }
}

function networkUrlForTool(toolName: string, input: Record<string, unknown>): string | undefined {
    if (toolName === "http_replay_raw") {
        const host = firstString(input, ["host", "hostname"])
        if (!host) return undefined
        const scheme = input.tls === true ? "https" : "http"
        const port = typeof input.port === "number" ? input.port : undefined
        return `${scheme}://${host}${port ? `:${port}` : ""}/`
    }
    return firstString(input, ["url", "target", "host"])
}

function effectivePort(url: URL): string {
    if (url.port) return url.port
    if (url.protocol === "https:") return "443"
    if (url.protocol === "http:") return "80"
    return ""
}

function isSameOrSubdomain(allowedHostname: string, hostname: string): boolean {
    if (allowedHostname === hostname) return true
    return hostname.endsWith(`.${allowedHostname}`)
}

function isLoopbackRuntimeUrl(rawUrl: string): boolean {
    try {
        const url = new URL(rawUrl)
        return ["127.0.0.1", "localhost", "::1", "0.0.0.0"].includes(url.hostname.toLowerCase())
    } catch {
        return false
    }
}

function resolvePath(workspaceRoot: string, rawPath: string): string {
    return isAbsolute(rawPath) ? rawPath : resolve(workspaceRoot, rawPath)
}

function pathIsForbiddenMutationTarget(rawTarget: string, workspaceRoot: string): boolean {
    const lexical = resolvePath(workspaceRoot, rawTarget)
    const normalized = normalizePath(lexical)
    if (isWithinWorkspace(normalized, workspaceRoot)) return false
    return isSensitivePath(normalized) || isDestructiveRootTarget(normalized)
}

async function evaluateCommandText(
    command: string,
    workspaceRoot: string,
): Promise<GuardrailDecision> {
    if (isDangerousWrite(command)) {
        return { allowed: false, ruleId: "bash.dangerous_write", reason: "dangerous write or system operation detected" }
    }
    if (isReverseShell(command)) {
        return { allowed: false, ruleId: "bash.reverse_shell", reason: "reverse or bind shell pattern detected" }
    }
    if (isWebshellPayload(command)) {
        return { allowed: false, ruleId: "webshell_payload", reason: "command or script content contains a webshell payload" }
    }
    if (commandMutatesSensitivePath(command, workspaceRoot)) {
        return { allowed: false, ruleId: "bash.sensitive_mutation", reason: "command mutates a sensitive path" }
    }

    const policy = await readRunPolicy(workspaceRoot)
    for (const rawTarget of extractCommandTargets(stripHeredocBodies(command))) {
        const target = normalizeScopeTarget(rawTarget)
        if (isLoopbackRuntimeUrl(rawTarget) || isLoopbackRuntimeUrl(target)) continue
        if (!targetAllowsUrl(policy.allowed_targets, target)) {
            return { allowed: false, ruleId: "scope.out_of_scope_command", reason: "command target is outside challenge scope" }
        }
    }
    return { allowed: true }
}

async function evaluateIndirectScripts(
    command: string,
    workspaceRoot: string,
): Promise<GuardrailDecision> {
    for (const script of indirectScriptPaths(command)) {
        const lexical = resolvePath(workspaceRoot, script)
        const normalized = normalizePath(lexical)
        if (isSensitivePath(normalized)) {
            return { allowed: false, ruleId: "script.sensitive_path", reason: `executed script path is not allowed: ${script}` }
        }
        if (!isWithinWorkspace(normalized, workspaceRoot)) {
            return { allowed: false, ruleId: "script.outside_workspace", reason: `executed script is outside the task workspace: ${script}` }
        }
        let body = ""
        try {
            body = await readFile(lexical, "utf8")
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return { allowed: false, ruleId: "script.read_error", reason: `cannot read executed script ${script}: ${message}` }
        }
        const bodyDecision = await evaluateCommandText(body, workspaceRoot)
        if (!bodyDecision.allowed) {
            return {
                allowed: false,
                ruleId: `script.body.${bodyDecision.ruleId ?? "unsafe"}`,
                reason: `executed script ${script} rejected: ${bodyDecision.reason}`,
            }
        }
    }
    return { allowed: true }
}

async function evaluateBash(
    input: Record<string, unknown>,
    workspaceRoot: string,
): Promise<GuardrailDecision> {
    const command = typeof input.command === "string" ? input.command.trim() : ""
    if (!command) {
        return { allowed: false, ruleId: "bash.invalid_command", reason: "invalid bash command" }
    }
    const direct = await evaluateCommandText(command, workspaceRoot)
    if (!direct.allowed) return direct
    return evaluateIndirectScripts(command, workspaceRoot)
}

async function evaluateFileMutation(
    toolName: string,
    input: Record<string, unknown>,
    workspaceRoot: string,
): Promise<GuardrailDecision> {
    const rawPath = firstString(input, ["path", "file_path", "filePath", "file", "target"])
    if (!rawPath) {
        return { allowed: false, ruleId: "file.invalid_path", reason: `${toolName} path is missing` }
    }
    const lexical = resolvePath(workspaceRoot, rawPath)
    const resolved = normalizePath(await realPath(lexical))
    if (isSensitivePath(lexical) && !isWithinWorkspace(lexical, workspaceRoot)) {
        return { allowed: false, ruleId: "file.sensitive_path", reason: `${toolName} targets a sensitive path` }
    }
    if (!isWithinWorkspace(lexical, workspaceRoot) || !isWithinWorkspace(resolved, workspaceRoot)) {
        return { allowed: false, ruleId: "file.outside_workspace", reason: `${toolName} path is outside the task workspace` }
    }

    const content = textValues(input).filter((value) => value !== rawPath).join("\n")
    if (content.trim()) {
        const bodyDecision = await evaluateCommandText(content, workspaceRoot)
        if (!bodyDecision.allowed) {
            return {
                allowed: false,
                ruleId: `file.body.${bodyDecision.ruleId ?? "unsafe"}`,
                reason: `${toolName} body rejected: ${bodyDecision.reason}`,
            }
        }
    }
    return { allowed: true }
}

async function evaluateReadPath(
    toolName: string,
    input: Record<string, unknown>,
    workspaceRoot: string,
): Promise<GuardrailDecision> {
    const rawPath = firstString(input, ["path", "file", "file_path", "filePath", "directory", "dir", "root", "target"])
    if (!rawPath) {
        return { allowed: false, ruleId: "file.invalid_path", reason: `${toolName} path is missing` }
    }
    // Sensitive paths are readable in observation and enforcement modes.
    // Only mutations are blocked by the write/edit evaluator.
    return { allowed: true }
}

export async function evaluateNetworkUrl(
    cwd: string,
    rawUrl: string,
    settings: HostGuardrailSettings | undefined,
): Promise<GuardrailDecision> {
    if (!settings?.enabled) return { allowed: true }
    try {
        const policy = await readRunPolicy(cwd)
        if (!targetAllowsUrl(policy.allowed_targets, rawUrl)) {
            return {
                allowed: false,
                ruleId: "scope.out_of_scope_url",
                reason: `URL is outside challenge scope: ${rawUrl}`,
            }
        }
        return { allowed: true }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { allowed: false, ruleId: "guardrail.error", reason: `guardrail policy evaluation failed: ${message}` }
    }
}

async function evaluateDeepToolCall(
    toolName: string,
    input: Record<string, unknown>,
    workspaceRoot: string,
): Promise<GuardrailDecision> {
    if (!DEEP_ALLOWED_TOOLS.has(toolName)) {
        return { allowed: false, ruleId: "tool.not_allowed", reason: `tool ${toolName} is not allowed by deep-mode guardrail` }
    }

    if (toolName === "bash") return evaluateBash(input, workspaceRoot)
    if (toolName === "write" || toolName === "edit") return evaluateFileMutation(toolName, input, workspaceRoot)
    if (["read", "grep", "find", "ls"].includes(toolName)) return evaluateReadPath(toolName, input, workspaceRoot)

    const rawUrl = networkUrlForTool(toolName, input)
    if (rawUrl) {
        return evaluateNetworkUrl(workspaceRoot, rawUrl, { enabled: true, phase: "enforce" })
    }
    return { allowed: true }
}

export async function evaluateGuardrailToolCall(
    toolName: string,
    input: Record<string, unknown>,
    workspaceRoot: string,
    settings: HostGuardrailSettings | undefined,
): Promise<GuardrailDecision> {
    if (!settings?.enabled) return { allowed: true }
    try {
        return await evaluateDeepToolCall(toolName, input, workspaceRoot)
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { allowed: false, ruleId: "guardrail.error", reason: `guardrail policy evaluation failed: ${message}` }
    }
}

export { DEEP_ALLOWED_TOOLS, SENSITIVE_ROOTS }
