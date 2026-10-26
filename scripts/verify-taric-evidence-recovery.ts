import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { taricDefaultAdmissionPolicyDigest } from "../packages/core/src/challenge/taric-admission-policy"
import { TaricArtifactStore } from "../packages/core/src/challenge/taric-artifact-store"
import { TaricBindingRegistry } from "../packages/core/src/challenge/taric-binding-registry"
import { createDockerTaricEvidenceDispatcher } from "../packages/core/src/challenge/taric-evidence-dispatcher"
import { TaricEvidenceRecorder } from "../packages/core/src/challenge/taric-evidence-recorder"
import { TaricEngagementService } from "../packages/core/src/challenge/taric-engagement-service"
import { createDockerTaricWorkDispatcher } from "../packages/core/src/challenge/taric-docker-work-dispatcher"
import { createDockerTaricMaintenanceDispatcher } from "../packages/core/src/challenge/taric-docker-maintenance-dispatcher"
import { TaricMaintenance } from "../packages/core/src/challenge/taric-maintenance"
import { resolveTaricLeaseMs, TaricWorkManager } from "../packages/core/src/challenge/taric-work-manager"

const image = process.env.TARIC_E2E_IMAGE?.trim() || "taric-p0:local"
const volume = process.env.TARIC_E2E_VOLUME?.trim()
if (!volume) throw new Error("TARIC_E2E_VOLUME is required")

const root = await mkdtemp(join(tmpdir(), "breachweave-taric-e2e-"))
const challengeId = `dvwa-evidence-${Date.now()}`
const challenge = {
    id: challengeId,
    name: "DVWA evidence binding E2E",
    description: "Real Taric authority check using the DVWA scoped target.",
    title: "DVWA evidence binding E2E",
    difficulty: "local",
    level: 1,
    hint_viewed: false,
    hint_content: null,
    instance_status: "stopped",
    planner_status: "stop" as const,
    entrypoint: ["http://172.23.112.1/DVWA/"],
    assets_url: ["http://172.23.112.1/DVWA/"],
    assets_ip: [],
    assets: {
        urls: [{
            asset: "http://172.23.112.1/DVWA/",
            asset_hash: "bacb98027664bc6a42c6479e16afc1e9",
            scanned: false,
        }],
        ips: [],
    },
}

const policyDigest = taricDefaultAdmissionPolicyDigest()
const bindingRegistry = new TaricBindingRegistry(join(root, "challenges"))
const engagementService = new TaricEngagementService({ image, volume, bindingRegistry, timeoutMs: 30_000 })
const evidenceDispatcher = createDockerTaricEvidenceDispatcher({ image, volume, timeoutMs: 30_000 })
const workDispatcher = createDockerTaricWorkDispatcher({ image, volume, timeoutMs: 30_000 })
const maintenance = new TaricMaintenance({
    dispatcher: createDockerTaricMaintenanceDispatcher({ image, volume, timeoutMs: 30_000 }),
})
const leaseMs = resolveTaricLeaseMs(String(120_000))

async function resumeCheckpoint(engagementId: string, workRunId: string): Promise<Record<string, unknown>> {
    const args = [
        "docker",
        "run",
        "--rm",
        "-e", "TARIC_DB=/data/authority.sqlite",
        "-e", "TARIC_CONTENT_ROOT=/data/content",
        "-e", `TARIC_ENGAGEMENT_ID=${engagementId}`,
        "-e", "TARIC_PRINCIPAL_ROLE=host",
        "-e", "TARIC_PRINCIPAL_ID=breachweave-host",
        "-v", `${volume}:/data`,
        image,
        "work.resume",
        JSON.stringify({
            engagement_id: engagementId,
            work_run_id: workRunId,
            host_id: "breachweave-host",
        }),
    ]
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    if (exitCode !== 0) throw new Error(stderr.trim() || `Taric work.resume exited with ${exitCode}`)
    const response = JSON.parse(stdout) as { ok?: boolean; data?: { checkpoint?: Record<string, unknown> }; error?: { message?: string } }
    if (!response.ok) throw new Error(response.error?.message || "Taric work.resume failed")
    if (!response.data?.checkpoint) throw new Error("Taric work.resume returned no checkpoint")
    return response.data.checkpoint
}

try {
    const binding = await engagementService.ensureBinding(challenge)
    if (!binding.engagement_id) throw new Error("engagement binding did not return an id")

    const workRoot = join(root, "work")
    const workManager = new TaricWorkManager({
        rootDir: workRoot,
        dispatcher: workDispatcher,
        policyDigest,
        leaseMs,
    })
    const workItem = await workManager.ensureWorkItem({
        challengeId,
        engagementId: binding.engagement_id,
        solverId: "evidence-e2e",
        role: "executor",
        scopeRef: binding.taric_refs?.scope_record_id,
    })
    const run = await workManager.claim({
        challengeId,
        engagementId: binding.engagement_id,
        workItemId: workItem.work_item_id,
        solverId: "evidence-e2e",
        role: "executor",
    })

    const artifactStore = new TaricArtifactStore({ rootDir: join(root, "artifacts") })
    const artifact = await artifactStore.begin({
        engagementId: binding.engagement_id,
        attemptId: run.attempt_id,
        workRunId: run.work_run_id,
        acl: { read: true },
    })
    await artifactStore.append(
        artifact.artifact_id,
        "DVWA SQL injection response: authenticated page returned five user rows.",
    )
    const committedArtifact = await artifactStore.commit(artifact.artifact_id)

    const payload = {
        completed_steps: ["authenticated to DVWA and reproduced SQL injection"],
        next_steps: ["confirm evidence binding in Taric authority"],
        facts_used: ["DVWA target is reachable within the declared scope"],
        open_questions: [],
        artifact_refs: [{
            artifact_id: committedArtifact.artifact_id,
            content_ref: committedArtifact.content_ref,
            content_hash: committedArtifact.hash,
            byte_length: committedArtifact.total_bytes,
            storage_mode: "taric_stored",
            content_status: "available",
            integrity_status: "verified",
            payload_kind: "text",
        }],
    }
    await workManager.stageAdmittedCheckpoint(run.work_run_id, payload, run.generation)
    const evidence = await new TaricEvidenceRecorder({
        dispatcher: evidenceDispatcher,
        policyDigest,
        rootDir: join(root, "evidence"),
    }).bind({
        engagementId: binding.engagement_id,
        checkpointId: `dvwa-checkpoint-${run.work_run_id}`,
        observedAt: new Date().toISOString(),
        completedSteps: payload.completed_steps,
        artifacts: [{
            artifact_id: committedArtifact.artifact_id,
            content_ref: committedArtifact.content_ref,
            content_hash: committedArtifact.hash as string,
            byte_length: committedArtifact.total_bytes,
        }],
        target: {
            assetHash: challenge.assets.urls[0]!.asset_hash,
            asset: challenge.assets.urls[0]!.asset,
            assetType: "endpoint",
        },
    })
    if (evidence.status !== "bound") throw new Error(`evidence binding did not succeed: ${JSON.stringify(evidence)}`)
    await workManager.applyCheckpointEvidence({
        workRunId: run.work_run_id,
        observationRefs: evidence.observationRefs,
        evidenceRefs: evidence.evidenceRefs,
    })
    const closed = await workManager.closeWithAdmittedCheckpoint(
        run.work_run_id,
        { ...payload, observation_refs: evidence.observationRefs, evidence_refs: evidence.evidenceRefs },
        run.generation,
    )
    if (closed.status !== "checkpointed" || !closed.checkpoint_id) {
        throw new Error("WorkRun did not close with a checkpoint")
    }
    if (!closed.committed_evidence_refs?.length) {
        throw new Error("committed checkpoint has no evidence refs")
    }

    await maintenance.reconcile(binding.engagement_id)
    const checkpoint = await resumeCheckpoint(binding.engagement_id, closed.work_run_id)
    const checkpointObservationRefs = Array.isArray(checkpoint.observation_refs) ? checkpoint.observation_refs : []
    const checkpointEvidenceRefs = Array.isArray(checkpoint.evidence_refs) ? checkpoint.evidence_refs : []
    if (checkpointObservationRefs.length === 0 || checkpointEvidenceRefs.length === 0) {
        throw new Error("Taric checkpoint does not expose evidence refs")
    }

    const recoveryItem = await workManager.ensureWorkItem({
        challengeId,
        engagementId: binding.engagement_id,
        solverId: "recovery-e2e",
        role: "executor",
        scopeRef: binding.taric_refs?.scope_record_id,
    })
    const recoveryRun = await workManager.claim({
        challengeId,
        engagementId: binding.engagement_id,
        workItemId: recoveryItem.work_item_id,
        solverId: "recovery-e2e",
        role: "executor",
    })
    await workManager.stageAdmittedCheckpoint(recoveryRun.work_run_id, {
        completed_steps: ["simulate a crash after admission"],
        next_steps: ["repair the admitted checkpoint"],
        facts_used: ["commit did not run before the host object was replaced"],
        open_questions: [],
    }, recoveryRun.generation)

    const restartedManager = new TaricWorkManager({
        rootDir: workRoot,
        dispatcher: workDispatcher,
        policyDigest,
        leaseMs,
    })
    const repair = await restartedManager.repairAdmittedCheckpoints(5)
    const recovered = await restartedManager.get(recoveryRun.work_run_id)
    if (repair.repaired !== 1 || recovered?.status !== "checkpointed" || !recovered.checkpoint_repaired_at) {
        throw new Error(`repair did not close the WorkRun: ${JSON.stringify({ repair, recovered })}`)
    }

    console.log(JSON.stringify({
        ok: true,
        challengeId,
        engagementId: binding.engagement_id,
        effectiveLeaseMs: restartedManager.effectiveLeaseMs,
        boundWorkRun: {
            workRunId: closed.work_run_id,
            checkpointId: closed.checkpoint_id,
            observationRefs: closed.committed_observation_refs,
            evidenceRefs: closed.committed_evidence_refs,
        },
        authorityCheckpoint: {
            id: checkpoint.checkpoint_id,
            observationRefs: checkpointObservationRefs,
            evidenceRefs: checkpointEvidenceRefs,
        },
        repair: {
            ...repair,
            workRunId: recoveryRun.work_run_id,
            checkpointId: recovered.checkpoint_id,
            repairedAt: recovered.checkpoint_repaired_at,
        },
    }, null, 2))
} finally {
    await rm(root, { recursive: true, force: true })
}
