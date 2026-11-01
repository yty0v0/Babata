export type TaricReadOperation = "context.query" | "resource.query" | "evidence.query"

export interface TaricReadResponse {
    ok: boolean
    data?: unknown
    error?: { code?: string; message?: string }
}

export interface TaricReadDispatchInput {
    operation: TaricReadOperation
    request: Record<string, unknown>
    solverId: string
    role: "planner" | "executor" | "observer" | "reviewer"
}

export type TaricReadDispatcher = (input: TaricReadDispatchInput) => Promise<TaricReadResponse>

export interface TaricDockerDispatcherOptions {
    image: string
    volume: string
    dockerPath?: string
    timeoutMs?: number
}

const TARIC_READ_OPERATIONS = new Set<TaricReadOperation>(["context.query", "resource.query", "evidence.query"])

/**
 * Taric's Docker CLI exposes one records endpoint for resource/evidence reads.
 * The dotted names are the host-side capability names and must not be passed
 * through verbatim because the CLI treats unknown operations as query aliases.
 */
export function toTaricCliOperation(operation: TaricReadOperation): string {
    return operation === "context.query" ? "context.query" : "query"
}

/**
 * Model principals intentionally receive the restricted context projection.
 * Evidence/resource reads are host-scoped metadata views: they need admitted
 * L1 observations, which Taric hides from model-principal recordsPage calls.
 * The caller still gets only the bounded read operation and the response is
 * sanitized by taric-read-board before it reaches a solver.
 */
export function taricCliPrincipalRole(operation: TaricReadOperation): "model" | "operator" {
    return operation === "context.query" ? "model" : "operator"
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function requireHeaderValue(value: string | null, name: string): string {
    const text = value?.trim()
    if (!text) throw new Error(`${name} header is required`)
    return text
}

function normalizeRole(value: string): TaricReadDispatchInput["role"] {
    if (value === "planner" || value === "executor" || value === "observer" || value === "reviewer") return value
    throw new Error("solver role is invalid")
}

export function isTaricReadOperation(value: string): value is TaricReadOperation {
    return TARIC_READ_OPERATIONS.has(value as TaricReadOperation)
}

export function createDockerTaricReadDispatcher(options: TaricDockerDispatcherOptions): TaricReadDispatcher {
    return async ({ operation, request, solverId, role }) => {
        const engagementId = typeof request.engagement_id === "string" ? request.engagement_id : ""
        if (!engagementId) {
            return { ok: false, error: { code: "validation_error", message: "engagement_id is required" } }
        }
        const args = [
            options.dockerPath ?? "docker",
            "run",
            "--rm",
            "-e", "TARIC_DB=/data/authority.sqlite",
            "-e", "TARIC_CONTENT_ROOT=/data/content",
            "-e", `TARIC_ENGAGEMENT_ID=${engagementId}`,
            "-e", `TARIC_PRINCIPAL_ROLE=${taricCliPrincipalRole(operation)}`,
            "-e", `TARIC_PRINCIPAL_ID=${role}-${solverId}`,
            "-v", `${options.volume}:/data`,
            options.image,
            toTaricCliOperation(operation),
            JSON.stringify(request),
        ]
        const proc = Bun.spawn(args, {
            stdout: "pipe",
            stderr: "pipe",
        })
        const timeoutMs = options.timeoutMs ?? 10_000
        const timer = setTimeout(() => {
            proc.kill()
        }, timeoutMs)
        if (typeof timer === "object" && "unref" in timer) {
            ;(timer as { unref: () => void }).unref()
        }
        try {
            const [stdout, exitCode] = await Promise.all([
                new Response(proc.stdout).text(),
                proc.exited,
            ])
            if (exitCode === 0) {
                try {
                    return JSON.parse(stdout) as TaricReadResponse
                } catch {
                    return { ok: false, error: { code: "internal_error", message: "Taric CLI returned invalid JSON" } }
                }
            }
            const stderr = await new Response(proc.stderr).text()
            return {
                ok: false,
                error: { code: "unavailable", message: stderr.trim() || `Taric CLI exited with ${exitCode}` },
            }
        } catch (error) {
            return { ok: false, error: { code: "unavailable", message: getErrorMessage(error) } }
        } finally {
            clearTimeout(timer)
        }
    }
}

export interface TaricReadinessSnapshot {
    ready: boolean
    failure?: { code: string; message: string }
}

export type TaricReadinessSource = TaricReadinessSnapshot | (() => TaricReadinessSnapshot | undefined)

export interface TaricHttpSidecarOptions {
    port?: number
    token: string
    dispatcher: TaricReadDispatcher
    /**
     * A snapshot is convenient for tests; the function form lets the daemon
     * publish recovery without replacing the loopback listener.
     */
    readiness?: TaricReadinessSource
}

export class TaricHttpSidecar {
    private server: ReturnType<typeof Bun.serve> | undefined
    private readinessOverride: TaricReadinessSnapshot | undefined
    private hasReadinessOverride = false

    private getReadiness(): TaricReadinessSnapshot | undefined {
        if (this.hasReadinessOverride) return this.readinessOverride
        const source = this.options.readiness
        return typeof source === "function" ? source() : source
    }

    setReadiness(readiness: TaricReadinessSnapshot): void {
        this.readinessOverride = readiness
        this.hasReadinessOverride = true
    }

    get port(): number {
        const port = this.server?.port
        if (!port) throw new Error("Taric sidecar is not running")
        return port
    }

    get running(): boolean {
        return Boolean(this.server)
    }

    async start(): Promise<void> {
        if (this.server) return
        this.server = Bun.serve({
            hostname: "127.0.0.1",
            port: this.options.port ?? 0,
            fetch: async (request) => {
                const url = new URL(request.url)
                if (request.method === "GET" && url.pathname === "/health") {
                    const readiness = this.getReadiness()
                    if (readiness?.ready === false) {
                        return Response.json(
                            { ok: false, data: { ok: false, service: "taric-read-sidecar", ready: false }, error: readiness.failure },
                            { status: 503 },
                        )
                    }
                    return Response.json({ ok: true, data: { ok: true, ready: true, service: "taric-read-sidecar" } })
                }
                const operation = url.pathname.replace(/^\/+/, "")
                if (request.method !== "POST" || !isTaricReadOperation(operation)) {
                    return Response.json(
                        { ok: false, error: { code: "authorization_error", message: "unsupported Taric operation" } },
                        { status: 403 },
                    )
                }
                if (request.headers.get("x-tch-sidecar-token") !== this.options.token) {
                    return Response.json(
                        { ok: false, error: { code: "authorization_error", message: "invalid sidecar token" } },
                        { status: 401 },
                    )
                }
                const readiness = this.getReadiness()
                if (readiness?.ready === false) {
                    return Response.json(
                        { ok: false, error: { code: "unavailable", message: readiness.failure?.message ?? "Taric authority is not ready" } },
                        { status: 503 },
                    )
                }
                try {
                    const body = await request.json()
                    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("request body must be an object")
                    const solverId = requireHeaderValue(request.headers.get("x-tch-solver-id"), "x-tch-solver-id")
                    const role = normalizeRole(requireHeaderValue(request.headers.get("x-tch-solver-role"), "x-tch-solver-role"))
                    const response = await this.options.dispatcher({
                        operation,
                        request: body as Record<string, unknown>,
                        solverId,
                        role,
                    })
                    return Response.json(response)
                } catch (error) {
                    return Response.json(
                        { ok: false, error: { code: "validation_error", message: getErrorMessage(error) } },
                        { status: 400 },
                    )
                }
            },
        })
    }

    stop(): void {
        this.server?.stop(true)
        this.server = undefined
    }

    constructor(private readonly options: TaricHttpSidecarOptions) {}
}
