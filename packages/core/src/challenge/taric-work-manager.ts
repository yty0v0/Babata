import { mkdir, readdir, rename, rm } from "fs/promises"
import { dirname, join, resolve } from "path"
import { TCH_AGENT_HOME_DIR } from "../config/index"
import { HostBridgeError } from "./host-bridge-types"
import type { TaricProposalOutboxEntry } from "./taric-proposal-outbox"
import type { TaricCheckpointAuthority } from "./taric-proposal-schema"
import type { SolverRole } from "../runtime/types"

export type TaricWorkOperation =
    | "work.claim"
    | "work.renew"
    | "work.reclaim"
    | "work.resume"
    | "checkpoint.commit"
    | "proposal.submit"
    | "admission.evaluate"
export type TaricWorkState = "active" | "stale" | "checkpointed" | "completed" | "blocked" | "replan_required"

export type TaricWorkDispatcher = (input: {
    operation: TaricWorkOperation
    request: Record<string, unknown>
    principalRole?: "host" | "operator" | "model"
    principalId?: string
}) => Promise<{ ok: boolean; data?: unknown; error?: { code?: string; message?: string } }>

export interface TaricWorkRecord {
    work_run_id: string
    attempt_id: string
    agent_id: string
    generation: number
    challenge_id: string
    engagement_id: string
    work_item_id: string
    asset_hash?: string
    host_id: string
    solver_id: string
    role: SolverRole
    status: TaricWorkState
    read_seq: number
    work_item_version?: number
    target_version?: number
    scope_ref?: string
    scope_version?: number
    lease_expires_at?: string
    checkpoint_id?: string
    checkpoint_admitted_at?: string
    checkpoint_payload?: TaricCheckpointPayload
    checkpoint_repair_error?: string
    checkpoint_repaired_at?: string
    evidence_bound_at?: string
    evidence_gap?: string
    evidence_gap_at?: string
    committed_observation_refs?: string[]
    committed_evidence_refs?: string[]
    last_error?: string
    created_at: string
    updated_at: string
}

export interface TaricResumePacket {
    record: TaricWorkRecord
    checkpoint?: Record<string, unknown>
    replanRequired: boolean
    resumeAdvice?: string
    premiseChecks?: Record<string, unknown>
}

export interface TaricCheckpointPayload {
    next_steps: string[]
    facts_used: string[]
    open_questions: string[]
    completed_steps?: string[]
    observation_refs?: string[]
    evidence_refs?: string[]
    negative_results?: string[]
    artifact_refs?: Array<Record<string, unknown>>
    source_read_seq?: number
    target_version?: number
    work_item_version?: number
    scope_version?: number
}

function readStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
}

/**
 * Convert an admitted checkpoint proposal back into the host-owned commit
 * payload. Taric requires `next_steps`; an admitted proposal can still be
 * sparse, so the fallback keeps the WorkRun closable instead of stranding it.
 */
export function checkpointPayloadFromAdmittedProposal(content: Record<string, unknown>): TaricCheckpointPayload {
    const contextManifest = content.context_manifest && typeof content.context_manifest === "object"
        ? content.context_manifest as Record<string, unknown>
        : undefined
    const manifestFacts = Array.isArray(contextManifest?.sources)
        ? (contextManifest.sources as unknown[])
              .map((source) => (source && typeof source === "object" ? (source as Record<string, unknown>).summary : undefined))
              .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : []
    const factsUsed = readStringList(content.facts_used)
    const nextSteps = readStringList(content.next_steps)
    return {
        completed_steps: readStringList(content.completed_steps),
        next_steps: nextSteps.length > 0 ? nextSteps : ["Continue from the admitted checkpoint"],
        facts_used: factsUsed.length > 0 ? factsUsed : manifestFacts,
        open_questions: readStringList(content.unresolved_work ?? content.open_questions),
        negative_results: readStringList(content.negative_results),
        ...(typeof content.source_read_seq === "number" ? { source_read_seq: content.source_read_seq } : {}),
        ...(typeof content.target_version === "number" ? { target_version: content.target_version } : {}),
        ...(typeof content.work_item_version === "number" ? { work_item_version: content.work_item_version } : {}),
        ...(typeof content.scope_version === "number" ? { scope_version: content.scope_version } : {}),
    }
}

export interface TaricWorkItemInput {
    challengeId: string
    engagementId: string
    solverId: string
    role: SolverRole
    scopeRef?: string
    assetHash?: string
    title?: string
    goal?: string
}

export interface TaricWorkItemRecord {
    work_item_id: string
    proposal_id?: string
    challenge_id: string
    engagement_id: string
    solver_id: string
    asset_hash?: string
    scope_ref?: string
    status?: "queued" | "claimed" | "closed"
    closed_at?: string
    created_at: string
}

export interface TaricWorkManagerOptions {
    rootDir?: string
    dispatcher: TaricWorkDispatcher
    leaseMs?: number
    policyDigest?: string
    hostId?: string
}

const DEFAULT_TARIC_WORK_DIR = resolve(TCH_AGENT_HOME_DIR, "taric-work")
const DEFAULT_LEASE_MS = 5 * 60 * 1000
const MIN_TARIC_LEASE_MS = 60_000
const MAX_TARIC_LEASE_MS = 900_000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function resolveTaricLeaseMs(value: string | number | undefined): number {
    const parsed = typeof value === "number" ? value : Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LEASE_MS
    return Math.min(MAX_TARIC_LEASE_MS, Math.max(MIN_TARIC_LEASE_MS, Math.floor(parsed)))
}

function nowIso(): string {
    return new Date().toISOString()
}

function requireText(value: string | undefined, field: string): string {
    const text = value?.trim()
    if (!text) throw new HostBridgeError("validation_error", `${field} is required`)
    return text
}

function requireTextList(value: string[] | undefined, field: string, minItems: number): string[] {
    if (!Array.isArray(value) || value.length < minItems) {
        throw new HostBridgeError("validation_error", `${field} must contain at least ${minItems} item(s)`)
    }
    const items = value.map((item) => requireText(item, field))
    return [...new Set(items)]
}

function requireUuidList(value: string[] | undefined, field: string): string[] {
    const items = requireTextList(value ?? [], field, 0)
    for (const item of items) {
        if (!UUID_PATTERN.test(item)) {
            throw new HostBridgeError("validation_error", `${field} must contain UUIDs`)
        }
    }
    return items
}

function cloneCheckpointPayload(payload: TaricCheckpointPayload): TaricCheckpointPayload {
    return {
        ...payload,
        next_steps: [...payload.next_steps],
        facts_used: [...payload.facts_used],
        open_questions: [...payload.open_questions],
        ...(payload.completed_steps ? { completed_steps: [...payload.completed_steps] } : {}),
        ...(payload.observation_refs ? { observation_refs: [...payload.observation_refs] } : {}),
        ...(payload.evidence_refs ? { evidence_refs: [...payload.evidence_refs] } : {}),
        ...(payload.negative_results ? { negative_results: [...payload.negative_results] } : {}),
        ...(payload.artifact_refs ? { artifact_refs: payload.artifact_refs.map((item) => ({ ...item })) } : {}),
    }
}

function requireNonNegativeInteger(value: number | undefined, field: string): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new HostBridgeError("validation_error", `${field} must be a non-negative integer`)
    }
    return value
}

function requirePositiveInteger(value: number | undefined, field: string): number {
    const parsed = requireNonNegativeInteger(value, field)
    if (parsed < 1) throw new HostBridgeError("validation_error", `${field} must be a positive integer`)
    return parsed
}

/**
 * Taric binds model proposals to the WorkRun owner agent. The Docker
 * dispatcher authenticates model calls as `<role>-<solverId>`, so claims must
 * use the same identity or every checkpoint is quarantined as a stale attempt.
 */
export function taricModelPrincipalId(role: SolverRole, solverId: string): string {
    return requireText(`${role}-${solverId}`, "principal_id")
}

function toHostBridgeErrorCode(value: unknown): "validation_error" | "timeout" | "unavailable" {
    if (value === "validation_error") return "validation_error"
    if (value === "timeout") return "timeout"
    return "unavailable"
}

function assertDispatcherResponse(response: { ok: boolean; data?: unknown; error?: { code?: string; message?: string } }): void {
    if (response.ok) return
    const code = toHostBridgeErrorCode(response.error?.code)
    throw new HostBridgeError(code, response.error?.message?.trim() || "Taric work operation failed", {
        taric_code: typeof response.error?.code === "string" ? response.error.code : "unavailable",
    })
}

function sanitizeFileName(value: string): string {
    const text = value.trim()
    if (!text || text === "." || text === ".." || text.includes("/") || text.includes("\\")) {
        throw new HostBridgeError("validation_error", "work_run_id is invalid")
    }
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

export class TaricWorkManager {
    private readonly rootDir: string
    private readonly dispatcher: TaricWorkDispatcher
    private readonly leaseMs: number
    private readonly policyDigest: string
    private readonly hostId: string
    private readonly claimPromises = new Map<string, Promise<TaricWorkRecord>>()
    private repairPromise: Promise<{
        repaired: number
        awaitingRepair: number
        failed: number
        lastError?: string
    }> | undefined

    constructor(options: TaricWorkManagerOptions) {
        this.rootDir = resolve(options.rootDir ?? DEFAULT_TARIC_WORK_DIR)
        this.dispatcher = options.dispatcher
        this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
        this.policyDigest = options.policyDigest ?? `sha256:${"0".repeat(64)}`
        this.hostId = options.hostId?.trim() || "breachweave-host"
    }

    get effectiveLeaseMs(): number {
        return this.leaseMs
    }

    private recordPath(workRunId: string): string {
        return join(this.rootDir, `${encodeURIComponent(sanitizeFileName(workRunId))}.json`)
    }

    private workItemPath(challengeId: string, solverId: string): string {
        return join(this.rootDir, `work-item-${encodeURIComponent(sanitizeFileName(challengeId))}-${encodeURIComponent(sanitizeFileName(solverId))}.json`)
    }

    async getWorkItem(challengeId: string, solverId: string): Promise<TaricWorkItemRecord | undefined> {
        const path = this.workItemPath(challengeId, solverId)
        if (!(await Bun.file(path).exists())) return
        try {
            return await Bun.file(path).json() as TaricWorkItemRecord
        } catch {
            throw new HostBridgeError("unavailable", "failed to read Taric work item mapping")
        }
    }

    async closeWorkItem(challengeId: string, solverId: string): Promise<TaricWorkItemRecord | undefined> {
        const path = this.workItemPath(challengeId, solverId)
        const record = await this.getWorkItem(challengeId, solverId)
        if (!record) return
        const updated: TaricWorkItemRecord = {
            ...record,
            status: "closed",
            closed_at: nowIso(),
        }
        await atomicWriteJson(path, updated)
        return updated
    }

    /**
     * A WorkItem must exist in Taric authority before a WorkRun can be
     * claimed. The host authors and admits it; the model never controls it.
     */
    async ensureWorkItem(input: TaricWorkItemInput): Promise<TaricWorkItemRecord> {
        const challengeId = requireText(input.challengeId, "challengeId")
        const engagementId = requireText(input.engagementId, "engagementId")
        const solverId = requireText(input.solverId, "solverId")
        const existing = await this.getWorkItem(challengeId, solverId)
        if (existing) return existing

        const idempotencyKey = `bw-work-item:${challengeId}:${solverId}`
        const content = {
            schema_version: "1.0.0",
            engagement_id: engagementId,
            kind: "work_item",
            title: input.title?.trim() || `Solver ${solverId} work on challenge ${challengeId}`,
            status: "queued",
            acceptance_criteria: ["Produce a scoped penetration test report for the assigned asset"],
            ...(input.goal?.trim() ? { goal: input.goal.trim() } : {}),
            ...(input.scopeRef?.trim() ? { scope_ref: input.scopeRef.trim() } : {}),
            provenance: { host_id: this.hostId, producer_id: this.hostId, source_kind: "host" },
        }
        const submitted = await this.dispatcher({
            operation: "proposal.submit",
            principalRole: "operator",
            principalId: this.hostId,
            request: {
                engagement_id: engagementId,
                subject_type: "work_item",
                expected_version: 0,
                idempotency_key: idempotencyKey,
                content,
            },
        })
        assertDispatcherResponse(submitted)
        const submittedData = submitted.data as { id?: unknown; proposal_id?: unknown } | undefined
        const proposalId = typeof submittedData?.id === "string" ? submittedData.id : typeof submittedData?.proposal_id === "string" ? submittedData.proposal_id : ""
        if (!proposalId) throw new HostBridgeError("unavailable", "Taric work item submission returned no proposal id")

        const admitted = await this.dispatcher({
            operation: "admission.evaluate",
            principalRole: "operator",
            principalId: this.hostId,
            request: {
                engagement_id: engagementId,
                proposal_id: proposalId,
                expected_version: 0,
                policy_digest: this.policyDigest,
                idempotency_key: `bw-work-item-admit:${proposalId}`,
            },
        })
        assertDispatcherResponse(admitted)
        const admittedData = admitted.data as {
            ok?: unknown
            record?: { id?: unknown }
            proposal?: { canonical_id?: unknown }
        } | undefined
        if (admittedData?.ok === false) throw new HostBridgeError("unavailable", "Taric rejected the host work item")
        const workItemId =
            typeof admittedData?.record?.id === "string"
                ? admittedData.record.id
                : typeof admittedData?.proposal?.canonical_id === "string"
                  ? admittedData.proposal.canonical_id
                  : ""
        if (!workItemId) throw new HostBridgeError("unavailable", "Taric work item admission returned no canonical id")

        const record: TaricWorkItemRecord = {
            work_item_id: workItemId,
            proposal_id: proposalId,
            challenge_id: challengeId,
            engagement_id: engagementId,
            solver_id: solverId,
            ...(input.assetHash?.trim() ? { asset_hash: input.assetHash.trim() } : {}),
            ...(input.scopeRef?.trim() ? { scope_ref: input.scopeRef.trim() } : {}),
            created_at: nowIso(),
        }
        await atomicWriteJson(this.workItemPath(challengeId, solverId), record)
        return record
    }

    async get(workRunId: string): Promise<TaricWorkRecord | undefined> {
        const path = this.recordPath(workRunId)
        if (!(await Bun.file(path).exists())) return
        try {
            return await Bun.file(path).json() as TaricWorkRecord
        } catch {
            throw new HostBridgeError("unavailable", "failed to read Taric work record")
        }
    }

    async list(): Promise<TaricWorkRecord[]> {
        let files: string[] = []
        try {
            files = await readdir(this.rootDir)
        } catch {
            return []
        }
        const records: TaricWorkRecord[] = []
        for (const file of files.filter((item) => item.endsWith(".json"))) {
            try {
                const record = await Bun.file(join(this.rootDir, file)).json() as TaricWorkRecord
                records.push(record)
            } catch {
                // Ignore malformed records until operator-driven repair.
            }
        }
        return records.sort((a, b) => a.created_at.localeCompare(b.created_at))
    }

    /**
     * Return admitted checkpoint proposals whose WorkRun never reached
     * `checkpointed`. Approved outbox entries are authoritative when supplied;
     * the persisted admission marker covers crash recovery inside the host.
     */
    async listUncommittedAdmitted(entries?: TaricProposalOutboxEntry[]): Promise<TaricWorkRecord[]> {
        const approvedWorkRuns = entries
            ? new Set(
                  entries
                      .filter(
                          (entry) =>
                              entry.admission_state === "approved" &&
                              entry.proposal.kind === "checkpoint" &&
                              typeof entry.proposal.content.work_run_ref === "string",
                      )
                      .map((entry) => entry.proposal.content.work_run_ref as string),
              )
            : undefined
        return (await this.list()).filter(
            (record) =>
                record.status !== "checkpointed" &&
                (approvedWorkRuns
                    ? approvedWorkRuns.has(record.work_run_id)
                    : Boolean(record.checkpoint_admitted_at && record.checkpoint_payload)),
        )
    }

    async stageAdmittedCheckpoint(
        workRunId: string,
        payload: TaricCheckpointPayload,
        expectedGeneration?: number,
    ): Promise<TaricWorkRecord> {
        const record = await this.get(workRunId)
        if (!record) throw new HostBridgeError("validation_error", "work run not found")
        this.assertGeneration(record, expectedGeneration)
        if (record.status === "checkpointed" && record.checkpoint_id) return record
        const updated: TaricWorkRecord = {
            ...record,
            checkpoint_admitted_at: record.checkpoint_admitted_at ?? nowIso(),
            checkpoint_payload: cloneCheckpointPayload(payload),
            updated_at: nowIso(),
        }
        await this.update(updated)
        return updated
    }

    async applyCheckpointEvidence(input: {
        workRunId: string
        observationRefs?: string[]
        evidenceRefs?: string[]
        gap?: string
    }): Promise<TaricWorkRecord> {
        const record = await this.get(input.workRunId)
        if (!record) throw new HostBridgeError("validation_error", "work run not found")
        const timestamp = nowIso()
        const payload = record.checkpoint_payload
            ? cloneCheckpointPayload(record.checkpoint_payload)
            : undefined
        if (payload) {
            if (input.gap) {
                delete payload.observation_refs
                delete payload.evidence_refs
            } else {
                payload.observation_refs = requireUuidList(input.observationRefs, "observation_refs")
                payload.evidence_refs = requireUuidList(input.evidenceRefs, "evidence_refs")
            }
        }
        const updated: TaricWorkRecord = {
            ...record,
            ...(payload ? { checkpoint_payload: payload } : {}),
            ...(input.gap
                ? {
                      evidence_gap: requireText(input.gap, "evidence gap"),
                      evidence_gap_at: timestamp,
                      evidence_bound_at: undefined,
                  }
                : {
                      evidence_gap: undefined,
                      evidence_gap_at: undefined,
                      evidence_bound_at: timestamp,
                  }),
            updated_at: timestamp,
        }
        await this.update(updated)
        return updated
    }

    async recordCheckpointCommitError(workRunId: string, reason: string): Promise<TaricWorkRecord> {
        const record = await this.get(workRunId)
        if (!record) throw new HostBridgeError("validation_error", "work run not found")
        const updated: TaricWorkRecord = {
            ...record,
            checkpoint_repair_error: requireText(reason, "reason"),
            updated_at: nowIso(),
        }
        await this.update(updated)
        return updated
    }

    /**
     * Retry admitted checkpoint commits in a bounded batch. Each WorkRun is
     * idempotent, already-closed runs are skipped, and the latest failure is
     * retained for operator-visible status.
     */
    async repairAdmittedCheckpoints(limit = 5): Promise<{
        repaired: number
        awaitingRepair: number
        failed: number
        lastError?: string
    }> {
        if (this.repairPromise) return this.repairPromise
        const batchLimit = Math.max(1, Math.min(20, Math.floor(limit)))
        this.repairPromise = (async () => {
            const result: { repaired: number; awaitingRepair: number; failed: number; lastError?: string } = {
                repaired: 0,
                awaitingRepair: 0,
                failed: 0,
            }
            const candidates = (await this.listUncommittedAdmitted()).slice(0, batchLimit)
            for (const record of candidates) {
                if (record.status === "checkpointed" || !record.checkpoint_payload) continue
                try {
                    const closed = await this.closeWithAdmittedCheckpoint(
                        record.work_run_id,
                        record.checkpoint_payload,
                        record.generation,
                    )
                    await this.update({
                        ...closed,
                        checkpoint_repair_error: undefined,
                        checkpoint_repaired_at: nowIso(),
                        updated_at: nowIso(),
                    })
                    result.repaired += 1
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error)
                    result.failed += 1
                    result.lastError = message
                    await this.recordCheckpointCommitError(record.work_run_id, message)
                }
            }
            result.awaitingRepair = Math.max(0, (await this.listUncommittedAdmitted()).length)
            return result
        })()
        try {
            return await this.repairPromise
        } finally {
            this.repairPromise = undefined
        }
    }

    async findActiveBySolver(challengeId: string, solverId: string): Promise<TaricWorkRecord | undefined> {
        const records = await this.list()
        return records.find(
            (record) =>
                record.challenge_id === challengeId &&
                record.solver_id === solverId &&
                record.status === "active" &&
                (!record.lease_expires_at || Date.parse(record.lease_expires_at) > Date.now()),
        )
    }

    /**
     * Find the newest run whose lease already lapsed and can therefore be
     * reclaimed. Runs owned by a live solver are still leased and are skipped,
     * so a crashed or replaced solver is the only thing recovered here.
     */
    async findRecoverable(challengeId: string, engagementId: string): Promise<TaricWorkRecord | undefined> {
        const records = await this.list()
        const now = Date.now()
        return records
            .filter(
                (record) =>
                    record.challenge_id === challengeId &&
                    record.engagement_id === engagementId &&
                    (record.status === "active" || record.status === "checkpointed") &&
                    Boolean(record.checkpoint_id) &&
                    Boolean(record.lease_expires_at) &&
                    Date.parse(record.lease_expires_at as string) <= now,
            )
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
    }

    /**
     * A run whose owner solver is gone but whose lease has not expired yet.
     * The host must not claim a fresh run for the same challenge in this
     * window, otherwise the old checkpoint can never be reclaimed.
     *
     * This intentionally does not require a committed checkpoint: a solver can
     * crash while its checkpoint proposal is still pending admission, and the
     * host must still hold the run instead of letting the planner claim a
     * duplicate WorkRun.
     */
    async findPendingRecovery(challengeId: string, engagementId: string): Promise<TaricWorkRecord | undefined> {
        const now = Date.now()
        const records = await this.list()
        return records
            .filter(
                (record) =>
                    record.challenge_id === challengeId &&
                    record.engagement_id === engagementId &&
                    (record.status === "active" || record.status === "checkpointed") &&
                    Boolean(record.lease_expires_at) &&
                    Date.parse(record.lease_expires_at as string) > now,
            )
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
    }

    async claim(input: {
        challengeId: string
        engagementId: string
        workItemId: string
        solverId: string
        agentId?: string
        hostId?: string
        role: SolverRole
        workRunId?: string
        assetHash?: string
    }): Promise<TaricWorkRecord> {
        const challengeId = requireText(input.challengeId, "challengeId")
        const engagementId = requireText(input.engagementId, "engagementId")
        const workItemId = requireText(input.workItemId, "workItemId")
        const solverId = requireText(input.solverId, "solverId")
        const agentId = input.agentId?.trim() || taricModelPrincipalId(input.role, solverId)
        const hostId = input.hostId?.trim() || "breachweave-host"
        const role = input.role
        const workRunId = input.workRunId?.trim() || crypto.randomUUID()
        sanitizeFileName(workRunId)
        const activeClaim = this.claimPromises.get(workRunId)
        if (activeClaim) return activeClaim

        const claimPromise = this.performClaim({ challengeId, engagementId, workItemId, solverId, agentId, hostId, role, workRunId, assetHash: input.assetHash })
        this.claimPromises.set(workRunId, claimPromise)
        try {
            return await claimPromise
        } finally {
            this.claimPromises.delete(workRunId)
        }
    }

    private async performClaim(input: {
        challengeId: string
        engagementId: string
        workItemId: string
        solverId: string
        agentId: string
        hostId: string
        role: SolverRole
        workRunId: string
        assetHash?: string
    }): Promise<TaricWorkRecord> {
        const { challengeId, engagementId, workItemId, solverId, agentId, hostId, role, workRunId } = input

        const existing = await this.get(workRunId)
        if (existing) {
            if (existing.solver_id !== solverId || existing.challenge_id !== challengeId || existing.engagement_id !== engagementId || existing.work_item_id !== workItemId) {
                throw new HostBridgeError("authorization_error", "work run is bound to a different solver or engagement")
            }
            return existing
        }

        const record: TaricWorkRecord = {
            work_run_id: workRunId,
            attempt_id: crypto.randomUUID(),
            agent_id: agentId,
            generation: 1,
            challenge_id: challengeId,
            engagement_id: engagementId,
            work_item_id: workItemId,
            ...(input.assetHash?.trim() ? { asset_hash: input.assetHash.trim() } : {}),
            host_id: hostId,
            solver_id: solverId,
            role,
            status: "active",
            read_seq: 0,
            lease_expires_at: new Date(Date.now() + this.leaseMs).toISOString(),
            created_at: nowIso(),
            updated_at: nowIso(),
        }
        const response = await this.dispatcher({
            operation: "work.claim",
            request: {
                engagement_id: engagementId,
                work_item_id: workItemId,
                host_id: hostId,
                agent_id: agentId,
                ttl_ms: this.leaseMs,
            },
        })
        assertDispatcherResponse(response)
        const data = response.data as Record<string, unknown> | undefined
        if (typeof data?.run_id === "string" && data.run_id.trim()) record.work_run_id = data.run_id.trim()
        if (typeof data?.attempt_ref === "string" && data.attempt_ref.trim()) record.attempt_id = data.attempt_ref.trim()
        if (typeof data?.generation === "number" && Number.isInteger(data.generation)) record.generation = data.generation
        if (typeof data?.read_seq === "number") record.read_seq = data.read_seq
        if (typeof data?.work_item_version === "number") record.work_item_version = data.work_item_version
        if (typeof data?.target_version === "number") record.target_version = data.target_version
        if (typeof data?.scope_ref === "string") record.scope_ref = data.scope_ref
        if (typeof data?.scope_version === "number") record.scope_version = data.scope_version
        if (typeof data?.lease_expires_at === "string") record.lease_expires_at = data.lease_expires_at
        await atomicWriteJson(this.recordPath(record.work_run_id), record)
        return record
    }

    async renew(workRunId: string, expectedGeneration?: number): Promise<TaricWorkRecord> {
        const record = await this.requireActive(workRunId)
        this.assertGeneration(record, expectedGeneration)
        const response = await this.dispatcher({
            operation: "work.renew",
            request: {
                engagement_id: record.engagement_id,
                work_run_id: record.work_run_id,
                host_id: record.host_id,
                generation: record.generation,
                ttl_ms: this.leaseMs,
            },
        })
        assertDispatcherResponse(response)
        const data = response.data as Record<string, unknown> | undefined
        const updated: TaricWorkRecord = {
            ...record,
            lease_expires_at: typeof data?.lease_expires_at === "string" ? data.lease_expires_at : new Date(Date.now() + this.leaseMs).toISOString(),
            updated_at: nowIso(),
        }
        await atomicWriteJson(this.recordPath(workRunId), updated)
        return updated
    }

    /**
     * Host-side lease heartbeat.
     *
     * Taric refuses to renew an already-expired lease, so the host must renew
     * before expiry. Without this a HITL review that outlives the lease makes
     * every queued checkpoint unrecoverably stale.
     */
    async heartbeat(options: {
        renewBeforeMs?: number
        shouldRenew?: (record: TaricWorkRecord) => boolean
    } = {}): Promise<{ renewed: number; skipped: number; failed: number }> {
        const renewBeforeMs = options.renewBeforeMs ?? Math.floor(this.leaseMs / 2)
        const result = { renewed: 0, skipped: 0, failed: 0 }
        for (const record of await this.list()) {
            if (record.status !== "active" || !record.lease_expires_at) {
                result.skipped += 1
                continue
            }
            if (options.shouldRenew && !options.shouldRenew(record)) {
                result.skipped += 1
                continue
            }
            if (Date.parse(record.lease_expires_at) - Date.now() > renewBeforeMs) {
                result.skipped += 1
                continue
            }
            try {
                await this.renew(record.work_run_id, record.generation)
                result.renewed += 1
            } catch (error) {
                result.failed += 1
                await this.update({
                    ...record,
                    last_error: error instanceof Error ? error.message : String(error),
                    updated_at: nowIso(),
                })
            }
        }
        return result
    }

    /**
     * Reclaim an expired run for a replacement solver. Taric re-signs the
     * WorkRun with the new `agent_id`; keeping the old owner would make every
     * checkpoint from the resumed attempt fail the owner-agent fence.
     */
    async reclaim(
        workRunId: string,
        expectedGeneration?: number,
        takeover?: { solverId?: string; role?: SolverRole; agentId?: string },
    ): Promise<TaricWorkRecord> {
        const current = await this.get(workRunId)
        if (!current) throw new HostBridgeError("validation_error", "work run not found")
        this.assertGeneration(current, expectedGeneration)
        const solverId = takeover?.solverId?.trim() || current.solver_id
        const role = takeover?.role ?? current.role
        const agentId = takeover?.agentId?.trim() || (takeover?.solverId ? taricModelPrincipalId(role, solverId) : current.agent_id)
        const response = await this.dispatcher({
            operation: "work.reclaim",
            request: {
                engagement_id: current.engagement_id,
                work_run_id: current.work_run_id,
                host_id: current.host_id,
                agent_id: agentId,
                ttl_ms: this.leaseMs,
            },
        })
        assertDispatcherResponse(response)
        const data = response.data as Record<string, unknown> | undefined

        await this.update({
            ...current,
            status: "stale",
            updated_at: nowIso(),
        })

        const next: TaricWorkRecord = {
            ...current,
            attempt_id: typeof data?.attempt_ref === "string" ? data.attempt_ref : crypto.randomUUID(),
            generation: typeof data?.generation === "number" ? data.generation : current.generation + 1,
            status: "active",
            solver_id: solverId,
            role,
            agent_id: agentId,
            read_seq: typeof data?.read_seq === "number" ? data.read_seq : current.read_seq,
            lease_expires_at: typeof data?.lease_expires_at === "string" ? data.lease_expires_at : new Date(Date.now() + this.leaseMs).toISOString(),
            last_error: undefined,
            updated_at: nowIso(),
        }
        await this.update(next)
        return next
    }

    async resume(workRunId: string, expectedGeneration?: number): Promise<TaricWorkRecord> {
        return (await this.resumeWithPacket(workRunId, expectedGeneration)).record
    }

    /**
     * Resume a reclaimed run and return the checkpoint plus Taric's premise
     * checks. A resumed attempt always changes Attempt/generation, so Taric
     * reports `replan_required` for the prior checkpoint; the host keeps the
     * run active so the solver can still checkpoint its new plan.
     */
    async resumeWithPacket(workRunId: string, expectedGeneration?: number): Promise<TaricResumePacket> {
        const record = await this.requireActive(workRunId)
        this.assertGeneration(record, expectedGeneration)
        const response = await this.dispatcher({
            operation: "work.resume",
            request: {
                engagement_id: record.engagement_id,
                work_run_id: record.work_run_id,
                host_id: record.host_id,
            },
        })
        assertDispatcherResponse(response)
        const data = response.data as {
            replan_required?: unknown
            blocked?: unknown
            resume_advice?: unknown
            checkpoint?: Record<string, unknown> | null
            premise_checks?: Record<string, unknown>
        } | undefined
        const replanRequired = data?.replan_required === true || data?.blocked === true || data?.resume_advice === "replan_required"
        const checkpoint = data?.checkpoint && typeof data.checkpoint === "object" ? data.checkpoint : undefined
        const updated: TaricWorkRecord = {
            ...record,
            ...(typeof checkpoint?.checkpoint_id === "string" ? { checkpoint_id: checkpoint.checkpoint_id } : {}),
            ...(replanRequired ? { last_error: "resume premises changed; replan required" } : {}),
            updated_at: nowIso(),
        }
        await this.update(updated)
        return {
            record: updated,
            ...(checkpoint ? { checkpoint } : {}),
            replanRequired,
            ...(typeof data?.resume_advice === "string" ? { resumeAdvice: data.resume_advice } : {}),
            ...(data?.premise_checks ? { premiseChecks: data.premise_checks } : {}),
        }
    }

    /**
     * Build the authoritative checkpoint contract for a model proposal.
     * Taric binds checkpoints to the active WorkRun/Attempt, so these fields
     * must come from the host record rather than model input.
     */
    async checkpointAuthority(workRunId: string, expectedGeneration?: number): Promise<TaricCheckpointAuthority> {
        let record = await this.requireActive(workRunId)
        this.assertGeneration(record, expectedGeneration)
        if (!record.lease_expires_at) throw new HostBridgeError("stale_version", "work run has no lease expiry")
        if (Date.parse(record.lease_expires_at) - Date.now() < 60_000) {
            record = await this.renew(workRunId, record.generation)
        }
        const leaseExpiresAt = record.lease_expires_at
        if (!leaseExpiresAt) throw new HostBridgeError("stale_version", "work run has no lease expiry")
        return {
            work_item_ref: record.work_item_id,
            work_run_ref: record.work_run_id,
            attempt_ref: record.attempt_id,
            generation: record.generation,
            target_version: record.target_version ?? record.work_item_version ?? 1,
            work_item_version: record.work_item_version ?? 1,
            scope_version: record.scope_version ?? 0,
            owner: { host_id: record.host_id, agent_id: record.agent_id },
            lease_expires_at: leaseExpiresAt,
            source_read_seq: record.read_seq,
            ...(record.scope_ref ? { scope_ref: record.scope_ref } : {}),
        }
    }

    async commitCheckpoint(workRunId: string, payload: TaricCheckpointPayload, expectedGeneration?: number): Promise<TaricWorkRecord> {
        const record = await this.requireActive(workRunId)
        this.assertGeneration(record, expectedGeneration)
        const authority = await this.checkpointAuthority(workRunId, expectedGeneration)
        return this.commitAuthoritativeCheckpoint(authority, record, payload)
    }

    /**
     * Commit a checkpoint for a run that was already admitted as an L1
     * proposal. The model cannot call checkpoint.commit, so the host closes the
     * WorkRun loop here: this is what writes `checkpoint_id` and moves the run
     * from `active` to `checkpointed`.
     */
    async closeWithAdmittedCheckpoint(
        workRunId: string,
        payload: TaricCheckpointPayload,
        expectedGeneration?: number,
    ): Promise<TaricWorkRecord> {
        const record = await this.get(workRunId)
        if (!record) throw new HostBridgeError("validation_error", "work run not found")
        this.assertGeneration(record, expectedGeneration)
        if (record.status === "checkpointed" && record.checkpoint_id) return record
        if (record.status !== "active") throw new HostBridgeError("stale_version", `work run is ${record.status}`)
        const authority = await this.checkpointAuthority(workRunId, expectedGeneration)
        return this.commitAuthoritativeCheckpoint(authority, record, payload)
    }

    private async commitAuthoritativeCheckpoint(
        authority: TaricCheckpointAuthority,
        record: TaricWorkRecord,
        payload: TaricCheckpointPayload,
    ): Promise<TaricWorkRecord> {
        const sourceReadSeq = payload.source_read_seq ?? authority.source_read_seq
        const workItemVersion = payload.work_item_version ?? authority.work_item_version
        const targetVersion = payload.target_version ?? authority.target_version
        const scopeVersion = payload.scope_version ?? authority.scope_version
        const observationRefs = requireUuidList(payload.observation_refs, "observation_refs")
        const evidenceRefs = requireUuidList(payload.evidence_refs, "evidence_refs")
        const checkpoint = {
            ...(authority.scope_ref ? { scope_ref: authority.scope_ref } : {}),
            work_item_ref: authority.work_item_ref,
            work_run_ref: authority.work_run_ref,
            attempt_ref: authority.attempt_ref,
            generation: authority.generation,
            target_version: requireNonNegativeInteger(targetVersion, "target_version"),
            work_item_version: requirePositiveInteger(workItemVersion, "work_item_version"),
            scope_version: requireNonNegativeInteger(scopeVersion, "scope_version"),
            owner: authority.owner,
            lease_expires_at: authority.lease_expires_at,
            source_read_seq: requireNonNegativeInteger(sourceReadSeq, "source_read_seq"),
            completed_steps: requireTextList(payload.completed_steps ?? [], "completed_steps", 0),
            next_steps: requireTextList(payload.next_steps, "next_steps", 1),
            observation_refs: observationRefs,
            evidence_refs: evidenceRefs,
            negative_results: requireTextList(payload.negative_results ?? [], "negative_results", 0),
            unresolved_work: requireTextList(payload.open_questions, "open_questions", 0),
            host_decision_refs: [],
            ...(payload.artifact_refs && payload.artifact_refs.length > 0 ? { artifact_refs: payload.artifact_refs } : {}),
            external_action_state: "none",
            budget: { actions: 0 },
            draft_refs: [],
            handoff_refs: [],
            action_refs: [],
            tool_result_refs: [],
            context_manifest: {
                context_snapshot_id: crypto.randomUUID(),
                read_seq: sourceReadSeq,
                builder_version: "breachweave-taric-work/1",
                sources: requireTextList(payload.facts_used, "facts_used", 0).map((fact) => ({ kind: "fact", summary: fact })),
            },
        }
        const response = await this.dispatcher({
            operation: "checkpoint.commit",
            request: {
                engagement_id: record.engagement_id,
                work_run_id: record.work_run_id,
                host_id: record.host_id,
                generation: record.generation,
                checkpoint,
            },
        })
        assertDispatcherResponse(response)
        const data = response.data as Record<string, unknown> | undefined
        const checkpointId = typeof data?.checkpoint_id === "string" ? data.checkpoint_id : crypto.randomUUID()
        const updated: TaricWorkRecord = {
            ...record,
            status: "checkpointed",
            checkpoint_id: checkpointId,
            read_seq: typeof data?.read_seq === "number" ? data.read_seq : record.read_seq,
            committed_observation_refs: observationRefs,
            committed_evidence_refs: evidenceRefs,
            updated_at: nowIso(),
        }
        await this.update(updated)
        return updated
    }

    async markBlocked(workRunId: string, reason: string): Promise<TaricWorkRecord> {
        return this.transition(workRunId, "blocked", requireText(reason, "reason"))
    }

    async markReplanRequired(workRunId: string, reason: string): Promise<TaricWorkRecord> {
        return this.transition(workRunId, "replan_required", requireText(reason, "reason"))
    }

    private async transition(workRunId: string, status: TaricWorkState, reason: string): Promise<TaricWorkRecord> {
        const record = await this.get(workRunId)
        if (!record) throw new HostBridgeError("validation_error", "work run not found")
        const updated: TaricWorkRecord = {
            ...record,
            status,
            last_error: reason,
            updated_at: nowIso(),
        }
        await this.update(updated)
        return updated
    }

    private async requireActive(workRunId: string): Promise<TaricWorkRecord> {
        const record = await this.get(workRunId)
        if (!record) throw new HostBridgeError("validation_error", "work run not found")
        if (record.status !== "active") throw new HostBridgeError("stale_version", `work run is ${record.status}`)
        if (record.lease_expires_at && Date.parse(record.lease_expires_at) < Date.now()) {
            throw new HostBridgeError("stale_version", "work run lease has expired")
        }
        return record
    }

    private assertGeneration(record: TaricWorkRecord, expectedGeneration?: number): void {
        if (expectedGeneration !== undefined && record.generation !== expectedGeneration) {
            throw new HostBridgeError("stale_version", `work run generation mismatch: expected ${expectedGeneration}, got ${record.generation}`)
        }
    }

    private async update(record: TaricWorkRecord): Promise<void> {
        await atomicWriteJson(this.recordPath(record.work_run_id), record)
    }
}
