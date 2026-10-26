import type { TaricMaintenanceDispatcher, TaricMaintenanceOperation } from "./taric-maintenance"

export interface TaricDockerMaintenanceDispatcherOptions {
    image: string
    volume: string
    dockerPath?: string
    timeoutMs?: number
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

export function createDockerTaricMaintenanceDispatcher(options: TaricDockerMaintenanceDispatcherOptions): TaricMaintenanceDispatcher {
    return async ({ operation, request, engagementId }: { operation: TaricMaintenanceOperation; request: Record<string, unknown>; engagementId?: string }) => {
        const args = [
            options.dockerPath ?? "docker",
            "run", "--rm",
            "-e", "TARIC_DB=/data/authority.sqlite",
            "-e", "TARIC_CONTENT_ROOT=/data/content",
        ]
        if (engagementId) args.push("-e", `TARIC_ENGAGEMENT_ID=${engagementId}`)
        args.push(
            "-e", "TARIC_PRINCIPAL_ROLE=operator",
            "-e", "TARIC_PRINCIPAL_ID=breachweave-operator",
            "-v", `${options.volume}:/data`,
            options.image,
            operation,
            JSON.stringify(request),
        )
        const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
        const timer = setTimeout(() => {
            proc.kill()
        }, options.timeoutMs ?? 30_000)
        if (typeof timer === "object" && "unref" in timer) {
            ;(timer as { unref: () => void }).unref()
        }
        try {
            const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
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
                error: { code: "unavailable_host", message: stderr.trim() || `Taric CLI exited with ${exitCode}` },
            }
        } catch (error) {
            return { ok: false, error: { code: "unavailable_host", message: getErrorMessage(error) } }
        } finally {
            clearTimeout(timer)
        }
    }
}
