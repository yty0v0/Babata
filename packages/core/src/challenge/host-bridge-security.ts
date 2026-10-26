import { appendFile, mkdir } from "fs/promises"
import { dirname, resolve } from "path"
import { TCH_AGENT_HOME_DIR } from "../config/index"
import { HostBridgeError, isHostBridgeErrorCode } from "./host-bridge-types"
import type { HostBridgeAction, HostBridgeErrorCode } from "./host-bridge-types"
import type { SolverInstance, SolverRole } from "../runtime/types"

export const DEFAULT_HOST_BRIDGE_AUDIT_LOG_PATH = resolve(TCH_AGENT_HOME_DIR, "logs", "host-bridge-audit.jsonl")
export const HOST_BRIDGE_ROLE_ACTIONS: Record<SolverRole, ReadonlySet<HostBridgeAction>> = {
    planner: new Set([
        "challenge_get_state",
        "challenge_is_completed",
        "challenge_get_hint",
        "challenge_memory_list",
        "challenge_idea_list",
        "challenge_idea_search",
        "taric_board_query",
        "taric_proposal_submit",
    ]),
    executor: new Set([
        "challenge_get_state",
        "challenge_is_completed",
        "challenge_get_hint",
        "challenge_submit_report",
        "challenge_memory_list",
        "challenge_memory_add",
        "challenge_idea_list",
        "challenge_idea_search",
        "challenge_idea_add",
        "taric_board_query",
        "taric_proposal_submit",
        "taric_tool_result_capture",
    ]),
    observer: new Set([
        "challenge_get_state",
        "challenge_is_completed",
        "challenge_get_hint",
        "challenge_memory_list",
        "challenge_idea_list",
        "challenge_idea_search",
        "taric_board_query",
        "taric_proposal_submit",
        "taric_tool_result_capture",
    ]),
    reviewer: new Set([
        "challenge_get_state",
        "challenge_memory_list",
        "challenge_idea_list",
        "challenge_idea_search",
        "taric_board_query",
        "taric_proposal_submit",
    ]),
}

export interface HostBridgeSecuritySettings {
    auditLogPath?: string
    requestByteLimit?: number
    requestsPerMinute?: number
    concurrentRequests?: number
    timeoutMs?: number
}

export interface HostBridgeAuditRecord {
    request_id: string
    solver_id: string
    role: SolverRole | null
    action: string
    challenge_id: string | null
    engagement_id: string | null
    status: "received" | "completed" | "denied"
    outcome: "success" | "error" | "authorization_error" | "validation_error" | "rate_limited" | "timeout" | "unavailable"
    error_code: HostBridgeErrorCode | null
    error_message: string | null
    started_at: string
    completed_at: string
    duration_ms: number
}

interface RateWindow {
    count: number
    resetAt: number
}

interface ActiveRequest {
    startedAt: number
}

export interface HostBridgeSecurityRequest {
    requestId: string
    solver: SolverInstance | undefined
    action: HostBridgeAction
    params: unknown
    challengeId?: string
    engagementId?: string
    solverId?: string
}

const DEFAULT_REQUEST_BYTE_LIMIT = 1024 * 1024
const DEFAULT_REQUESTS_PER_MINUTE = 30
const DEFAULT_CONCURRENT_REQUESTS = 4
const DEFAULT_TIMEOUT_MS = 30_000

function nowIso(): string {
    return new Date().toISOString()
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function isTimeoutError(error: unknown): error is Error {
    return error instanceof Error && error.name === "TimeoutError"
}

function outcomeForCode(code: HostBridgeErrorCode): HostBridgeAuditRecord["outcome"] {
    if (code === "authorization_error") return "authorization_error"
    if (code === "validation_error") return "validation_error"
    if (code === "rate_limited") return "rate_limited"
    if (code === "timeout") return "timeout"
    if (code === "unavailable") return "unavailable"
    return "error"
}

function normalizeError(error: unknown): { code: HostBridgeErrorCode; message: string } {
    if (error instanceof HostBridgeError) return { code: error.code, message: error.message }
    if (isTimeoutError(error)) return { code: "timeout", message: error.message }
    if (typeof error === "object" && error !== null) {
        const code = (error as { code?: unknown }).code
        const message = (error as { message?: unknown }).message
        if (isHostBridgeErrorCode(code)) {
            return {
                code,
                message: typeof message === "string" ? message : getErrorMessage(error),
            }
        }
    }
    return { code: "internal_error", message: getErrorMessage(error) }
}

async function appendJsonLine(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, `${JSON.stringify(value)}\n`, "utf8")
}

export interface TaricScopeCheck {
    challengeId?: string | null
    engagementId?: string | null
    binding: {
        challenge_id: string
        engagement_id?: string
        status: "pending" | "active" | "failed"
    }
}

export function assertTaricScope(check: TaricScopeCheck): void {
    const challengeId = check.challengeId?.trim()
    const engagementId = check.engagementId?.trim()
    if (!challengeId || challengeId !== check.binding.challenge_id) {
        throw new HostBridgeError("authorization_error", "challenge and engagement binding mismatch")
    }
    if (check.binding.status !== "active" || !check.binding.engagement_id) {
        throw new HostBridgeError("authorization_error", "challenge has no active Taric engagement")
    }
    if (engagementId && engagementId !== check.binding.engagement_id) {
        throw new HostBridgeError("authorization_error", "cross-engagement access is not allowed")
    }
}

export class HostBridgeSecurityPolicy {
    private auditLogPath: string
    private requestByteLimit: number
    private requestsPerMinute: number
    private concurrentRequests: number
    private timeoutMs: number
    private readonly rateWindows = new Map<string, RateWindow>()
    private readonly activeRequests = new Map<string, Map<string, ActiveRequest>>()

    constructor(settings: HostBridgeSecuritySettings = {}) {
        this.auditLogPath = settings.auditLogPath ?? DEFAULT_HOST_BRIDGE_AUDIT_LOG_PATH
        this.requestByteLimit = settings.requestByteLimit ?? DEFAULT_REQUEST_BYTE_LIMIT
        this.requestsPerMinute = settings.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE
        this.concurrentRequests = settings.concurrentRequests ?? DEFAULT_CONCURRENT_REQUESTS
        this.timeoutMs = settings.timeoutMs ?? DEFAULT_TIMEOUT_MS
    }

    updateSettings(settings: HostBridgeSecuritySettings): void {
        if (settings.auditLogPath !== undefined) this.auditLogPath = settings.auditLogPath
        if (settings.requestByteLimit !== undefined) this.requestByteLimit = settings.requestByteLimit
        if (settings.requestsPerMinute !== undefined) this.requestsPerMinute = settings.requestsPerMinute
        if (settings.concurrentRequests !== undefined) this.concurrentRequests = settings.concurrentRequests
        if (settings.timeoutMs !== undefined) this.timeoutMs = settings.timeoutMs
    }

    private rateKey(solverId: string, action: string): string {
        return `${solverId}\u0000${action}`
    }

    private tryAcquireRate(solverId: string, action: string): boolean {
        const key = this.rateKey(solverId, action)
        const now = Date.now()
        const current = this.rateWindows.get(key)
        if (!current || current.resetAt <= now) {
            this.rateWindows.set(key, { count: 1, resetAt: now + 60_000 })
            return true
        }
        if (current.count >= this.requestsPerMinute) return false
        current.count += 1
        return true
    }

    private tryAcquireConcurrency(solverId: string, requestId: string): boolean {
        const current = this.activeRequests.get(solverId) ?? new Map<string, ActiveRequest>()
        this.activeRequests.set(solverId, current)
        if (current.size >= this.concurrentRequests && !current.has(requestId)) return false
        current.set(requestId, { startedAt: Date.now() })
        return true
    }

    private releaseConcurrency(solverId: string, requestId: string): void {
        this.activeRequests.get(solverId)?.delete(requestId)
    }

    private validateRequestSize(params: unknown): boolean {
        try {
            return JSON.stringify(params ?? null).length <= this.requestByteLimit
        } catch {
            return false
        }
    }

    private async writeAudit(
        request: HostBridgeSecurityRequest,
        status: HostBridgeAuditRecord["status"],
        outcome: HostBridgeAuditRecord["outcome"],
        startedAt: string,
        startedTime: number,
        error?: unknown,
    ): Promise<void> {
        const normalized = error === undefined ? null : normalizeError(error)
        const record: HostBridgeAuditRecord = {
            request_id: request.requestId,
            solver_id: request.solver?.id ?? request.solverId ?? "",
            role: request.solver?.role ?? null,
            action: request.action,
            challenge_id: request.challengeId?.trim() || request.solver?.challengeId?.trim() || null,
            engagement_id: request.engagementId?.trim() || null,
            status,
            outcome,
            error_code: normalized?.code ?? null,
            error_message: normalized?.message ?? null,
            started_at: startedAt,
            completed_at: nowIso(),
            duration_ms: Date.now() - startedTime,
        }
        try {
            await appendJsonLine(this.auditLogPath, record)
        } catch (error) {
            throw new HostBridgeError("unavailable", `host bridge audit unavailable: ${getErrorMessage(error)}`)
        }
    }

    async execute<T>(request: HostBridgeSecurityRequest, handler: () => Promise<T>): Promise<T> {
        const startedAt = nowIso()
        const startedTime = Date.now()
        const solver = request.solver
        const allowedActions = solver?.role ? HOST_BRIDGE_ROLE_ACTIONS[solver.role] : undefined

        const deny = async (code: HostBridgeErrorCode, message: string, outcome: HostBridgeAuditRecord["outcome"]): Promise<never> => {
            const error = new HostBridgeError(code, message)
            await this.writeAudit(request, "denied", outcome, startedAt, startedTime, error)
            throw error
        }

        if (!solver) {
            await deny("authorization_error", "solver is not active", "authorization_error")
        }
        if (!solver?.role || !allowedActions?.has(request.action)) {
            await deny("authorization_error", `action is not allowed for solver role: ${request.action}`, "authorization_error")
        }
        if (!this.validateRequestSize(request.params)) {
            await deny("validation_error", "host bridge request exceeds size limit", "validation_error")
        }
        if (!this.tryAcquireRate(solver!.id, request.action)) {
            await deny("rate_limited", "host bridge action rate limit exceeded", "rate_limited")
        }
        if (!this.tryAcquireConcurrency(solver!.id, request.requestId)) {
            await deny("rate_limited", "host bridge concurrent request limit exceeded", "rate_limited")
        }

        try {
            await this.writeAudit(request, "received", "success", startedAt, startedTime)
        } catch (error) {
            this.releaseConcurrency(solver!.id, request.requestId)
            throw error
        }

        try {
            const result = await Promise.race([
                handler(),
                new Promise<never>((_, reject) => {
                    const timer = setTimeout(() => {
                        reject(new HostBridgeError("timeout", `host bridge action timed out after ${this.timeoutMs}ms: ${request.action}`))
                    }, this.timeoutMs)
                    if (typeof timer === "object" && "unref" in timer) {
                        ;(timer as { unref: () => void }).unref()
                    }
                }),
            ])
            await this.writeAudit(request, "completed", "success", startedAt, startedTime)
            return result
        } catch (error) {
            const normalized = normalizeError(error)
            await this.writeAudit(request, "completed", outcomeForCode(normalized.code), startedAt, startedTime, error)
            throw error instanceof Error ? error : new Error(getErrorMessage(error))
        } finally {
            this.releaseConcurrency(solver!.id, request.requestId)
        }
    }
}
