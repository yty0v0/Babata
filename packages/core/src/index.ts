export { ConfigManager } from "./config/index"
export { RuntimeManager } from "./runtime/runtime"
export { runSolverCli, runSubagentCli, runSolverRpc } from "./solver/cli"
export type { SolverEventListener } from "./solver/cli"

import { ConfigManager } from "./config/index"
import { ChallengeManager } from "./challenge/manager"
import { createChallengeHostBridgeHandler } from "./challenge/host-bridge-handler"
import { createTaricReadBoardHandler } from "./challenge/taric-read-board"
import { createDockerTaricReadDispatcher, TaricHttpSidecar } from "./challenge/taric-http-sidecar"
import { createTaricProposalHandler } from "./challenge/taric-proposal-handler"
import { createDockerTaricProposalDispatcher } from "./challenge/taric-docker-proposal-dispatcher"
import { applyTaricCheckpointAuthority } from "./challenge/taric-proposal-schema"
import { TaricProposalOutbox } from "./challenge/taric-proposal-outbox"
import { TaricAdmissionManager, defaultTaricAdmissionMode } from "./challenge/taric-admission-manager"
import { createDockerTaricAdmissionDispatcher } from "./challenge/taric-docker-proposal-dispatcher"
import { taricDefaultAdmissionPolicyDigest } from "./challenge/taric-admission-policy"
import { createDockerTaricWorkDispatcher } from "./challenge/taric-docker-work-dispatcher"
import { TaricWorkManager, checkpointPayloadFromAdmittedProposal, resolveTaricLeaseMs } from "./challenge/taric-work-manager"
import { createDockerTaricMaintenanceDispatcher } from "./challenge/taric-docker-maintenance-dispatcher"
import { TaricMaintenance } from "./challenge/taric-maintenance"
import { TaricArtifactStore } from "./challenge/taric-artifact-store"
import { buildTaricIntegrationStatus } from "./challenge/taric-observability"
import { createDockerTaricEvidenceDispatcher } from "./challenge/taric-evidence-dispatcher"
import { TaricEvidenceRecorder, type TaricEvidenceArtifact, type TaricEvidenceTarget } from "./challenge/taric-evidence-recorder"
import { assertTaricImageDigest, TaricEngagementService } from "./challenge/taric-engagement-service"
import { TaricBindingRegistry } from "./challenge/taric-binding-registry"
import { TaricAuthoritativeState } from "./challenge/taric-authoritative-state"
import { createTaricToolResultCaptureHandler } from "./challenge/taric-tool-result-capture"
import type { ChallengeInfoRecord } from "./challenge/store"
import { RuntimeManager } from "./runtime/runtime"

/**
 * Collect the committed Taric artifacts that belong to a solver's work run.
 *
 * The solver-side artifact extension writes one record per captured tool
 * result. Only committed records with a hash are referenced, so a checkpoint
 * never points at a partial upload.
 */
async function collectCheckpointArtifacts(
    store: TaricArtifactStore,
    entry: { engagement_id: string; solver_id: string; proposal: { content: Record<string, unknown> } },
): Promise<{ artifactRefs: Array<Record<string, unknown>>; evidenceArtifacts: TaricEvidenceArtifact[] }> {
    const records = await store.list()
    const workRunId = typeof entry.proposal.content.work_run_ref === "string" ? entry.proposal.content.work_run_ref : undefined
    const attemptId = typeof entry.proposal.content.attempt_ref === "string" ? entry.proposal.content.attempt_ref : undefined
    const committed = records
        .filter(
            (record) =>
                record.engagement_id === entry.engagement_id &&
                record.status === "committed" &&
                typeof record.hash === "string" &&
                record.hash.length > 0 &&
                record.artifact_id === record.content_ref.replace(/^taric-artifact:/, "") &&
                (workRunId ? record.work_run_id === workRunId : true) &&
                (attemptId ? record.attempt_id === attemptId : true),
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

function selectTaricEvidenceTarget(challenge: ChallengeInfoRecord | undefined): TaricEvidenceTarget | undefined {
    const asset = [...(challenge?.assets?.urls ?? []), ...(challenge?.assets?.ips ?? [])]
        .sort((a, b) => a.asset_hash.localeCompare(b.asset_hash))[0]
    if (!asset) return undefined
    return {
        assetHash: asset.asset_hash,
        asset: asset.asset,
        assetType: /^https?:\/\//i.test(asset.asset) ? "endpoint" : "host",
    }
}

export class DaemonManager {
    private static instance: Promise<DaemonManager> | undefined

    readonly config: ConfigManager
    readonly challenge: ChallengeManager
    readonly runtime: RuntimeManager
    readonly taricAdmission?: TaricAdmissionManager
    readonly taricWork?: TaricWorkManager
    readonly taricMaintenance?: TaricMaintenance
    readonly taricEngagement?: TaricEngagementService
    readonly taricArtifacts: TaricArtifactStore
    private readonly taricSidecar?: TaricHttpSidecar
    private artifactSweepTimer: ReturnType<typeof setInterval> | undefined
    private workHeartbeatTimer: ReturnType<typeof setInterval> | undefined
    private taricMaintenanceTimer: ReturnType<typeof setInterval> | undefined

    private constructor(
        config: ConfigManager,
        challenge: ChallengeManager,
        runtime: RuntimeManager,
        taricSidecar?: TaricHttpSidecar,
        taricAdmission?: TaricAdmissionManager,
        taricWork?: TaricWorkManager,
        taricArtifacts?: TaricArtifactStore,
        taricEngagement?: TaricEngagementService,
        taricMaintenance?: TaricMaintenance,
    ) {
        this.config = config
        this.challenge = challenge
        this.runtime = runtime
        this.taricSidecar = taricSidecar
        this.taricAdmission = taricAdmission
        this.taricWork = taricWork
        this.taricMaintenance = taricMaintenance
        this.taricArtifacts = taricArtifacts ?? new TaricArtifactStore()
        this.taricEngagement = taricEngagement
        this.scheduleArtifactSweep()
        this.scheduleWorkHeartbeat()
        this.scheduleTaricMaintenance()
    }

    async stop(): Promise<void> {
        if (this.artifactSweepTimer) {
            clearInterval(this.artifactSweepTimer)
            this.artifactSweepTimer = undefined
        }
        if (this.workHeartbeatTimer) {
            clearInterval(this.workHeartbeatTimer)
            this.workHeartbeatTimer = undefined
        }
        if (this.taricMaintenanceTimer) {
            clearInterval(this.taricMaintenanceTimer)
            this.taricMaintenanceTimer = undefined
        }
        this.taricSidecar?.stop()
    }

    /**
     * Taric is run as one-shot containers, so its outbox has no resident
     * consumer. Reconcile on startup and periodically to keep the derived
     * projection caught up with committed authority writes.
     */
    private scheduleTaricMaintenance(): void {
        if (!this.taricMaintenance) return
        const sweep = () => {
            void this.reconcileActiveEngagements().catch((error) => {
                console.warn("taric audit reconcile failed", error)
            })
        }
        const startup = setTimeout(sweep, 5_000)
        if (typeof startup === "object" && "unref" in startup) {
            ;(startup as { unref: () => void }).unref()
        }
        const timer = setInterval(sweep, 5 * 60_000)
        if (typeof timer === "object" && "unref" in timer) {
            ;(timer as { unref: () => void }).unref()
        }
        this.taricMaintenanceTimer = timer
    }

    private async reconcileActiveEngagements(): Promise<void> {
        if (!this.taricMaintenance || !this.taricEngagement) return
        const engagements = new Set<string>()
        for (const challenge of await this.challenge.listStoredChallenges()) {
            const binding = await this.taricEngagement.bindingRegistry.getActiveBinding(challenge.id).catch(() => undefined)
            if (binding?.engagement_id) engagements.add(binding.engagement_id)
        }
        for (const engagementId of engagements) {
            try {
                const result = await this.taricMaintenance.reconcile(engagementId)
                if (result.applied > 0 || (result.pendingOutbox ?? 0) > 0) {
                    console.log("taric audit reconciled", { engagementId, ...result })
                }
            } catch (error) {
                console.warn("taric audit reconcile unavailable", { engagementId, error: error instanceof Error ? error.message : String(error) })
            }
        }
    }

    private scheduleWorkHeartbeat(): void {
        if (!this.taricWork) return
        const beat = () => {
            void this.heartbeatWorkRuns().catch((error) => {
                console.error("taric work lease heartbeat failed", error)
            })
        }
        beat()
        const timer = setInterval(beat, 60_000)
        if (typeof timer === "object" && "unref" in timer) {
            ;(timer as { unref: () => void }).unref()
        }
        this.workHeartbeatTimer = timer
    }

    /**
     * Renew leases only while the host is actually driving the work: a live
     * solver, or a proposal waiting for human review. Otherwise the run should
     * be allowed to expire so it can be reclaimed.
     */
    private async heartbeatWorkRuns(): Promise<void> {
        if (!this.taricWork) return
        const liveSolvers = new Set(
            this.runtime
                .list()
                .filter((solver) => solver.status === "running" || solver.status === "starting" || solver.status === "stopping")
                .map((solver) => solver.id),
        )
        const awaitingReview = new Set(
            ((await this.taricAdmission?.list()) ?? [])
                .filter(
                    (entry) =>
                        (entry.status === "pending" || entry.status === "inflight") &&
                        Date.now() - Date.parse(entry.created_at) < 24 * 60 * 60 * 1000,
                )
                .map((entry) => entry.solver_id),
        )
        const admittingCheckpoint = new Set(
            (await this.taricWork.listUncommittedAdmitted())
                .filter((record) => record.status === "active")
                .map((record) => record.solver_id),
        )
        await this.taricWork.heartbeat({
            shouldRenew: (record) =>
                liveSolvers.has(record.solver_id) ||
                awaitingReview.has(record.solver_id) ||
                admittingCheckpoint.has(record.solver_id),
        })
        // Auto-admission can take seconds per proposal (one container per
        // operation), so renew live leases first and cap the batch.
        if (this.taricAdmission?.mode === "auto_l1") {
            const auto = await this.taricAdmission.admitPending({ limit: 5 })
            if (auto.admitted > 0 || auto.failed > 0) {
                console.log("taric auto_l1 admission", auto)
            }
        }
        const repair = await this.taricWork.repairAdmittedCheckpoints(5)
        if (repair.repaired > 0 || repair.failed > 0 || repair.awaitingRepair > 0) {
            console.log("taric admitted checkpoint repair", repair)
        }
    }

    private scheduleArtifactSweep(): void {
        const sweep = () => {
            void this.taricArtifacts.sweepExpired().catch((error) => {
                console.error("taric artifact retention sweep failed", error)
            })
        }
        sweep()
        const timer = setInterval(sweep, 6 * 60 * 60 * 1000)
        if (typeof timer === "object" && "unref" in timer) {
            ;(timer as { unref: () => void }).unref()
        }
        this.artifactSweepTimer = timer
    }

    static async getInstance(): Promise<DaemonManager> {
        if (this.instance) return this.instance
        const created = (async () => {
            const config = await ConfigManager.getInstance()
            const hostSettings = await config.getHostSettings()
            const taric = hostSettings.taric
            const taricImage = taric?.image?.trim() || "taric-p0:local"
            const taricVolume = taric?.volume?.trim() || "breachweave-taric-p0"
            if (taric?.enabled === true) {
                const expectedDigest = taric.imageDigest?.trim()
                if (expectedDigest) {
                    await assertTaricImageDigest({ image: taricImage, expectedDigest })
                } else if (taric.requireImageDigest === true) {
                    throw new Error("taric.imageDigest is required when taric.requireImageDigest is enabled")
                }
            }
            const bindingRegistry = new TaricBindingRegistry()
            const engagementService = taric?.enabled === true
                ? new TaricEngagementService({
                      image: taricImage,
                      volume: taricVolume,
                      bindingRegistry,
                  })
                : undefined
            let taricSidecar: TaricHttpSidecar | undefined
            if (taric?.enabled === true && taric.readBoard?.enabled === true) {
                const dispatcher = createDockerTaricReadDispatcher({
                    image: taricImage,
                    volume: taricVolume,
                    timeoutMs: taric.readBoard.requestTimeoutMs,
                })
                const sidecarToken = taric.readBoard.token ?? crypto.randomUUID()
                taricSidecar = new TaricHttpSidecar({
                    port: taric.sidecarPort,
                    token: sidecarToken,
                    dispatcher: taric.readBoard.dispatcher ?? dispatcher,
                })
                await taricSidecar.start()
                taric.readBoard = {
                    ...taric.readBoard,
                    token: sidecarToken,
                    baseUrl: taric.readBoard.baseUrl ?? `http://127.0.0.1:${taricSidecar.port}`,
                }
            }
            const proposalOutbox = taric?.proposal?.outboxDir
                ? new TaricProposalOutbox({ rootDir: taric.proposal.outboxDir })
                : new TaricProposalOutbox()
            const proposalDispatcher = taric?.proposal?.dispatcher ?? createDockerTaricProposalDispatcher({
                image: taricImage,
                volume: taricVolume,
                timeoutMs: taric?.proposal?.enabled === true ? 15_000 : undefined,
            })
            const artifactStore = new TaricArtifactStore({
                maxInlineBytes: taric?.artifact?.maxInlineBytes,
                redactText: taric?.artifact?.redactText,
                retentionDays: taric?.artifact?.retentionDays,
                backupDir: taric?.artifact?.backupDir,
            })
            const taricLeaseMs = resolveTaricLeaseMs(process.env.TCH_TARIC_LEASE_MS)
            const workManager = taric?.enabled === true
                ? new TaricWorkManager({
                  dispatcher: createDockerTaricWorkDispatcher({
                          image: taricImage,
                          volume: taricVolume,
                          timeoutMs: 15_000,
                  }),
                  policyDigest: taricDefaultAdmissionPolicyDigest(),
                  leaseMs: taricLeaseMs,
              })
                : undefined
            if (workManager) {
                console.log("taric work lease configured", {
                    leaseMs: workManager.effectiveLeaseMs,
                    source: process.env.TCH_TARIC_LEASE_MS ? "TCH_TARIC_LEASE_MS" : "default",
                })
            }
            const evidenceRecorder = taric?.enabled === true
                ? new TaricEvidenceRecorder({
                      dispatcher: createDockerTaricEvidenceDispatcher({
                          image: taricImage,
                          volume: taricVolume,
                          timeoutMs: 15_000,
                      }),
                      policyDigest: taricDefaultAdmissionPolicyDigest(),
                  })
                : undefined
            const taricMaintenance = taric?.enabled === true
                ? new TaricMaintenance({
                      dispatcher: createDockerTaricMaintenanceDispatcher({
                          image: taricImage,
                          volume: taricVolume,
                          timeoutMs: 30_000,
                      }),
                  })
                : undefined
            const authoritativeLifecycleEnabled = taric?.enabled === true && taric?.authoritativeLifecycle !== false
            const taricState = authoritativeLifecycleEnabled
                ? new TaricAuthoritativeState({
                      work: workManager,
                      artifacts: artifactStore,
                      engagement: engagementService,
                      evidenceRecorder,
                  })
                : new TaricAuthoritativeState()
            const admissionManager = new TaricAdmissionManager({
                outbox: proposalOutbox,
                proposalDispatcher,
                admissionDispatcher: createDockerTaricAdmissionDispatcher({
                    image: taricImage,
                    volume: taricVolume,
                    policyDigest: taricDefaultAdmissionPolicyDigest(),
                }),
                mode: defaultTaricAdmissionMode(taric?.proposal?.admissionMode),
                // Review can outlive the WorkRun lease, so checkpoint authority
                // is re-derived from the live work record at submission time.
                refreshProposal: async (entry) => {
                    if (!workManager || entry.proposal.kind !== "checkpoint") return undefined
                    const workRunId = entry.proposal.content.work_run_ref
                    if (typeof workRunId !== "string" || !workRunId.trim()) return undefined
                    const generation = typeof entry.proposal.content.generation === "number" ? entry.proposal.content.generation : undefined
                    const authority = await workManager.checkpointAuthority(workRunId, generation)
                    return { ...entry.proposal, content: applyTaricCheckpointAuthority(entry.proposal.content, authority) }
                },
                // The model can only propose a checkpoint; the host owns the
                // commit that turns the WorkRun into `checkpointed`.
                onAdmitted: async (entry) => {
                    if (!workManager || entry.proposal.kind !== "checkpoint") return
                    const workRunId = entry.proposal.content.work_run_ref
                    if (typeof workRunId !== "string" || !workRunId.trim()) return
                    const generation = typeof entry.proposal.content.generation === "number" ? entry.proposal.content.generation : undefined
                    try {
                        // Attach the artifacts this solver actually produced so
                        // the checkpoint carries verifiable hashes instead of
                        // free-text "evidence".
                        const artifacts = await collectCheckpointArtifacts(artifactStore, entry)
                        let payload = {
                            ...checkpointPayloadFromAdmittedProposal(entry.proposal.content),
                            ...(artifacts.artifactRefs.length > 0 ? { artifact_refs: artifacts.artifactRefs } : {}),
                        }
                        await workManager.stageAdmittedCheckpoint(workRunId, payload, generation)
                        if (evidenceRecorder && artifacts.evidenceArtifacts.length > 0) {
                            try {
                                const challengeRecord = await challenge.getChallenge(entry.challenge_id)
                                const target = selectTaricEvidenceTarget(challengeRecord)
                                if (!target) {
                                    await workManager.applyCheckpointEvidence({
                                        workRunId,
                                        gap: "target asset is unavailable for evidence binding",
                                    })
                                } else {
                                    const binding = await evidenceRecorder.bind({
                                        engagementId: entry.engagement_id,
                                        checkpointId: entry.idempotency_key,
                                        observedAt: entry.created_at,
                                        completedSteps: payload.completed_steps ?? [],
                                        artifacts: artifacts.evidenceArtifacts,
                                        target,
                                    })
                                    if (binding.status === "bound") {
                                        payload = {
                                            ...payload,
                                            observation_refs: binding.observationRefs,
                                            evidence_refs: binding.evidenceRefs,
                                        }
                                        await workManager.applyCheckpointEvidence({
                                            workRunId,
                                            observationRefs: binding.observationRefs,
                                            evidenceRefs: binding.evidenceRefs,
                                        })
                                    } else if (binding.status === "gap") {
                                        await workManager.applyCheckpointEvidence({
                                            workRunId,
                                            gap: binding.reason,
                                        })
                                    }
                                }
                            } catch (error) {
                                const message = error instanceof Error ? error.message : String(error)
                                await workManager.applyCheckpointEvidence({
                                    workRunId,
                                    gap: message,
                                }).catch((gapError) => {
                                    console.warn("taric evidence gap could not be recorded", {
                                        workRunId,
                                        error: gapError instanceof Error ? gapError.message : String(gapError),
                                    })
                                })
                                console.warn("taric evidence binding degraded to artifact-only checkpoint", {
                                    workRunId,
                                    error: message,
                                })
                            }
                        }
                        await workManager.closeWithAdmittedCheckpoint(workRunId, payload, generation)
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error)
                        await workManager.recordCheckpointCommitError(workRunId, message).catch(() => {})
                        console.warn("taric admitted checkpoint could not be committed", {
                            workRunId,
                            error: message,
                        })
                        return
                    }
                    if (taricMaintenance) {
                        await taricMaintenance.reconcile(entry.engagement_id).catch((error) => {
                            console.warn("taric audit reconcile after admission failed", {
                                engagementId: entry.engagement_id,
                                error: error instanceof Error ? error.message : String(error),
                            })
                        })
                    }
                },
            })
            const challenge = new ChallengeManager(config, engagementService, workManager, taricState)
            const runtime = new RuntimeManager(config, [
                createChallengeHostBridgeHandler(challenge),
                createTaricReadBoardHandler({
                    settings: taric?.readBoard ?? {},
                    bindingRegistry,
                    ...(taricSidecar ? { fetchImpl: fetch } : {}),
                }),
                createTaricProposalHandler({
                    settings: {
                        enabled: taric?.enabled === true && taric.proposal?.enabled === true,
                        autoAcknowledge: false,
                        outbox: proposalOutbox,
                        dispatcher: proposalDispatcher,
                    },
                    bindingRegistry,
                    ...(workManager ? { workManager } : {}),
                }),
                createTaricToolResultCaptureHandler(taricState),
            ])
            challenge.attachRuntime(runtime)
            return new DaemonManager(
                config,
                challenge,
                runtime,
                taricSidecar,
                admissionManager,
                workManager,
                artifactStore,
                engagementService,
                taricMaintenance,
            )
        })()
        this.instance = created.catch((error) => {
            if (this.instance === created) {
                this.instance = undefined
            }
            throw error
        })
        return this.instance
    }

    async reloadFromConfig(): Promise<void> {
        this.challenge.reloadFromConfig()
        await this.runtime.reloadFromConfig()
    }

    async taricStatus() {
        const outboxEntries = (await this.taricAdmission?.list()) ?? []
        const workRuns = (await this.taricWork?.list()) ?? []
        const challengeIds = (await this.challenge.listStoredChallenges()).map((challenge) => challenge.id)
        const activeBindings = (await this.taricEngagement?.countActiveBindings(challengeIds)) ?? 0
        const recentErrors = outboxEntries
            .filter(
                (entry) =>
                    entry.status === "pending" || entry.status === "inflight" || entry.status === "failed",
            )
            .map((entry) => entry.last_error ?? entry.admission_error)
            .filter((item): item is string => Boolean(item))
            .slice(-10)
        const degradationReasons = outboxEntries
            .filter((entry) => entry.status === "failed" || entry.status === "inflight")
            .map((entry) => entry.last_error ?? `proposal ${entry.idempotency_key} is ${entry.status}`)
            .slice(-10)
        const recentCheckpoints = workRuns
            .filter((record) => record.status === "checkpointed" && record.checkpoint_id)
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
            .slice(0, 20)
        const checkpointsWithEvidence = recentCheckpoints.filter(
            (record) => (record.committed_evidence_refs?.length ?? 0) > 0,
        ).length
        const evidenceGaps = recentCheckpoints
            .filter((record) => (record.committed_evidence_refs?.length ?? 0) === 0)
            .map((record) => ({
                workRunId: record.work_run_id,
                reason: record.evidence_gap ?? "checkpoint committed without evidence_refs",
                recordedAt: record.evidence_gap_at ?? record.updated_at,
            }))
        const repairErrors = workRuns
            .filter((record) => Boolean(record.checkpoint_repair_error))
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        const status = buildTaricIntegrationStatus({
            enabled: Boolean(this.taricAdmission),
            sidecarRunning: this.taricSidecar?.running ?? false,
            sidecarPort: this.taricSidecar?.running ? this.taricSidecar.port : undefined,
            authorityReachable: this.taricSidecar?.running ?? false,
            activeBindings,
            outboxPending: outboxEntries.filter((entry) => entry.status === "pending" || entry.status === "inflight").length,
            outboxFailed: outboxEntries.filter((entry) => entry.status === "failed").length,
            recentErrors,
            degradationReasons,
            evidenceCoverage: {
                recentCheckpoints: recentCheckpoints.length,
                withEvidence: checkpointsWithEvidence,
                withoutEvidence: recentCheckpoints.length - checkpointsWithEvidence,
                coverageRatio: recentCheckpoints.length > 0 ? checkpointsWithEvidence / recentCheckpoints.length : 0,
                gaps: evidenceGaps.slice(0, 10),
            },
            repair: {
                repaired: workRuns.filter((record) => Boolean(record.checkpoint_repaired_at)).length,
                awaitingRepair: workRuns.filter(
                    (record) => record.status === "active" && Boolean(record.checkpoint_admitted_at),
                ).length,
                ...(repairErrors[0]?.checkpoint_repair_error
                    ? { lastError: repairErrors[0].checkpoint_repair_error }
                    : {}),
            },
        })
        return {
            ...status,
            blackboard: await this.challenge.getTaricLifecycleStatus(),
        }
    }
}
