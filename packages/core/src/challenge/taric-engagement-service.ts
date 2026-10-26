import { resolve } from "path"
import { TCH_AGENT_HOME_DIR } from "../config/index"
import { HostBridgeError } from "./host-bridge-types"
import { TaricBindingRegistry, type TaricBindingScopeSnapshot, type TaricChallengeBinding } from "./taric-binding-registry"
import type { ChallengeRecord } from "./store"

export interface TaricEngagementServiceOptions {
    image: string
    volume: string
    dockerPath?: string
    timeoutMs?: number
    bindingRegistry?: TaricBindingRegistry
}

interface TaricCliResult {
    ok: boolean
    data?: unknown
    error?: { code?: string; message?: string }
}

const DEFAULT_TIMEOUT_MS = 20_000
const CONTEXT_BUDGET = 4_000

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function collectTargets(challenge: Pick<ChallengeRecord, "assets" | "entrypoint">): string[] {
    const assets = [...(challenge.assets?.urls ?? []), ...(challenge.assets?.ips ?? [])]
        .map((item) => item.asset.trim())
        .filter((item) => item.length > 0)
    const entrypoints = (challenge.entrypoint ?? []).map((item) => item.trim()).filter((item) => item.length > 0)
    return [...new Set([...assets, ...entrypoints])]
}

export function buildTaricScopeSnapshot(challenge: Pick<ChallengeRecord, "id" | "assets" | "entrypoint">): TaricBindingScopeSnapshot {
    const allowedTargets = collectTargets(challenge)
    if (allowedTargets.length === 0) {
        throw new HostBridgeError("validation_error", `challenge ${challenge.id} has no scoped assets for Taric`)
    }
    return {
        allowed_targets: allowedTargets,
        excluded_targets: [],
        rules_of_engagement_ref: `roe:breachweave:${challenge.id}`,
    }
}

function parseCliOutput(stdout: string, stderr: string, exitCode: number): TaricCliResult {
    const text = stdout.trim() || stderr.trim()
    if (!text) {
        return { ok: false, error: { code: "unavailable", message: `Taric CLI exited with ${exitCode}` } }
    }
    try {
        return JSON.parse(text) as TaricCliResult
    } catch {
        return { ok: false, error: { code: "unavailable", message: text.slice(0, 500) } }
    }
}

export class TaricEngagementService {
    readonly bindingRegistry: TaricBindingRegistry
    private readonly image: string
    private readonly volume: string
    private readonly dockerPath: string
    private readonly timeoutMs: number

    constructor(options: TaricEngagementServiceOptions) {
        this.image = options.image
        this.volume = options.volume
        this.dockerPath = options.dockerPath ?? "docker"
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
        this.bindingRegistry = options.bindingRegistry ?? new TaricBindingRegistry()
    }

    private async run(operation: string, request: Record<string, unknown>, engagementId?: string): Promise<unknown> {
        const args = [
            this.dockerPath,
            "run",
            "--rm",
            "-e", "TARIC_DB=/data/authority.sqlite",
            "-e", "TARIC_CONTENT_ROOT=/data/content",
            "-e", "TARIC_PRINCIPAL_ROLE=operator",
            "-e", "TARIC_PRINCIPAL_ID=breachweave-host",
        ]
        if (engagementId) args.push("-e", `TARIC_ENGAGEMENT_ID=${engagementId}`)
        args.push("-v", `${this.volume}:/data`, this.image, operation, JSON.stringify(request))

        const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
        const timer = setTimeout(() => proc.kill(), this.timeoutMs)
        if (typeof timer === "object" && "unref" in timer) {
            ;(timer as { unref: () => void }).unref()
        }
        try {
            const [stdout, stderr, exitCode] = await Promise.all([
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
                proc.exited,
            ])
            const parsed = parseCliOutput(stdout, stderr, exitCode)
            if (exitCode !== 0 || parsed.ok !== true) {
                throw new HostBridgeError(
                    parsed.error?.code === "validation_error" ? "validation_error" : "unavailable",
                    parsed.error?.message?.trim() || `Taric ${operation} failed`,
                    { taric_code: parsed.error?.code ?? "unavailable" },
                )
            }
            return parsed.data
        } catch (error) {
            if (error instanceof HostBridgeError) throw error
            throw new HostBridgeError("unavailable", `Taric ${operation} failed: ${getErrorMessage(error)}`)
        } finally {
            clearTimeout(timer)
        }
    }

    async ensureBinding(challenge: Pick<ChallengeRecord, "id" | "name" | "assets" | "entrypoint">): Promise<TaricChallengeBinding> {
        const existing = await this.bindingRegistry.getActiveBinding(challenge.id)
        if (existing) return existing

        const scope = buildTaricScopeSnapshot(challenge)
        await this.bindingRegistry.createPending({ challengeId: challenge.id, scope })
        try {
            const init = (await this.run("engagement.init", {
                name: `breachweave-${challenge.id}`,
                scope,
            })) as { id?: unknown; engagement_id?: unknown } | undefined
            const engagementId = typeof init?.engagement_id === "string" ? init.engagement_id : typeof init?.id === "string" ? init.id : ""
            if (!engagementId.trim()) throw new HostBridgeError("unavailable", "Taric engagement.init returned no engagement id")

            const context = (await this.run("context.build", {
                engagement_id: engagementId,
                budget: CONTEXT_BUDGET,
            }, engagementId)) as { items?: Array<{ id?: unknown; kind?: unknown }> } | undefined
            const scopeRecordId = context?.items?.find((item) => item.kind === "scope" && typeof item.id === "string")?.id

            return await this.bindingRegistry.activate({
                challengeId: challenge.id,
                engagementId,
                engagementRecordId: engagementId,
                ...(typeof scopeRecordId === "string" ? { scopeRecordId } : {}),
            })
        } catch (error) {
            await this.bindingRegistry.fail({
                challengeId: challenge.id,
                reason: getErrorMessage(error),
            }).catch(() => {})
            throw error
        }
    }

    async countActiveBindings(challengeIds: string[]): Promise<number> {
        let count = 0
        for (const challengeId of challengeIds) {
            const binding = await this.bindingRegistry.getActiveBinding(challengeId).catch(() => undefined)
            if (binding) count += 1
        }
        return count
    }
}

export async function assertTaricImageDigest(input: {
    image: string
    expectedDigest: string
    dockerPath?: string
}): Promise<void> {
    const expected = input.expectedDigest.trim()
    if (!expected) return
    const proc = Bun.spawn([
        input.dockerPath ?? "docker",
        "image",
        "inspect",
        "--format",
        "{{json .RepoDigests}}",
        input.image,
    ], { stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    if (exitCode !== 0) {
        throw new HostBridgeError("unavailable", `failed to inspect Taric image ${input.image}: ${stderr.trim() || `exit ${exitCode}`}`)
    }
    let digests: string[] = []
    try {
        const parsed = JSON.parse(stdout.trim() || "[]")
        if (Array.isArray(parsed)) digests = parsed.filter((item): item is string => typeof item === "string")
    } catch {
        throw new HostBridgeError("unavailable", `Taric image digest output is invalid for ${input.image}`)
    }
    if (!digests.some((digest) => digest === expected || digest.endsWith(`:${expected}`) || digest.includes(expected))) {
        throw new HostBridgeError("unavailable", `Taric image digest mismatch for ${input.image}: expected ${expected}`)
    }
}

export const DEFAULT_TARIC_ARTIFACT_ROOT = resolve(TCH_AGENT_HOME_DIR, "taric-artifacts")
