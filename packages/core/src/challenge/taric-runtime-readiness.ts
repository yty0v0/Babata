export type TaricRuntimeFailureCode = "docker_unavailable" | "image_missing" | "digest_mismatch" | "volume_missing" | "authority_unhealthy" | "runtime_timeout" | "runtime_error"

export interface TaricRuntimeReadiness {
    ready: boolean
    checkedAt: string
    image: string
    volume: string
    dockerVersion?: string
    failure?: { code: TaricRuntimeFailureCode; message: string }
}

export interface TaricRuntimeCommandResult {
    exitCode: number
    stdout: string
    stderr: string
    timedOut: boolean
}

export type TaricRuntimeCommand = (args: string[], timeoutMs: number) => Promise<TaricRuntimeCommandResult>

export interface TaricRuntimeReadinessOptions {
    image: string
    volume: string
    expectedDigest?: string
    dockerPath?: string
    timeoutMs?: number
    run?: TaricRuntimeCommand
}

const DEFAULT_TIMEOUT_MS = 5_000
const MAX_DIAGNOSTIC_LENGTH = 240

function boundedMessage(value: string, fallback: string): string {
    const clean = value.replace(/[\r\n\t]+/g, " ").trim()
    return (clean || fallback).slice(0, MAX_DIAGNOSTIC_LENGTH)
}

export const runTaricRuntimeCommand: TaricRuntimeCommand = async (args, timeoutMs) => {
    const process = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
    let timedOut = false
    const timer = setTimeout(() => {
        timedOut = true
        process.kill()
    }, timeoutMs)
    if (typeof timer === "object" && "unref" in timer) {
        ;(timer as { unref: () => void }).unref()
    }
    try {
        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(process.stdout).text(),
            new Response(process.stderr).text(),
            process.exited,
        ])
        return { exitCode, stdout, stderr, timedOut }
    } finally {
        clearTimeout(timer)
    }
}

function failed(
    options: TaricRuntimeReadinessOptions,
    code: TaricRuntimeFailureCode,
    message: string,
): TaricRuntimeReadiness {
    return {
        ready: false,
        checkedAt: new Date().toISOString(),
        image: options.image,
        volume: options.volume,
        failure: { code, message: boundedMessage(message, "Taric runtime prerequisite failed") },
    }
}

/**
 * Check the Docker-backed Taric authority without mutating it. In particular,
 * this never creates/replaces a volume and never pulls an image implicitly.
 */
export async function checkTaricRuntimeReadiness(options: TaricRuntimeReadinessOptions): Promise<TaricRuntimeReadiness> {
    const docker = options.dockerPath ?? "docker"
    const timeoutMs = Math.min(Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 250), 30_000)
    const run = options.run ?? runTaricRuntimeCommand
    const invoke = (args: string[]) => run([docker, ...args], timeoutMs)

    let daemon: TaricRuntimeCommandResult
    try {
        daemon = await invoke(["info", "--format", "{{.ServerVersion}}"])
    } catch (error) {
        return failed(options, "docker_unavailable", `Docker Engine is unavailable: ${boundedMessage(String(error), "start Docker Desktop/Engine and retry")}`)
    }
    if (daemon.timedOut) return failed(options, "runtime_timeout", "Docker Engine check timed out; verify Docker Desktop/Engine is responsive")
    if (daemon.exitCode !== 0) {
        return failed(options, "docker_unavailable", `Docker Engine is unavailable: ${boundedMessage(daemon.stderr, "start Docker Desktop/Engine and retry")}`)
    }

    let image: TaricRuntimeCommandResult
    try {
        image = await invoke(["image", "inspect", options.image])
    } catch (error) {
        return failed(options, "runtime_error", `Taric image inspection failed: ${boundedMessage(String(error), "check Docker CLI")}`)
    }
    if (image.timedOut) return failed(options, "runtime_timeout", "Taric image inspection timed out")
    if (image.exitCode !== 0) return failed(options, "image_missing", `Configured Taric image is unavailable: ${options.image}`)
    if (options.expectedDigest?.trim()) {
        let digestResult: TaricRuntimeCommandResult
        try {
            digestResult = await invoke(["image", "inspect", "--format", "{{json .RepoDigests}}", options.image])
        } catch (error) {
            return failed(options, "runtime_error", `Taric image digest inspection failed: ${boundedMessage(String(error), "check Docker CLI")}`)
        }
        if (digestResult.timedOut) return failed(options, "runtime_timeout", "Taric image digest inspection timed out")
        try {
            const digests = JSON.parse(digestResult.stdout.trim() || "[]")
            const expected = options.expectedDigest.trim()
            if (digestResult.exitCode !== 0 || !Array.isArray(digests) || !digests.some((value) => typeof value === "string" && (value === expected || value.endsWith(`:${expected}`) || value.includes(expected)))) {
                return failed(options, "digest_mismatch", `Configured Taric image does not match required digest: ${options.image}`)
            }
        } catch {
            return failed(options, "digest_mismatch", "Taric image digest inspection returned invalid data")
        }
    }

    let volume: TaricRuntimeCommandResult
    try {
        volume = await invoke(["volume", "inspect", options.volume])
    } catch (error) {
        return failed(options, "runtime_error", `Taric volume inspection failed: ${boundedMessage(String(error), "check Docker CLI")}`)
    }
    if (volume.timedOut) return failed(options, "runtime_timeout", "Taric persistent volume inspection timed out")
    if (volume.exitCode !== 0) {
        return failed(options, "volume_missing", `Taric authority volume is unavailable: ${options.volume}; preserve existing data and create/restore the expected named volume before retrying`)
    }

    let doctor: TaricRuntimeCommandResult
    try {
        doctor = await invoke([
            "run", "--rm",
            "-e", "TARIC_DB=/data/authority.sqlite",
            "-e", "TARIC_CONTENT_ROOT=/data/content",
            "-e", "TARIC_PRINCIPAL_ROLE=operator",
            "-e", "TARIC_PRINCIPAL_ID=breachweave-host",
            // Taric opens SQLite and initializes WAL/schema state during CLI startup.
            // Even audit.doctor needs the existing authority volume to be writable.
            "-v", `${options.volume}:/data`,
            options.image, "audit.doctor", "{}",
        ])
    } catch (error) {
        return failed(options, "runtime_error", `Taric authority health check failed: ${boundedMessage(String(error), "check Docker CLI")}`)
    }
    if (doctor.timedOut) return failed(options, "runtime_timeout", "Taric authority health check timed out")
    if (doctor.exitCode !== 0) {
        return failed(options, "authority_unhealthy", `Taric authority health check failed: ${boundedMessage(doctor.stderr, "inspect Taric authority and volume")}`)
    }
    try {
        const output = JSON.parse(doctor.stdout) as { ok?: unknown; error?: { message?: unknown } }
        if (output?.ok !== true) {
            const detail = typeof output?.error?.message === "string" ? output.error.message : "Taric audit.doctor did not report success"
            return failed(options, "authority_unhealthy", detail)
        }
    } catch {
        return failed(options, "authority_unhealthy", "Taric authority health check returned invalid JSON")
    }

    return {
        ready: true,
        checkedAt: new Date().toISOString(),
        image: options.image,
        volume: options.volume,
        dockerVersion: boundedMessage(daemon.stdout, "unknown"),
    }
}


