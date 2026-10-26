import { HostBridgeError } from "./host-bridge-types"
import type { TaricArtifactStore } from "./taric-artifact-store"
import { redactTaricArtifactText } from "./taric-artifact-store"
import type { TaricEngagementService } from "./taric-engagement-service"
import type { TaricCheckpointPayload, TaricWorkManager, TaricWorkRecord } from "./taric-work-manager"
import type { TaricEvidenceArtifact, TaricEvidenceRecorder, TaricEvidenceTarget } from "./taric-evidence-recorder"
import type { SolverRole } from "../runtime/types"

export type TaricLifecycleGapKind = "missing_work_item" | "missing_checkpoint" | "missing_evidence"

export interface TaricLifecycleGap {
    kind: TaricLifecycleGapKind
    challengeId: string
    workRunId?: string
    workItemId?: string
    solverId?: string
    reason: string
    recordedAt: string
}

export interface TaricContextPack {
    role: SolverRole
    challengeId: string
    solverId: string
    activeWorkItems: Array<{
        workItemId: string
        workRunId: string
        assetHash?: string
        status: string
        checkpointId?: string
        evidenceGap?: string
    }>
    admittedCheckpoints: Array<Record<string, unknown>>
    coverageGaps: TaricLifecycleGap[]
    constraints: string[]
    generatedAt: string
}

export interface TaricMemoryProjection {
    id: string
    kind: "fact" | "evidence" | "failure" | "note"
    content: string
    refs: string[]
    source: string
    updated_at: string
}

export interface TaricIdeaProjection {
    id: string
    content: string
    status: "pending" | "testing" | "verified" | "failed" | "skipped"
    result: string
    updated_at: string
}

export interface TaricProjection {
    memory: TaricMemoryProjection[]
    ideas: TaricIdeaProjection[]
}

export interface TaricReportGateInput {
    challengeId: string
    solverId: string
    assetHash: string
    workRunId?: string
}

export interface TaricReportGateResult {
    ok: boolean
    skipped?: boolean
    workRunId?: string
    checkpointId?: string
    failure?: TaricLifecycleGap
}

export interface TaricHostCheckpointInput {
    challengeId: string
    solverId: string
    assetHash: string
    asset: string
    assetType?: TaricEvidenceTarget["assetType"]
    completedSteps?: string[]
    factsUsed?: string[]
}

export interface TaricHostCheckpointResult {
    ok: boolean
    skipped?: boolean
    workRunId?: string
    checkpointId?: string
    evidenceGap?: string
}

export interface TaricToolResultCaptureInput {
    challengeId?: string
    engagementId: string
    workRunId?: string
    attemptId?: string
    role?: SolverRole
    toolName: string
    text: string
}

export interface TaricToolResultCaptureResult {
    captured: boolean
    skipped?: boolean
    artifactId?: string
    contentRef?: string
    hash?: string
    summary?: string
    truncated?: boolean
}

export interface TaricAuthoritativeStatus {
    enabled: boolean
    captureCounters: {
        captured: number
        skipped: number
        failed: number
    }
    reportGateFailures: TaricLifecycleGap[]
    lifecycleGaps: TaricLifecycleGap[]
    recovery: {
        recoverable: number
        awaitingRepair: number
        recovered: number
        staleWriteRejections: number
    }
    activeWorkItems: number
    checkpointedWorkItems: number
}

export interface TaricAuthoritativeStateOptions {
    work?: TaricWorkManager
    artifacts?: TaricArtifactStore
    engagement?: TaricEngagementService
    evidenceRecorder?: TaricEvidenceRecorder
    maxInlineBytes?: number
}

function nowIso(): string {
    return new Date().toISOString()
}

function requireText(value: string | undefined, field: string): string {
    const text = value?.trim()
    if (!text) throw new HostBridgeError("validation_error", `${field} is required`)
    return text
}

function uniqueText(values: Array<string | undefined>): string[] {
    return [...new Set(values.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))]
}

function checkpointSummary(record: TaricWorkRecord): Record<string, unknown> {
    const payload = record.checkpoint_payload
    return {
        workRunId: record.work_run_id,
        workItemId: record.work_item_id,
        ...(record.asset_hash ? { assetHash: record.asset_hash } : {}),
        checkpointId: record.checkpoint_id,
        status: record.status,
        completedSteps: payload?.completed_steps ?? [],
        nextSteps: payload?.next_steps ?? [],
        factsUsed: payload?.facts_used ?? [],
        openQuestions: payload?.open_questions ?? [],
        evidenceRefCount: record.committed_evidence_refs?.length ?? 0,
        observationRefCount: record.committed_observation_refs?.length ?? 0,
        evidenceGap: record.evidence_gap,
        updatedAt: record.updated_at,
    }
}

export class TaricAuthoritativeState {
    private readonly work?: TaricWorkManager
    private readonly artifacts?: TaricArtifactStore
    private readonly engagement?: TaricEngagementService
    private readonly evidenceRecorder?: TaricEvidenceRecorder
    private readonly maxInlineBytes: number
    private readonly captureCounters = { captured: 0, skipped: 0, failed: 0 }
    private readonly reportGateFailures: TaricLifecycleGap[] = []
    private readonly lifecycleGaps: TaricLifecycleGap[] = []
    private readonly recoveryEvents: TaricAuthoritativeStatus["recovery"] = {
        recoverable: 0,
        awaitingRepair: 0,
        recovered: 0,
        staleWriteRejections: 0,
    }

    constructor(options: TaricAuthoritativeStateOptions = {}) {
        this.work = options.work
        this.artifacts = options.artifacts
        this.engagement = options.engagement
        this.evidenceRecorder = options.evidenceRecorder
        this.maxInlineBytes = options.maxInlineBytes ?? 32_000
    }

    get enabled(): boolean {
        return Boolean(this.work)
    }

    async isChallengeBound(challengeId: string): Promise<boolean> {
        if (!this.work || !this.engagement) return false
        const binding = await this.engagement.bindingRegistry.getActiveBinding(challengeId).catch(() => undefined)
        return Boolean(binding?.engagement_id)
    }

    recordLifecycleGap(gap: TaricLifecycleGap): void {
        this.lifecycleGaps.push(gap)
        if (this.lifecycleGaps.length > 100) this.lifecycleGaps.shift()
    }

    async contextPack(challengeId: string, solverId: string, role: SolverRole): Promise<TaricContextPack> {
        const records = (await this.work?.list()) ?? []
        const ownRecords = records
            .filter((record) => record.challenge_id === challengeId && record.solver_id === solverId)
            .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
        const activeWorkItems = ownRecords
            .filter((record) => record.status === "active" || record.status === "checkpointed")
            .map((record) => ({
                workItemId: record.work_item_id,
                workRunId: record.work_run_id,
                ...(record.asset_hash ? { assetHash: record.asset_hash } : {}),
                status: record.status,
                ...(record.checkpoint_id ? { checkpointId: record.checkpoint_id } : {}),
                ...(record.evidence_gap ? { evidenceGap: record.evidence_gap } : {}),
            }))
        const admittedCheckpoints = ownRecords
            .filter((record) => record.checkpoint_payload || record.checkpoint_id)
            .map(checkpointSummary)
        const coverageGaps: TaricLifecycleGap[] = ownRecords
            .filter((record) => record.status !== "checkpointed" && !record.checkpoint_id)
            .map((record) => ({
                kind: "missing_checkpoint",
                challengeId,
                workRunId: record.work_run_id,
                workItemId: record.work_item_id,
                solverId: record.solver_id,
                reason: "active Taric WorkItem has no admitted checkpoint",
                recordedAt: nowIso(),
            }))

        const constraints: Record<SolverRole, string[]> = {
            executor: [
                "Execution state is authoritative only when it is carried by a host-owned Taric WorkItem and checkpoint.",
                "Read admitted checkpoints before acting and submit a checkpoint before finishing.",
                "Do not trust model-supplied evidence refs; host-derived evidence binds the report gate.",
            ],
            planner: [
                "Planner decisions must be based on admitted Taric state, not raw L0 proposals.",
                "Do not fabricate asset coverage; pending assets remain unsolved until a checkpointed work run reports them.",
            ],
            observer: [
                "Memory and idea writes are read-only projections when Taric authority is active.",
                "Curate only from admitted checkpoint facts and host-captured observations.",
            ],
            reviewer: [
                "Only admitted Taric records are reviewable. L0 proposals stay isolated from report and UI.",
            ],
        }

        return {
            role,
            challengeId,
            solverId,
            activeWorkItems,
            admittedCheckpoints,
            coverageGaps,
            constraints: constraints[role],
            generatedAt: nowIso(),
        }
    }

    formatContextPack(pack: TaricContextPack): string {
        const lines = [
            "Taric authoritative blackboard context (host-injected):",
            `role: ${pack.role}`,
            `challenge: ${pack.challengeId}`,
            "",
            "Admitted checkpoints:",
            ...(pack.admittedCheckpoints.length > 0
                ? pack.admittedCheckpoints.map((item) => `- ${JSON.stringify(item)}`)
                : ["- none"]),
            "",
            "Active WorkItems:",
            ...(pack.activeWorkItems.length > 0
                ? pack.activeWorkItems.map((item) => `- ${JSON.stringify(item)}`)
                : ["- none"]),
            "",
            "Coverage gaps:",
            ...(pack.coverageGaps.length > 0
                ? pack.coverageGaps.map((item) => `- ${item.kind}: ${item.reason}`)
                : ["- none"]),
            "",
            "Role constraints:",
            ...pack.constraints.map((item) => `- ${item}`),
        ]
        return lines.join("\n")
    }

    async assertReportGate(input: TaricReportGateInput): Promise<TaricReportGateResult> {
        const challengeId = requireText(input.challengeId, "challengeId")
        const solverId = requireText(input.solverId, "solverId")
        const assetHash = requireText(input.assetHash, "assetHash")
        if (!this.work || !this.engagement) return { ok: true, skipped: true }
        const binding = await this.engagement.bindingRegistry.getActiveBinding(challengeId).catch(() => undefined)
        if (!binding?.engagement_id) return { ok: true, skipped: true }

        const records = await this.work.list()
        const candidate = records
            .filter((record) => record.challenge_id === challengeId && record.solver_id === solverId)
            .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))[0]
        const workRunId = input.workRunId?.trim() || candidate?.work_run_id
        const record = workRunId ? records.find((item) => item.work_run_id === workRunId) : candidate
        if (!record) {
            return this.failReportGate(challengeId, solverId, undefined, undefined, "missing_checkpoint", "no Taric WorkItem exists for this solver")
        }
        if (record.asset_hash && record.asset_hash !== assetHash) {
            return this.failReportGate(challengeId, solverId, record.work_run_id, record.work_item_id, "missing_checkpoint", "current Taric WorkItem belongs to a different asset")
        }
        if (record.status !== "checkpointed" || !record.checkpoint_id) {
            return this.failReportGate(challengeId, solverId, record.work_run_id, record.work_item_id, "missing_checkpoint", "no current admitted checkpoint for the submitted asset")
        }
        const evidenceCount = record.committed_evidence_refs?.length ?? 0
        if (evidenceCount === 0 && !record.evidence_gap) {
            return this.failReportGate(challengeId, solverId, record.work_run_id, record.work_item_id, "missing_evidence", "checkpoint has neither admitted evidence refs nor an explicit evidence gap")
        }
        return {
            ok: true,
            workRunId: record.work_run_id,
            checkpointId: record.checkpoint_id,
        }
    }

    async ensureHostCheckpoint(input: TaricHostCheckpointInput): Promise<TaricHostCheckpointResult> {
        const challengeId = requireText(input.challengeId, "challengeId")
        const solverId = requireText(input.solverId, "solverId")
        const assetHash = requireText(input.assetHash, "assetHash")
        if (!this.work || !this.engagement || !this.artifacts) return { ok: true, skipped: true }
        const binding = await this.engagement.bindingRegistry.getActiveBinding(challengeId).catch(() => undefined)
        if (!binding?.engagement_id) return { ok: true, skipped: true }

        const records = await this.work.list()
        const record = records
            .filter((item) => item.challenge_id === challengeId && item.solver_id === solverId)
            .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))[0]
        if (!record) return { ok: false }
        if (record.status === "checkpointed" && record.checkpoint_id) {
            return { ok: true, workRunId: record.work_run_id, checkpointId: record.checkpoint_id }
        }

        const artifacts = await this.collectWorkArtifacts(record.engagement_id, record.work_run_id, record.attempt_id)
        const basePayload: TaricCheckpointPayload = {
            next_steps: ["Continue from the host-generated checkpoint"],
            facts_used: input.factsUsed?.filter(Boolean) ?? ["Host checkpoint generated from report submission and captured tool output"],
            open_questions: [],
            completed_steps: input.completedSteps?.filter(Boolean) ?? ["Report submission triggered host checkpoint"],
            ...(artifacts.artifactRefs.length > 0 ? { artifact_refs: artifacts.artifactRefs } : {}),
        }
        let payload: TaricCheckpointPayload = basePayload
        let evidenceGap: string | undefined

        if (this.evidenceRecorder && artifacts.evidenceArtifacts.length > 0) {
            const bindingResult = await this.evidenceRecorder.bind({
                engagementId: record.engagement_id,
                checkpointId: record.work_run_id,
                observedAt: record.updated_at ?? new Date().toISOString(),
                completedSteps: payload.completed_steps ?? [],
                artifacts: artifacts.evidenceArtifacts,
                target: {
                    assetHash,
                    asset: requireText(input.asset, "asset"),
                    ...(input.assetType ? { assetType: input.assetType } : {}),
                },
            })
            if (bindingResult.status === "bound") {
                payload = {
                    ...payload,
                    observation_refs: bindingResult.observationRefs,
                    evidence_refs: bindingResult.evidenceRefs,
                }
                await this.work.applyCheckpointEvidence({
                    workRunId: record.work_run_id,
                    observationRefs: bindingResult.observationRefs,
                    evidenceRefs: bindingResult.evidenceRefs,
                })
            } else if (bindingResult.status === "gap") {
                evidenceGap = bindingResult.reason
                await this.work.applyCheckpointEvidence({
                    workRunId: record.work_run_id,
                    gap: bindingResult.reason,
                })
            }
        } else {
            evidenceGap = artifacts.artifactRefs.length > 0
                ? "host auto checkpoint stored artifacts but evidence recorder is unavailable"
                : "host auto checkpoint has no captured artifacts"
            await this.work.applyCheckpointEvidence({
                workRunId: record.work_run_id,
                gap: evidenceGap,
            })
        }

        const committed = await this.work.closeWithAdmittedCheckpoint(record.work_run_id, payload, record.generation)
        return {
            ok: true,
            workRunId: committed.work_run_id,
            checkpointId: committed.checkpoint_id,
            ...(evidenceGap ? { evidenceGap } : {}),
        }
    }

    private async collectWorkArtifacts(
        engagementId: string,
        workRunId: string,
        attemptId: string,
    ): Promise<{ artifactRefs: Array<Record<string, unknown>>; evidenceArtifacts: TaricEvidenceArtifact[] }> {
        const records = (await this.artifacts?.list()) ?? []
        const committed = records
            .filter(
                (record) =>
                    record.engagement_id === engagementId &&
                    record.status === "committed" &&
                    typeof record.hash === "string" &&
                    record.hash.length > 0 &&
                    record.work_run_id === workRunId &&
                    record.attempt_id === attemptId,
            )
            .slice(-20)
        return {
            artifactRefs: committed.map((record) => ({
                artifact_id: record.artifact_id,
                content_ref: record.content_ref,
                content_hash: record.hash,
                byte_length: record.total_bytes,
                storage_mode: "taric_stored",
                content_status: "available",
                integrity_status: "verified",
                payload_kind: "text",
            })),
            evidenceArtifacts: committed.map((record) => ({
                artifact_id: record.artifact_id,
                content_ref: record.content_ref,
                content_hash: record.hash as string,
                byte_length: record.total_bytes,
            })),
        }
    }

    private failReportGate(
        challengeId: string,
        solverId: string,
        workRunId: string | undefined,
        workItemId: string | undefined,
        kind: TaricLifecycleGapKind,
        reason: string,
    ): TaricReportGateResult {
        const failure: TaricLifecycleGap = {
            kind,
            challengeId,
            solverId,
            ...(workRunId ? { workRunId } : {}),
            ...(workItemId ? { workItemId } : {}),
            reason,
            recordedAt: nowIso(),
        }
        this.reportGateFailures.push(failure)
        if (this.reportGateFailures.length > 100) this.reportGateFailures.shift()
        return {
            ok: false,
            ...(workRunId ? { workRunId } : {}),
            failure,
        }
    }

    async captureToolResult(input: TaricToolResultCaptureInput): Promise<TaricToolResultCaptureResult> {
        if (!this.artifacts || !this.work) return { captured: false, skipped: true }
        const text = input.text?.trim() ?? ""
        if (text.length < 64) {
            this.captureCounters.skipped += 1
            return { captured: false, skipped: true }
        }

        const engagementId = requireText(input.engagementId, "engagementId")
        const safeText = redactTaricArtifactText(text)
        try {
            const artifact = await this.artifacts.begin({
                engagementId,
                ...(input.attemptId?.trim() ? { attemptId: input.attemptId.trim() } : {}),
                ...(input.workRunId?.trim() ? { workRunId: input.workRunId.trim() } : {}),
                totalBytes: new TextEncoder().encode(safeText).length,
                acl: { read: true },
            })
            await this.artifacts.append(artifact.artifact_id, safeText)
            const committed = await this.artifacts.commit(artifact.artifact_id)
            this.captureCounters.captured += 1
            return {
                captured: true,
                artifactId: committed.artifact_id,
                contentRef: committed.content_ref,
                hash: committed.hash,
                summary: committed.summary,
                truncated: safeText.length > this.maxInlineBytes,
            }
        } catch {
            this.captureCounters.failed += 1
            return { captured: false }
        }
    }

    async buildProjection(challengeId: string): Promise<TaricProjection> {
        const records = ((await this.work?.list()) ?? []).filter((record) => record.challenge_id === challengeId)
        const memory: TaricMemoryProjection[] = []
        const ideas: TaricIdeaProjection[] = []
        const memoryKeys = new Set<string>()
        const ideaKeys = new Set<string>()

        const addMemory = (kind: TaricMemoryProjection["kind"], content: string, source: string, updatedAt: string, refs: string[] = []) => {
            const text = content.trim()
            if (!text) return
            const key = `${kind}:${text}`
            if (memoryKeys.has(key)) return
            memoryKeys.add(key)
            memory.push({
                id: `taric-${kind}-${crypto.randomUUID().slice(0, 8)}`,
                kind,
                content: text,
                refs: uniqueText(refs),
                source,
                updated_at: updatedAt,
            })
        }

        const addIdea = (content: string, source: string, updatedAt: string) => {
            const text = content.trim()
            if (!text) return
            const key = text.toLowerCase()
            if (ideaKeys.has(key)) return
            ideaKeys.add(key)
            ideas.push({
                id: `taric-idea-${crypto.randomUUID().slice(0, 8)}`,
                content: text,
                status: "pending",
                result: "",
                updated_at: updatedAt,
            })
        }

        for (const record of records) {
            const payload = record.checkpoint_payload as TaricCheckpointPayload | undefined
            for (const fact of payload?.facts_used ?? []) {
                addMemory("fact", fact, record.solver_id, record.updated_at)
            }
            for (const step of payload?.completed_steps ?? []) {
                addMemory("note", step, record.solver_id, record.updated_at)
            }
            for (const failure of payload?.negative_results ?? []) {
                addMemory("failure", failure, record.solver_id, record.updated_at)
            }
            for (const ref of record.committed_evidence_refs ?? []) {
                addMemory("evidence", ref, record.solver_id, record.updated_at)
            }
            for (const next of payload?.next_steps ?? []) {
                addIdea(next, record.solver_id, record.updated_at)
            }
            for (const question of payload?.open_questions ?? []) {
                addIdea(question, record.solver_id, record.updated_at)
            }
        }
        return { memory, ideas }
    }

    async status(): Promise<TaricAuthoritativeStatus> {
        const records = (await this.work?.list()) ?? []
        return {
            enabled: this.enabled,
            captureCounters: { ...this.captureCounters },
            reportGateFailures: [...this.reportGateFailures].slice(-20),
            lifecycleGaps: [...this.lifecycleGaps].slice(-20),
            recovery: { ...this.recoveryEvents },
            activeWorkItems: records.filter((record) => record.status === "active").length,
            checkpointedWorkItems: records.filter((record) => record.status === "checkpointed").length,
        }
    }

    async refreshStatusFromWork(): Promise<void> {
        const records = (await this.work?.list()) ?? []
        this.recoveryEvents.recoverable = records.filter((record) => record.status === "stale").length
        this.recoveryEvents.awaitingRepair = records.filter(
            (record) => record.status === "active" && Boolean(record.checkpoint_admitted_at),
        ).length
        this.recoveryEvents.recovered = records.filter((record) => record.status === "checkpointed" && record.generation > 1).length
    }
}
