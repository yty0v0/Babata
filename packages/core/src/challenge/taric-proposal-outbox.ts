import { mkdir, readdir, rename, rm } from "fs/promises"
import { dirname, join, resolve } from "path"
import { TCH_AGENT_HOME_DIR } from "../config/index"
import { HostBridgeError } from "./host-bridge-types"
import type { NormalizedTaricProposal } from "./taric-proposal-schema"

export type TaricProposalOutboxStatus = "pending" | "inflight" | "acknowledged" | "failed" | "rolled_back"

export interface TaricProposalOutboxEntry {
    idempotency_key: string
    challenge_id: string
    engagement_id: string
    solver_id: string
    role: "planner" | "executor" | "observer" | "reviewer"
    status: TaricProposalOutboxStatus
    taric_proposal_id?: string
    admission_state?: "pending" | "approved" | "rejected"
    reviewed_by?: string
    review_reason?: string
    admission_error?: string
    proposal: NormalizedTaricProposal
    retry_count: number
    last_error?: string
    last_attempt_at?: string
    acknowledged_at?: string
    created_at: string
    updated_at: string
}

export type TaricProposalDispatcher = (entry: TaricProposalOutboxEntry) => Promise<{ ok: boolean; data?: unknown; error?: { code?: string; message?: string } }>

export interface TaricProposalOutboxOptions {
    rootDir?: string
    maxEntries?: number
}

const DEFAULT_TARIC_PROPOSAL_OUTBOX_DIR = resolve(TCH_AGENT_HOME_DIR, "taric-outbox")
const MAX_RETRIES = 5

function nowIso(): string {
    return new Date().toISOString()
}

function requireText(value: string | undefined, field: string): string {
    const text = value?.trim()
    if (!text) throw new HostBridgeError("validation_error", `${field} is required`)
    return text
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

function isIdempotencyConflict(response: { ok: boolean; error?: { code?: string } }): boolean {
    return response.error?.code === "idempotency_conflict"
}

export class TaricProposalOutbox {
    private readonly rootDir: string
    private readonly maxEntries: number

    constructor(options: TaricProposalOutboxOptions = {}) {
        this.rootDir = resolve(options.rootDir ?? DEFAULT_TARIC_PROPOSAL_OUTBOX_DIR)
        this.maxEntries = options.maxEntries ?? 1000
    }

    private entryPath(idempotencyKey: string): string {
        const key = requireText(idempotencyKey, "idempotency_key")
        if (key.includes("/") || key.includes("\\") || key.includes("..")) {
            throw new HostBridgeError("validation_error", "idempotency_key is invalid")
        }
        return join(this.rootDir, `${encodeURIComponent(key)}.json`)
    }

    async enqueue(input: Omit<TaricProposalOutboxEntry, "status" | "retry_count" | "created_at" | "updated_at">): Promise<TaricProposalOutboxEntry> {
        const timestamp = nowIso()
        const entry: TaricProposalOutboxEntry = {
            ...input,
            status: "pending",
            retry_count: 0,
            created_at: timestamp,
            updated_at: timestamp,
        }
        if (await Bun.file(this.entryPath(entry.idempotency_key)).exists()) {
            throw new HostBridgeError("conflict", "proposal idempotency_key already exists")
        }
        const entries = await this.list()
        if (entries.length >= this.maxEntries) {
            throw new HostBridgeError("conflict", "proposal outbox is full")
        }
        await atomicWriteJson(this.entryPath(entry.idempotency_key), entry)
        return entry
    }

    async get(idempotencyKey: string): Promise<TaricProposalOutboxEntry | undefined> {
        const path = this.entryPath(idempotencyKey)
        if (!(await Bun.file(path).exists())) return
        try {
            return await Bun.file(path).json() as TaricProposalOutboxEntry
        } catch {
            throw new HostBridgeError("unavailable", "failed to read proposal outbox entry")
        }
    }

    async list(statuses?: TaricProposalOutboxStatus[]): Promise<TaricProposalOutboxEntry[]> {
        let files: string[] = []
        try {
            files = await readdir(this.rootDir)
        } catch {
            return []
        }
        const entries: TaricProposalOutboxEntry[] = []
        for (const file of files.filter((item) => item.endsWith(".json"))) {
            try {
                const entry = await Bun.file(join(this.rootDir, file)).json() as TaricProposalOutboxEntry
                if (!statuses || statuses.includes(entry.status)) entries.push(entry)
            } catch {
                // Ignore a malformed entry during list; repair is operator-driven.
            }
        }
        return entries.sort((a, b) => a.created_at.localeCompare(b.created_at))
    }

    private async update(entry: TaricProposalOutboxEntry): Promise<void> {
        await atomicWriteJson(this.entryPath(entry.idempotency_key), entry)
    }

    async markInflight(idempotencyKey: string): Promise<TaricProposalOutboxEntry | undefined> {
        const entry = await this.get(idempotencyKey)
        if (!entry || entry.status !== "pending") return entry
        const updated: TaricProposalOutboxEntry = { ...entry, status: "inflight", updated_at: nowIso() }
        await this.update(updated)
        return updated
    }

    async replay(
        dispatcher: TaricProposalDispatcher,
        options: { idempotencyKeys?: string[] } = {},
    ): Promise<{ applied: number; skipped: number; failed: number }> {
        const result = { applied: 0, skipped: 0, failed: 0 }
        const scope = options.idempotencyKeys ? new Set(options.idempotencyKeys) : undefined
        const entries = (await this.list(["pending", "failed"])).filter((entry) => !scope || scope.has(entry.idempotency_key))
        for (const entry of entries) {
            if (entry.retry_count >= MAX_RETRIES) {
                result.skipped += 1
                continue
            }
            const inflight = await this.markInflight(entry.idempotency_key)
            if (!inflight || inflight.status !== "inflight") {
                result.skipped += 1
                continue
            }
            try {
                const response = await dispatcher(inflight)
                const responseData = response.data as { id?: unknown; status?: unknown } | undefined
                const rejected = responseData?.status === "rejected"
                if ((response.ok && !rejected) || isIdempotencyConflict(response)) {
                    const timestamp = nowIso()
                    const taricProposalId = responseData?.id
                    await this.update({
                        ...inflight,
                        status: "acknowledged",
                        acknowledged_at: timestamp,
                        updated_at: timestamp,
                        last_error: undefined,
                        ...(typeof taricProposalId === "string" ? { taric_proposal_id: taricProposalId } : {}),
                    })
                    result.applied += 1
                } else {
                    const message = rejected
                        ? "Taric rejected the proposal; it is not pending admission (stale attempt or invalid attribution)"
                        : response.error?.message ?? "Taric proposal submit failed"
                    await this.update({
                        ...inflight,
                        status: "failed",
                        retry_count: inflight.retry_count + 1,
                        last_error: message,
                        last_attempt_at: nowIso(),
                        updated_at: nowIso(),
                    })
                    result.failed += 1
                }
            } catch (error) {
                await this.update({
                    ...inflight,
                    status: "failed",
                    retry_count: inflight.retry_count + 1,
                    last_error: error instanceof Error ? error.message : String(error),
                    last_attempt_at: nowIso(),
                    updated_at: nowIso(),
                })
                result.failed += 1
            }
        }
        return result
    }

    async markRolledBack(idempotencyKey: string, reason?: string): Promise<void> {
        const entry = await this.get(idempotencyKey)
        if (!entry) return
        await this.update({
            ...entry,
            status: "rolled_back",
            ...(reason?.trim() ? { last_error: reason.trim() } : {}),
            updated_at: nowIso(),
        })
    }

    /**
     * Replace the buffered proposal payload without changing its lifecycle
     * state. Host-owned authority fields are refreshed at submission time.
     */
    async updateProposal(idempotencyKey: string, proposal: NormalizedTaricProposal): Promise<TaricProposalOutboxEntry | undefined> {
        const entry = await this.get(idempotencyKey)
        if (!entry) return
        if (entry.status !== "pending" && entry.status !== "failed") {
            throw new HostBridgeError("conflict", `proposal is ${entry.status} and cannot be rewritten`)
        }
        const updated: TaricProposalOutboxEntry = { ...entry, proposal, updated_at: nowIso() }
        await this.update(updated)
        return updated
    }

    async markAdmission(input: {
        idempotencyKey: string
        state: "approved" | "rejected"
        reviewedBy: string
        reason?: string
    }): Promise<TaricProposalOutboxEntry | undefined> {
        const entry = await this.get(input.idempotencyKey)
        if (!entry) return
        const updated: TaricProposalOutboxEntry = {
            ...entry,
            admission_state: input.state,
            reviewed_by: input.reviewedBy,
            review_reason: input.reason,
            admission_error: undefined,
            updated_at: nowIso(),
        }
        await this.update(updated)
        return updated
    }

    async markAdmissionError(idempotencyKey: string, error: string): Promise<void> {
        const entry = await this.get(idempotencyKey)
        if (!entry) return
        await this.update({ ...entry, admission_error: error, updated_at: nowIso() })
    }
}
