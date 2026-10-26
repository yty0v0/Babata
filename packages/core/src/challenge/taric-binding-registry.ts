import { mkdir, rename, rm } from "fs/promises"
import { dirname, join, resolve } from "path"
import { HostBridgeError } from "./host-bridge-types"
import { resolveChallengeDir } from "./store"

export type TaricBindingStatus = "pending" | "active" | "failed"

export interface TaricBindingScopeSnapshot {
    allowed_targets: string[]
    excluded_targets: string[]
    allowed_ips?: string[]
    rules_of_engagement_ref: string
}

export interface TaricBindingTaricRefs {
    engagement_record_id?: string
    scope_record_id?: string
}

export interface TaricChallengeBinding {
    challenge_id: string
    engagement_id?: string
    status: TaricBindingStatus
    scope_snapshot: TaricBindingScopeSnapshot
    taric_refs?: TaricBindingTaricRefs
    failure_reason?: string
    created_at: string
    updated_at: string
}

function nowIso(): string {
    return new Date().toISOString()
}

function requireText(value: string | undefined, fieldName: string): string {
    const text = value?.trim()
    if (!text) throw new HostBridgeError("validation_error", `${fieldName} is required`)
    return text
}

function normalizeTextList(value: string[] | undefined, fieldName: string, required: boolean): string[] {
    const items = value ?? []
    if (required && items.length === 0) throw new HostBridgeError("validation_error", `${fieldName} must not be empty`)
    const normalized = items.map((item) => requireText(item, fieldName))
    return [...new Set(normalized)]
}

function normalizeScope(scope: TaricBindingScopeSnapshot): TaricBindingScopeSnapshot {
    return {
        allowed_targets: normalizeTextList(scope.allowed_targets, "allowed_targets", true),
        excluded_targets: normalizeTextList(scope.excluded_targets, "excluded_targets", false),
        ...(scope.allowed_ips ? { allowed_ips: normalizeTextList(scope.allowed_ips, "allowed_ips", false) } : {}),
        rules_of_engagement_ref: requireText(scope.rules_of_engagement_ref, "rules_of_engagement_ref"),
    }
}

function validateBinding(binding: TaricChallengeBinding): void {
    requireText(binding.challenge_id, "challenge_id")
    normalizeScope(binding.scope_snapshot)
    if (binding.status === "active") {
        requireText(binding.engagement_id, "engagement_id")
        requireText(binding.taric_refs?.engagement_record_id, "taric_refs.engagement_record_id")
    }
    if (binding.status === "failed") {
        requireText(binding.failure_reason, "failure_reason")
        if (binding.engagement_id) throw new HostBridgeError("validation_error", "failed binding must not retain engagement_id")
    }
}

async function pathExists(path: string): Promise<boolean> {
    return await Bun.file(path).exists()
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
    const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    await mkdir(dirname(path), { recursive: true })
    await Bun.write(tmpPath, JSON.stringify(value, null, 2))
    try {
        await rename(tmpPath, path)
    } catch (error) {
        await rm(tmpPath, { force: true }).catch(() => {})
        throw error
    }
}

export class TaricBindingRegistry {
    private readonly rootDir: string

    constructor(rootDir?: string) {
        this.rootDir = resolve(rootDir ?? resolveChallengeDir())
    }

    private bindingPath(challengeId: string): string {
        const id = requireText(challengeId, "challenge_id")
        if (id === "." || id === ".." || id.includes("/") || id.includes("\\")) {
            throw new HostBridgeError("validation_error", "challenge_id is invalid")
        }
        return join(this.rootDir, encodeURIComponent(id), "taric", "binding.json")
    }

    async get(challengeId: string): Promise<TaricChallengeBinding | undefined> {
        const path = this.bindingPath(challengeId)
        if (!(await pathExists(path))) return
        try {
            const binding = (await Bun.file(path).json()) as TaricChallengeBinding
            validateBinding(binding)
            return binding
        } catch (error) {
            if (error instanceof HostBridgeError) throw error
            throw new HostBridgeError("unavailable", `failed to read Taric binding for challenge ${challengeId}`)
        }
    }

    async getActiveBinding(challengeId: string): Promise<TaricChallengeBinding | undefined> {
        const binding = await this.get(challengeId)
        return binding?.status === "active" ? binding : undefined
    }

    async requireActiveBinding(challengeId: string): Promise<TaricChallengeBinding> {
        const binding = await this.getActiveBinding(challengeId)
        if (!binding?.engagement_id) {
            throw new HostBridgeError("authorization_error", `challenge has no active Taric engagement: ${challengeId}`)
        }
        return binding
    }

    async createPending(input: {
        challengeId: string
        scope: TaricBindingScopeSnapshot
    }): Promise<TaricChallengeBinding> {
        const timestamp = nowIso()
        const binding: TaricChallengeBinding = {
            challenge_id: requireText(input.challengeId, "challengeId"),
            status: "pending",
            scope_snapshot: normalizeScope(input.scope),
            created_at: timestamp,
            updated_at: timestamp,
        }
        validateBinding(binding)
        await atomicWriteJson(this.bindingPath(binding.challenge_id), binding)
        return binding
    }

    async activate(input: {
        challengeId: string
        engagementId: string
        engagementRecordId: string
        scopeRecordId?: string
    }): Promise<TaricChallengeBinding> {
        const current = await this.get(input.challengeId)
        if (!current) throw new HostBridgeError("validation_error", `challenge binding not found: ${input.challengeId}`)
        const updated: TaricChallengeBinding = {
            ...current,
            engagement_id: requireText(input.engagementId, "engagementId"),
            status: "active",
            taric_refs: {
                engagement_record_id: requireText(input.engagementRecordId, "engagementRecordId"),
                ...(input.scopeRecordId ? { scope_record_id: requireText(input.scopeRecordId, "scopeRecordId") } : {}),
            },
            failure_reason: undefined,
            updated_at: nowIso(),
        }
        validateBinding(updated)
        await atomicWriteJson(this.bindingPath(updated.challenge_id), updated)
        return updated
    }

    async fail(input: { challengeId: string; reason: string }): Promise<TaricChallengeBinding> {
        const current = await this.get(input.challengeId)
        if (!current) throw new HostBridgeError("validation_error", `challenge binding not found: ${input.challengeId}`)
        const updated: TaricChallengeBinding = {
            ...current,
            engagement_id: undefined,
            status: "failed",
            taric_refs: undefined,
            failure_reason: requireText(input.reason, "reason"),
            updated_at: nowIso(),
        }
        validateBinding(updated)
        await atomicWriteJson(this.bindingPath(updated.challenge_id), updated)
        return updated
    }
}
