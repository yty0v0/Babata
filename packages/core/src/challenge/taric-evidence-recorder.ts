import { mkdir, rename, rm } from "fs/promises"
import { dirname, join, resolve } from "path"
import { TCH_AGENT_HOME_DIR } from "../config/index"
import { HostBridgeError } from "./host-bridge-types"
import { redactTaricArtifactText } from "./taric-artifact-store"
import type { TaricEvidenceDispatcher } from "./taric-evidence-dispatcher"

const MAX_STATEMENT_CHARS = 1_800
const MAX_STEP_CHARS = 220
const MAX_STEPS = 8
const MAX_ARTIFACTS = 20
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEFAULT_EVIDENCE_DIR = resolve(TCH_AGENT_HOME_DIR, "taric-evidence")

export interface TaricEvidenceArtifact {
    artifact_id: string
    content_ref: string
    content_hash: string
    byte_length: number
}

export interface TaricEvidenceTarget {
    assetHash: string
    asset: string
    assetType?: "host" | "domain" | "service" | "web_app" | "endpoint" | "other"
}

export interface TaricEvidenceRecorderOptions {
    dispatcher: TaricEvidenceDispatcher
    policyDigest: string
    principalId?: string
    rootDir?: string
}

export type TaricEvidenceBindingResult =
    | {
          status: "bound"
          resourceRef: string
          observationRef: string
          observationRefs: string[]
          evidenceRefs: string[]
      }
    | {
          status: "skipped"
          reason: "no_artifacts"
          observationRefs: []
          evidenceRefs: []
      }
    | {
          status: "gap"
          reason: string
          observationRefs: []
          evidenceRefs: []
      }

interface AdmittedProposal {
    proposalId: string
    recordId: string
}

interface ResourceBinding {
    engagement_id: string
    asset_hash: string
    asset: string
    prepared_at: string
    resource_ref?: string
    updated_at: string
}

function requireText(value: string | undefined, field: string): string {
    const text = value?.trim()
    if (!text) throw new HostBridgeError("validation_error", `${field} is required`)
    return text
}

function requireUuid(value: string, field: string): string {
    const text = requireText(value, field)
    if (!UUID_PATTERN.test(text)) throw new HostBridgeError("validation_error", `${field} must be a UUID`)
    return text
}

function boundedText(value: string, maxChars: number): string {
    const normalized = redactTaricArtifactText(value).replace(/\s+/g, " ").trim()
    if (normalized.length <= maxChars) return normalized
    return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`
}

function stableArtifactHash(artifacts: TaricEvidenceArtifact[]): string {
    const hashes = artifacts.map((artifact) => artifact.content_hash).sort()
    return new Bun.CryptoHasher("sha256").update(hashes.join("\n")).digest("hex")
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

function proposalIdFrom(data: unknown): string {
    if (!data || typeof data !== "object") return ""
    const record = data as Record<string, unknown>
    if (typeof record.id === "string") return record.id
    if (typeof record.proposal_id === "string") return record.proposal_id
    return ""
}

function admittedRecordIdFrom(data: unknown): string {
    if (!data || typeof data !== "object") return ""
    const record = data as Record<string, unknown>
    if (record.ok === false) return ""
    const canonical = record.record
    if (canonical && typeof canonical === "object" && typeof (canonical as Record<string, unknown>).id === "string") {
        return (canonical as Record<string, unknown>).id as string
    }
    const proposal = record.proposal
    if (proposal && typeof proposal === "object" && typeof (proposal as Record<string, unknown>).canonical_id === "string") {
        return (proposal as Record<string, unknown>).canonical_id as string
    }
    return ""
}

function artifactReference(artifact: TaricEvidenceArtifact): Record<string, unknown> {
    const hash = requireText(artifact.content_hash, "artifact.content_hash")
    return {
        artifact_id: requireUuid(artifact.artifact_id, "artifact.artifact_id"),
        content_ref: requireText(artifact.content_ref, "artifact.content_ref"),
        content_hash: hash,
        byte_length: artifact.byte_length,
        storage_mode: "taric_stored",
        content_status: "available",
        integrity_status: "verified",
        payload_kind: "text",
        summary: `Committed tool artifact metadata (${artifact.byte_length} bytes, ${hash.slice(0, 19)}...)`,
    }
}

export function buildTaricObservationStatement(input: {
    checkpointId: string
    completedSteps: string[]
    artifacts: TaricEvidenceArtifact[]
}): string {
    const steps = input.completedSteps
        .slice(0, MAX_STEPS)
        .map((step) => boundedText(step, MAX_STEP_CHARS))
        .filter(Boolean)
    const artifactSummaries = input.artifacts
        .slice(0, MAX_ARTIFACTS)
        .map((artifact) => `${artifact.content_hash} (${artifact.byte_length} bytes)`)
    const statement = [
        `Checkpoint ${boundedText(input.checkpointId, 80)} recorded committed tool output.`,
        steps.length > 0 ? `Completed steps: ${steps.join(" | ")}.` : "",
        artifactSummaries.length > 0 ? `Artifacts: ${artifactSummaries.join(" | ")}.` : "",
        "Raw artifact content was not copied into this observation.",
    ]
        .filter(Boolean)
        .join(" ")
    return boundedText(statement, MAX_STATEMENT_CHARS)
}

export class TaricEvidenceRecorder {
    private readonly dispatcher: TaricEvidenceDispatcher
    private readonly policyDigest: string
    private readonly principalId: string
    private readonly rootDir: string
    private readonly resourceCache = new Map<string, string>()
    private readonly observationCache = new Map<string, Extract<TaricEvidenceBindingResult, { status: "bound" }>>()

    constructor(options: TaricEvidenceRecorderOptions) {
        this.dispatcher = options.dispatcher
        this.policyDigest = requireText(options.policyDigest, "policyDigest")
        this.principalId = options.principalId?.trim() || "breachweave-host"
        this.rootDir = resolve(options.rootDir ?? DEFAULT_EVIDENCE_DIR)
    }

    private resourceBindingPath(engagementId: string, assetHash: string): string {
        const digest = new Bun.CryptoHasher("sha256")
            .update(`${engagementId}\n${assetHash}`)
            .digest("hex")
        return join(this.rootDir, "resources", `${digest}.json`)
    }

    private async getResourceBinding(engagementId: string, assetHash: string): Promise<ResourceBinding | undefined> {
        const path = this.resourceBindingPath(engagementId, assetHash)
        if (!(await Bun.file(path).exists())) return
        try {
            return await Bun.file(path).json() as ResourceBinding
        } catch {
            throw new HostBridgeError("unavailable", "failed to read Taric evidence resource binding")
        }
    }

    async bind(input: {
        engagementId: string
        checkpointId: string
        observedAt?: string
        completedSteps: string[]
        artifacts: TaricEvidenceArtifact[]
        target: TaricEvidenceTarget
    }): Promise<TaricEvidenceBindingResult> {
        const artifacts = input.artifacts
            .filter((artifact) => artifact.artifact_id && artifact.content_ref && artifact.content_hash)
            .slice(0, MAX_ARTIFACTS)
            .sort((a, b) => a.content_hash.localeCompare(b.content_hash))
        if (artifacts.length === 0) {
            return { status: "skipped", reason: "no_artifacts", observationRefs: [], evidenceRefs: [] }
        }

        const engagementId = requireText(input.engagementId, "engagementId")
        const checkpointId = requireText(input.checkpointId, "checkpointId")
        const observationKey = `bw-observation:${checkpointId}:${stableArtifactHash(artifacts)}`
        const cached = this.observationCache.get(observationKey)
        if (cached) return cached

        try {
            const observedAt = input.observedAt && Number.isFinite(Date.parse(input.observedAt))
                ? new Date(Date.parse(input.observedAt)).toISOString()
                : new Date().toISOString()
            const resourceRef = await this.ensureResource({
                engagementId,
                observedAt,
                target: input.target,
            })
            const statement = buildTaricObservationStatement({
                checkpointId,
                completedSteps: input.completedSteps,
                artifacts,
            })
            const observation = await this.submitAndAdmit({
                engagementId,
                idempotencyKey: observationKey,
                subjectType: "observation",
                content: {
                    schema_version: "1.0.0",
                    created_at: observedAt,
                    engagement_id: engagementId,
                    kind: "observation",
                    resource_ref: resourceRef,
                    observed_at: observedAt,
                    statement,
                    artifact_refs: artifacts.map(artifactReference),
                    limitations: ["Derived from committed Artifact metadata; raw content is not included."],
                },
            })
            const result: Extract<TaricEvidenceBindingResult, { status: "bound" }> = {
                status: "bound",
                resourceRef,
                observationRef: observation.recordId,
                observationRefs: [observation.recordId],
                evidenceRefs: [observation.recordId],
            }
            this.observationCache.set(observationKey, result)
            return result
        } catch (error) {
            return {
                status: "gap",
                reason: error instanceof Error ? error.message : String(error),
                observationRefs: [],
                evidenceRefs: [],
            }
        }
    }

    private async ensureResource(input: {
        engagementId: string
        observedAt: string
        target: TaricEvidenceTarget
    }): Promise<string> {
        const assetHash = requireText(input.target.assetHash, "target.assetHash")
        const cacheKey = `${input.engagementId}:${assetHash}`
        const cached = this.resourceCache.get(cacheKey)
        if (cached) return cached

        const bindingPath = this.resourceBindingPath(input.engagementId, assetHash)
        const existing = await this.getResourceBinding(input.engagementId, assetHash)
        if (existing?.resource_ref) {
            this.resourceCache.set(cacheKey, existing.resource_ref)
            return existing.resource_ref
        }
        const preparedAt = existing?.prepared_at ?? input.observedAt
        if (!existing) {
            await atomicWriteJson(bindingPath, {
                engagement_id: input.engagementId,
                asset_hash: assetHash,
                asset: requireText(input.target.asset, "target.asset"),
                prepared_at: preparedAt,
                updated_at: new Date().toISOString(),
            } satisfies ResourceBinding)
        }

        const admitted = await this.submitAndAdmit({
            engagementId: input.engagementId,
            idempotencyKey: `bw-resource:${cacheKey}`,
            subjectType: "resource",
            content: {
                schema_version: "1.0.0",
                created_at: preparedAt,
                engagement_id: input.engagementId,
                kind: "resource",
                asset_type: input.target.assetType ?? "endpoint",
                identity: {
                    asset: requireText(input.target.asset, "target.asset"),
                    asset_hash: assetHash,
                },
                revision: 1,
            },
        })
        this.resourceCache.set(cacheKey, admitted.recordId)
        await atomicWriteJson(bindingPath, {
            engagement_id: input.engagementId,
            asset_hash: assetHash,
            asset: requireText(input.target.asset, "target.asset"),
            prepared_at: preparedAt,
            resource_ref: admitted.recordId,
            updated_at: new Date().toISOString(),
        } satisfies ResourceBinding)
        return admitted.recordId
    }

    private async submitAndAdmit(input: {
        engagementId: string
        idempotencyKey: string
        subjectType: "resource" | "observation"
        content: Record<string, unknown>
    }): Promise<AdmittedProposal> {
        const submitted = await this.dispatcher({
            operation: "proposal.submit",
            principalRole: "host",
            principalId: this.principalId,
            request: {
                engagement_id: input.engagementId,
                subject_type: input.subjectType,
                expected_version: 0,
                content: input.content,
                idempotency_key: input.idempotencyKey,
            },
        })
        if (!submitted.ok) {
            throw new HostBridgeError("unavailable", submitted.error?.message?.trim() || `Taric ${input.subjectType} submission failed`)
        }
        const proposalId = proposalIdFrom(submitted.data)
        if (!proposalId) throw new HostBridgeError("unavailable", `Taric ${input.subjectType} submission returned no proposal id`)

        const admitted = await this.dispatcher({
            operation: "admission.evaluate",
            // Taric's host role can propose but does not receive `admit` by
            // default. Admission remains host-controlled through the same
            // trusted operator identity used by the work-item path.
            principalRole: "operator",
            principalId: this.principalId,
            request: {
                engagement_id: input.engagementId,
                proposal_id: proposalId,
                expected_version: 0,
                policy_digest: this.policyDigest,
                idempotency_key: `bw-admit:${proposalId}`,
            },
        })
        if (!admitted.ok) {
            throw new HostBridgeError("unavailable", admitted.error?.message?.trim() || `Taric ${input.subjectType} admission failed`)
        }
        const recordId = admittedRecordIdFrom(admitted.data)
        if (!recordId) throw new HostBridgeError("unavailable", `Taric ${input.subjectType} admission produced no canonical record`)
        return {
            proposalId,
            recordId: requireUuid(recordId, `${input.subjectType}.record_id`),
        }
    }
}
