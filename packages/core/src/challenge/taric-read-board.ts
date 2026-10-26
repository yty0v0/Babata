import { CHALLENGE_ENV_CHALLENGE_ID } from "./env"
import { HostBridgeError } from "./host-bridge-types"
import { TaricBindingRegistry } from "./taric-binding-registry"
import type { TaricReadDispatcher, TaricReadResponse } from "./taric-http-sidecar"
import type { HostBridgeHandleContext, HostBridgeHandler } from "../runtime/types"

export type TaricReadOperation = "context.query" | "resource.query" | "evidence.query"

export interface TaricReadBoardSettings {
    enabled?: boolean
    baseUrl?: string
    token?: string
    requestTimeoutMs?: number
    dispatcher?: TaricReadDispatcher
}

const TARIC_READ_OPERATIONS = new Set<TaricReadOperation>(["context.query", "resource.query", "evidence.query"])

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function normalizeBaseUrl(value: string): string {
    return value.replace(/\/+$/, "")
}

function getObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return value as Record<string, unknown>
}

function requireText(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) {
        throw new HostBridgeError("validation_error", `${field} is required`)
    }
    return value.trim()
}

export function normalizeTaricReadOperation(value: unknown): TaricReadOperation {
    const operation = requireText(value, "operation")
    if (!TARIC_READ_OPERATIONS.has(operation as TaricReadOperation)) {
        throw new HostBridgeError("authorization_error", `Taric operation is not allowed for model principals: ${operation}`)
    }
    return operation as TaricReadOperation
}

export function normalizeTaricReadRequest(params: unknown): Record<string, unknown> {
    const data = getObject(params)
    const request: Record<string, unknown> = {}
    // Only explicitly allowlisted read arguments are forwarded. Model-supplied
    // identity and candidate/trust promotion fields are never trusted.
    for (const key of ["budget", "cursor", "read_seq", "filters", "ordering", "work_item_id", "worker_role", "as_of", "page_size", "kind", "include_candidates"]) {
        if (data[key] !== undefined) request[key] = data[key]
    }
    // Admitted checkpoints and claims are L1, while the default Context Pack is
    // L2-only. Without this switch a solver can never read back its own
    // checkpoint, which makes the board write-only. Taric still filters L0
    // candidates, so this does not expose unreviewed proposals.
    if (request.include_candidates === undefined) request.include_candidates = true
    else request.include_candidates = request.include_candidates !== false
    return request
}

function toHostBridgeErrorCode(value: unknown): "authorization_error" | "validation_error" | "timeout" | "unavailable" {
    if (value === "authorization_error") return "authorization_error"
    if (value === "validation_error") return "validation_error"
    if (value === "timeout") return "timeout"
    return "unavailable"
}

export function assertTaricReadResponse(response: TaricReadResponse): void {
    if (!response.ok) {
        const rawCode = response.error?.code
        const code = toHostBridgeErrorCode(rawCode)
        const message = response.error?.message?.trim() || "Taric read failed"
        const followUp = (response.error as { follow_up?: unknown } | undefined)?.follow_up
        throw new HostBridgeError(code, message, {
            taric_code: typeof rawCode === "string" ? rawCode : "unavailable",
            ...(followUp !== undefined ? { follow_up: followUp } : {}),
        })
    }
    const data = response.data as { ok?: unknown; error?: { code?: unknown; message?: unknown; follow_up?: unknown } } | undefined
    if (data && typeof data === "object" && data.ok === false) {
        const rawCode = data.error?.code
        const message = typeof data.error?.message === "string" && data.error.message.trim() ? data.error.message : "Taric read business operation failed"
        throw new HostBridgeError(toHostBridgeErrorCode(rawCode), message, {
            taric_code: typeof rawCode === "string" ? rawCode : "unavailable",
            ...(data.error?.follow_up !== undefined ? { follow_up: data.error.follow_up } : {}),
        })
    }
}

const RAW_ARTIFACT_KEYS = new Set(["bytes", "payload", "raw", "raw_content", "body", "token", "secret", "credential", "credentials", "api_key", "password"])

export function sanitizeTaricReadData<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeTaricReadData(item)) as unknown as T
    }
    if (!value || typeof value !== "object") return value
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (RAW_ARTIFACT_KEYS.has(key)) continue
        output[key] = sanitizeTaricReadData(item)
    }
    return output as T
}

export interface TaricReadBoardHandlerOptions {
    settings: TaricReadBoardSettings
    bindingRegistry?: TaricBindingRegistry
    fetchImpl?: typeof fetch
}

export function createTaricReadBoardHandler(options: TaricReadBoardHandlerOptions): HostBridgeHandler {
    const bindingRegistry = options.bindingRegistry ?? new TaricBindingRegistry()
    const fetchImpl = options.fetchImpl ?? fetch
    let consecutiveFailures = 0
    let circuitOpenUntil = 0

    async function readBoard(context: HostBridgeHandleContext, params: unknown): Promise<unknown> {
        const data = getObject(params)
        const operation = normalizeTaricReadOperation(data.operation)
        if (options.settings.enabled !== true || !options.settings.baseUrl?.trim()) {
            return { degraded: true, reason: "taric_read_board_disabled" }
        }

        const challengeId = context.getSolverEnvValue(CHALLENGE_ENV_CHALLENGE_ID)?.trim()
        if (!challengeId) {
            return { degraded: true, reason: "challenge_taric_binding_unavailable" }
        }
        const binding = await bindingRegistry.getActiveBinding(challengeId)
        if (!binding?.engagement_id) {
            return { degraded: true, reason: "challenge_taric_binding_unavailable" }
        }

        if (Date.now() < circuitOpenUntil) {
            return { degraded: true, reason: "taric_read_board_circuit_open" }
        }
        const request = {
            ...normalizeTaricReadRequest(data),
            engagement_id: binding.engagement_id,
        }
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), options.settings.requestTimeoutMs ?? 5000)
        if (typeof timer === "object" && "unref" in timer) {
            ;(timer as { unref: () => void }).unref()
        }
        try {
            let parsed: TaricReadResponse
            if (options.settings.dispatcher) {
                parsed = await options.settings.dispatcher({
                    operation,
                    request,
                    solverId: context.solverId,
                    role: context.getSolver?.()?.role ?? "executor",
                })
            } else {
                const role = context.getSolver?.()?.role ?? "executor"
                const response = await fetchImpl(`${normalizeBaseUrl(options.settings.baseUrl)}/${operation}`, {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        "x-tch-sidecar-token": options.settings.token ?? "",
                        "x-tch-solver-id": context.solverId,
                        "x-tch-solver-role": role,
                    },
                    body: JSON.stringify(request),
                    signal: controller.signal,
                })
                parsed = (await response.json().catch(() => ({}))) as TaricReadResponse
            }
            assertTaricReadResponse(parsed)
            consecutiveFailures = 0
            circuitOpenUntil = 0
            return sanitizeTaricReadData(parsed.data)
        } catch (error) {
            if (error instanceof HostBridgeError) throw error
            consecutiveFailures += 1
            if (consecutiveFailures >= 3) {
                circuitOpenUntil = Date.now() + 15_000
                consecutiveFailures = 0
            }
            return { degraded: true, reason: "taric_read_board_unavailable", message: getErrorMessage(error) }
        } finally {
            clearTimeout(timer)
        }
    }

    return {
        async handle(context) {
            if (context.action !== "taric_board_query") return { handled: false }
            return {
                handled: true,
                data: await readBoard(context, context.params),
            }
        },
    }
}
