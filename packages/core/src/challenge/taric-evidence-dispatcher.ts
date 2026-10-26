export type TaricEvidenceOperation = "proposal.submit" | "admission.evaluate"

export type TaricEvidenceDispatcher = (input: {
    operation: TaricEvidenceOperation
    request: Record<string, unknown>
    principalRole?: "host" | "operator"
    principalId?: string
}) => Promise<{ ok: boolean; data?: unknown; error?: { code?: string; message?: string } }>

export interface TaricDockerEvidenceDispatcherOptions {
    image: string
    volume: string
    dockerPath?: string
    timeoutMs?: number
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

export function createDockerTaricEvidenceDispatcher(options: TaricDockerEvidenceDispatcherOptions): TaricEvidenceDispatcher {
    return async ({ operation, request, principalRole, principalId }) => {
        const engagementId = typeof request.engagement_id === "string" ? request.engagement_id.trim() : ""
        if (!engagementId) {
            return { ok: false, error: { code: "validation_error", message: "engagement_id is required" } }
        }
        const hostId = principalId?.trim() || "breachweave-host"
        const args = [
            options.dockerPath ?? "docker",
            "run",
            "--rm",
            "-e", "TARIC_DB=/data/authority.sqlite",
            "-e", "TARIC_CONTENT_ROOT=/data/content",
            "-e", `TARIC_ENGAGEMENT_ID=${engagementId}`,
            "-e", `TARIC_PRINCIPAL_ROLE=${principalRole ?? "host"}`,
            "-e", `TARIC_PRINCIPAL_ID=${hostId}`,
            "-v", `${options.volume}:/data`,
            options.image,
            operation,
            JSON.stringify(request),
        ]
        const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
        const timer = setTimeout(() => {
            proc.kill()
        }, options.timeoutMs ?? 15_000)
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
                    return JSON.parse(stdout) as { ok: boolean; data?: unknown; error?: { code?: string; message?: string } }
                } catch {
                    return { ok: false, error: { code: "internal_error", message: "Taric CLI returned invalid JSON" } }
                }
            }
            const stderr = await new Response(proc.stderr).text()
            return {
                ok: false,
                error: {
                    code: "unavailable_host",
                    message: stderr.trim() || `Taric CLI exited with ${exitCode}`,
                },
            }
        } catch (error) {
            return { ok: false, error: { code: "unavailable_host", message: getErrorMessage(error) } }
        } finally {
            clearTimeout(timer)
        }
    }
}
