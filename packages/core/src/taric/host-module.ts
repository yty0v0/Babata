import { compareTaricCompatibility, validateExpectedTaricCompatibility } from "./compatibility"
import type {
    TaricAdapterProfile,
    TaricHealth,
    TaricHostBinding,
    TaricHostModuleOptions,
    TaricHostObservationInput,
    TaricProposalInput,
    TaricCheckpointProposalInput,
    TaricQueryInput,
    TaricServiceAdapter,
} from "./types"
import { TaricOperationError, TaricUnavailableError } from "./types"

export const TARIC_MODEL_QUERY_OPERATIONS = ["context.query", "resource.query", "evidence.query", "coverage.query", "work.query"] as const
export const TARIC_MODEL_PROPOSAL_OPERATIONS = ["proposal.submit", "checkpoint.propose"] as const
export const TARIC_HOST_ONLY_OPERATIONS = [
    "capture.observation",
    "resource.revise",
    "work.claim",
    "work.renew",
    "work.reclaim",
    "work.transition",
    "work.query",
    "coverage.record",
    "coverage.query",
    "coverage.gate",
    "proposal.list",
    "artifact.session.bind",
    "artifact.store.begin",
    "artifact.store.append",
    "artifact.store.commit",
    "artifact.metadata",
    "artifact.ingest_file",
    "artifact.content.read",
    "artifact.content.list",
    "artifact.session.output",
    "review.pack",
    "review.submit",
    "admission.evaluate",
    "admission.commit",
    "checkpoint.commit",
    "work.resume",
] as const
const MAX_QUERY_LIMIT = 50
const MAX_PROPOSAL_BYTES = 32 * 1024
const MAX_OBSERVATION_BYTES = 1024 * 1024
const OPERATION_FIELDS: Record<string, readonly string[]> = {
    "context.query": ["work_run_id", "budget", "cursor", "read_seq", "filters", "ordering", "work_item_id", "worker_role", "policy_version", "include_candidates"],
    "resource.query": ["as_of", "cursor", "page_size", "kind"],
    "evidence.query": ["as_of", "cursor", "page_size", "kind"],
    "proposal.list": ["cursor", "page_size"],
    "proposal.submit": ["subject_type", "expected_version", "content", "target_id", "subject_ref", "proposal_id", "client_request_id", "idempotency_key"],
    "checkpoint.propose": ["work_run_id", "generation", "checkpoint"],
    "resource.revise": ["resource_id", "expected_version", "content", "identity", "asset_type", "revision", "method", "path", "content_hash", "source_observation_refs", "client_request_id", "idempotency_key"],
    "work.claim": ["work_item_id", "host_id", "agent_id", "ttl_ms", "task_session_ref"],
    "work.renew": ["work_run_id", "generation", "ttl_ms"],
    "work.reclaim": ["work_run_id", "agent_id", "ttl_ms"],
    "work.transition": ["work_run_id", "generation", "status", "idempotency_key"],
    "coverage.record": ["cell_id", "expected_version", "status", "evidence_refs", "counter_evidence_refs", "not_applicable_reason", "limitations", "tested_at", "external_result_state", "origin_reached", "control_observation_ref", "resource_revision_ref", "resource_revision", "scope_revision", "resource_ref", "test_category", "identity_ref", "operation", "parameter", "conditions", "role", "tenant_ref", "path", "network_condition", "method", "idempotency_key"],
    "coverage.query": ["resource_ref", "test_category", "status", "include_candidates", "page_size", "cursor", "read_seq"],
    "coverage.gate": ["manifest_id", "scope_revision", "resource_revisions", "read_seq"],
    "artifact.session.bind": ["session_id", "root", "mode"],
    "artifact.store.begin": ["session_id", "payload_kind", "media_type", "expected_bytes", "expected_hash", "storage_mode", "host_ref", "category", "captured_at", "work_run_id", "attempt_id", "generation", "idempotency_key"],
    "artifact.store.append": ["session_id", "upload_id", "ordinal", "chunk_hash", "data", "encoding", "idempotency_key"],
    "artifact.store.commit": ["session_id", "upload_id", "total_bytes", "chunk_count", "content_hash", "idempotency_key"],
    "artifact.metadata": ["session_id", "content_ref"],
    "artifact.ingest_file": ["session_id", "path", "authorize_spool_access", "payload_kind", "media_type", "expected_bytes", "expected_hash", "delete_source", "idempotency_key"],
    "artifact.content.read": ["session_id", "content_ref", "offset", "length", "chunk_cursor", "max_response_bytes"],
    "artifact.content.list": ["session_id", "cursor", "page_size"],
    "artifact.session.output": ["session_id", "cursor", "execution_cursor", "page_size", "work_run_id", "attempt_id", "include_content", "max_response_bytes"],
    "review.pack": ["proposal_id"],
    "review.submit": ["proposal_id", "reviewer_id", "reviewer_kind", "input_hash", "verdict", "policy_digest", "evidence_snapshot_hash", "expected_version", "rubric_hash", "limitations", "idempotency_key"],
    "admission.evaluate": ["proposal_id", "expected_version", "policy_digest", "evidence_snapshot_hash", "idempotency_key"],
    "admission.commit": ["proposal_id", "expected_version", "policy_digest", "evidence_snapshot_hash", "idempotency_key"],
    "checkpoint.commit": ["work_run_id", "generation", "checkpoint", "idempotency_key"],
    "work.resume": ["work_run_id", "generation"],
    "capture.observation": ["observation", "subject_type", "expected_version", "target_id", "work_run_id", "generation", "client_request_id", "idempotency_key"],
}

function requiredText(value: string, field: string): string {
    const result = value.trim()
    if (!result) throw new Error(`${field} is required`)
    return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function validateBinding(binding: TaricHostBinding): void {
    requiredText(binding.projectId, "projectId")
    requiredText(binding.tenantId, "tenantId")
    requiredText(binding.engagementId, "engagementId")
    requiredText(binding.hostPrincipalId, "hostPrincipalId")
    requiredText(binding.modelPrincipalId, "modelPrincipalId")
}

function equalBinding(expected: TaricHostBinding, actual: TaricHostBinding): boolean {
    return (
        expected.projectId === actual.projectId &&
        expected.tenantId === actual.tenantId &&
        expected.engagementId === actual.engagementId &&
        expected.hostPrincipalId === actual.hostPrincipalId &&
        expected.modelPrincipalId === actual.modelPrincipalId
    )
}

function payloadBytes(input: Record<string, unknown>): number {
    try {
        return new TextEncoder().encode(JSON.stringify(input)).byteLength
    } catch {
        throw new Error("Taric request must be JSON serializable")
    }
}

function nowIso(): string {
    return new Date().toISOString()
}

function safeDetailsText(value: string, fallback = ""): string {
    return value
        .replace(/((?:token|password|secret|credential|authorization|connection[_-]?string)\s*[=:]\s*)[^\s,;]+/gi, "$1<redacted>")
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
        .replace(/(?:postgres(?:ql)?:\/\/)[^\s"']+/gi, "<redacted-connection-string>")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .slice(0, 256) || fallback
}

function safeOperationDetails(value: unknown): unknown {
    if (!isRecord(value)) return undefined
    if (value.kind === "contract" && typeof value.contract_name === "string" && Array.isArray(value.violations)) {
        const violations = value.violations.slice(0, 16).flatMap((item) => {
            if (!isRecord(item)) return []
            const params: Record<string, string | number | boolean> = {}
            if (isRecord(item.params)) {
                const allowed = new Set(["missingProperty", "additionalProperty", "type", "format", "comparison", "limit", "exclusive", "pattern", "propertyName", "expected"])
                for (const [key, parameter] of Object.entries(item.params)) {
                    if (Object.keys(params).length >= 8 || !allowed.has(key)) continue
                    if (typeof parameter === "string") params[key] = /token|password|secret|credential|authorization|private[_-]?key/i.test(parameter) ? "<redacted>" : safeDetailsText(parameter)
                    else if (typeof parameter === "number" && Number.isFinite(parameter) || typeof parameter === "boolean") params[key] = parameter
                }
            }
            return [{
                instance_path: typeof item.instance_path === "string" ? item.instance_path.split("/").map((part) => /token|password|secret|credential|authorization|private[_-]?key/i.test(part) ? "<redacted>" : part).join("/").slice(0, 256) : "",
                keyword: typeof item.keyword === "string" ? safeDetailsText(item.keyword, "validation").slice(0, 64) : "validation",
                ...(Object.keys(params).length ? { params } : {}),
                message: typeof item.message === "string" ? safeDetailsText(item.message, "contract constraint failed") : "contract constraint failed",
            }]
        })
        return violations.length ? { kind: "contract", contract_name: value.contract_name.slice(0, 128), violations } : undefined
    }
    if (value.kind === "compatibility" && (value.backend === "sqlite" || value.backend === "postgresql" || value.backend === "unknown") && isRecord(value.expected)) {
        const safeMap = (map: Record<string, unknown>): Record<string, string> => Object.fromEntries(Object.entries(map).slice(0, 8).flatMap(([key, item]) => typeof item === "string" || typeof item === "number" || typeof item === "boolean" ? [[key.slice(0, 64), /token|password|secret|credential|authorization|connection[_-]?string/i.test(key) ? "<redacted>" : safeDetailsText(String(item))]] : []))
        return { kind: "compatibility", backend: value.backend, expected: safeMap(value.expected), ...(isRecord(value.observed) ? { observed: safeMap(value.observed) } : {}), ...(typeof value.failed_marker === "string" ? { failed_marker: safeDetailsText(value.failed_marker) } : {}), ...(Array.isArray(value.missing) ? { missing: value.missing.filter((item): item is string => typeof item === "string").slice(0, 32).map((item) => /token|password|secret|credential|authorization|private[_-]?key/i.test(item) ? "<redacted>" : safeDetailsText(item)) } : {}) }
    }
    return undefined
}

export class TaricHostModule {
    private readonly options: TaricHostModuleOptions
    private adapter: TaricServiceAdapter | undefined
    private currentHealth: TaricHealth
    private initialized = false
    private closed = false

    constructor(options: TaricHostModuleOptions) {
        validateBinding(options.binding)
        if (options.mode !== "taric_best_effort" && options.mode !== "taric_required") {
            throw new Error(`invalid Taric memory mode: ${String(options.mode)}`)
        }
        validateExpectedTaricCompatibility(options.expectedCompatibility)
        this.options = options
        this.adapter = options.adapter
        this.currentHealth = {
            status: "unavailable",
            profile: options.adapter?.transportProfile ?? (options.adapter ? "bun_in_process" : "unavailable"),
            mode: options.mode,
            checkedAt: nowIso(),
            reason: options.adapter ? "Taric adapter has not been initialized" : "No verified Taric adapter is configured",
        }
    }

    async initialize(): Promise<TaricHealth> {
        this.assertOpen()
        if (this.initialized && (this.currentHealth.status === "healthy" || !this.adapter)) return this.health()
        const adapter = this.adapter
        if (!adapter) {
            this.currentHealth = { status: "unavailable", profile: "unavailable", mode: this.options.mode, checkedAt: nowIso(), reason: "No verified Taric adapter is configured" }
            this.initialized = true
            return this.health()
        }

        try {
            await adapter.checkHealth?.()
        } catch (error) {
            this.currentHealth = {
                status: "unavailable",
                profile: adapter.transportProfile ?? "bun_in_process",
                mode: this.options.mode,
                checkedAt: nowIso(),
                reason: error instanceof Error ? error.message : String(error),
            }
            this.initialized = false
            return this.health()
        }

        try {
            const [profile, binding] = await Promise.all([adapter.getProfile(), adapter.getBinding()])
            this.validateProfile(profile)
            if (!equalBinding(this.options.binding, binding)) throw new Error("Taric authority binding does not match the trusted project context")
            this.currentHealth = { status: "healthy", profile: adapter.transportProfile ?? "bun_in_process", mode: this.options.mode, checkedAt: nowIso() }
            this.initialized = true
            return this.health()
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error)
            this.markDegraded(reason)
            this.currentHealth = { ...this.currentHealth, status: "unavailable", profile: "unavailable" }
            this.initialized = true
            await this.closeAdapterAfterStartupFailure(adapter)
            throw new TaricUnavailableError(reason || "Taric startup validation failed", this.options.mode)
        }
    }

    health(): TaricHealth {
        return { ...this.currentHealth }
    }

    getHealth(): TaricHealth {
        return this.health()
    }

    refreshHealth(): Promise<TaricHealth> {
        return this.initialize()
    }

    getBinding(): TaricHostBinding {
        return { ...this.options.binding }
    }

    assertAvailable(): void {
        this.requireReadyAdapter()
    }

    async query(operation: (typeof TARIC_MODEL_QUERY_OPERATIONS)[number], input: TaricQueryInput = {}): Promise<unknown> {
        if (!TARIC_MODEL_QUERY_OPERATIONS.includes(operation)) throw new Error(`unsupported Taric model query: ${operation}`)
        const payload: Record<string, unknown> = { ...input }
        if (payload.engagement_id !== undefined && payload.engagement_id !== this.options.binding.engagementId) {
            throw new Error("engagement_id is host-bound and does not match the trusted project context")
        }
        delete payload.engagement_id
        if (operation === "context.query") {
            if (payload.budget === undefined && payload.limit !== undefined) payload.budget = payload.limit
            delete payload.limit
            payload.include_candidates = false
            if (typeof payload.budget === "number" && (!Number.isInteger(payload.budget) || payload.budget < 1 || payload.budget > MAX_QUERY_LIMIT * 1000)) {
                throw new Error("budget must be an integer between 1 and 50000")
            }
        } else {
            if (payload.page_size === undefined && payload.limit !== undefined) payload.page_size = payload.limit
            delete payload.limit
            if (payload.page_size === undefined) payload.page_size = 20
            if (!Number.isInteger(payload.page_size) || Number(payload.page_size) < 1 || Number(payload.page_size) > MAX_QUERY_LIMIT) {
                throw new Error(`page_size must be between 1 and ${MAX_QUERY_LIMIT}`)
            }
            if (operation === "coverage.query") payload.include_candidates = false
        }
        return this.invoke(operation, payload)
    }

    async submitProposal(input: TaricProposalInput): Promise<unknown> {
        const eventId = requiredText(input.eventId, "eventId")
        if (!/^[A-Za-z0-9._:-]{1,128}$/.test(eventId)) throw new Error("eventId must be a valid Taric client_request_id")
        if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new Error("expectedVersion must be a non-negative integer")
        const content = { ...input.content, schema_version: "1.0.0", engagement_id: this.options.binding.engagementId }
        const payload: Record<string, unknown> = {
            subject_type: input.subjectType,
            expected_version: input.expectedVersion,
            content,
            client_request_id: eventId,
            idempotency_key: eventId,
        }
        if (payloadBytes(payload) > MAX_PROPOSAL_BYTES) throw new Error(`proposal exceeds ${MAX_PROPOSAL_BYTES} bytes`)
        return this.invoke("proposal.submit", payload)
    }

    async proposeCheckpoint(input: TaricCheckpointProposalInput): Promise<unknown> {
        const payload: Record<string, unknown> = {
            work_run_id: requiredText(input.workRunId, "workRunId"),
            generation: input.generation,
            checkpoint: input.checkpoint,
        }
        requiredText(input.eventId, "eventId")
        if (!Number.isInteger(input.generation) || input.generation < 1) throw new Error("generation must be a positive integer")
        if (payloadBytes(payload) > MAX_PROPOSAL_BYTES) throw new Error(`checkpoint proposal exceeds ${MAX_PROPOSAL_BYTES} bytes`)
        return this.invoke("checkpoint.propose", payload)
    }

    async captureObservation(input: TaricHostObservationInput): Promise<unknown> {
        if (input.sourceKind !== "tool_result" && input.sourceKind !== "platform_result" && input.sourceKind !== "host_event") {
            throw new Error("invalid host observation sourceKind")
        }
        requiredText(input.eventId, "eventId")
        if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.eventId)) throw new Error("eventId must be a valid Taric request identity")
        if (!isRecord(input.observation)) throw new Error("observation must be an object")
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        const observationInput = input.observation as Record<string, unknown>
        const resourceRef = typeof observationInput.resource_ref === "string" ? observationInput.resource_ref : ""
        const allowedObservationFields = new Set(["resource_ref", "observed_at", "statement", "artifact_refs", "limitations", "status"])
        for (const key of Object.keys(observationInput)) if (!allowedObservationFields.has(key)) throw new Error(`observation.${key} is not an approved Taric field`)
        if (!uuidPattern.test(resourceRef)) throw new Error("observation.resource_ref must be a resolved Taric Resource UUID")
        if (typeof observationInput.observed_at !== "string" || !Number.isFinite(Date.parse(observationInput.observed_at))) throw new Error("observation.observed_at must be an ISO timestamp")
        if (typeof observationInput.statement !== "string" || !observationInput.statement.trim() || observationInput.statement.length > 16_384) throw new Error("observation.statement must contain 1 to 16384 characters")
        if (/flag\{[^}]*\}|bearer\s+[a-z0-9._~+/-]+=*/i.test(observationInput.statement)) throw new Error("observation.statement contains a sensitive value")
        if (!Array.isArray(observationInput.artifact_refs) || observationInput.artifact_refs.some((ref) => {
            if (!isRecord(ref)) return true
            const allowedArtifactFields = new Set(["host_ref", "content_ref", "artifact_id", "content_hash", "manifest_hash", "storage_mode", "content_status", "integrity_status", "media_type", "byte_length"])
            if (Object.keys(ref).some((key) => !allowedArtifactFields.has(key))) return true
            if (!(typeof ref.host_ref === "string" && ref.host_ref.trim()) && !(typeof ref.content_ref === "string" && ref.content_ref.trim())) return true
            return ref.artifact_id !== undefined && (typeof ref.artifact_id !== "string" || !uuidPattern.test(ref.artifact_id))
        })) throw new Error("observation.artifact_refs must be bounded references to committed Artifacts")
        if (observationInput.limitations && (!Array.isArray(observationInput.limitations) || observationInput.limitations.some((item) => typeof item !== "string" || item.length > 512))) throw new Error("observation.limitations must contain bounded strings")
        if (observationInput.status && !["observed", "negative", "inconclusive"].includes(String(observationInput.status))) throw new Error("observation.status is invalid")
        if (input.targetId && input.targetId !== resourceRef) throw new Error("targetId must match the host-resolved Resource UUID")
        const sourceKind = input.sourceKind === "tool_result" ? "tool" : "host"
        const observationRecord = {
            ...input.observation,
            schema_version: "1.0.0",
            engagement_id: this.options.binding.engagementId,
            kind: "observation",
            resource_ref: resourceRef,
            observed_at: observationInput.observed_at,
            statement: observationInput.statement,
            artifact_refs: observationInput.artifact_refs,
            limitations: Array.isArray(observationInput.limitations) ? observationInput.limitations : ["Captured by BreachWeave host; raw tool output remains host-controlled."],
            provenance: {
                host_id: this.options.binding.hostPrincipalId,
                producer_id: this.options.binding.hostPrincipalId,
                source_kind: sourceKind,
                dispatch_id: input.eventId,
            },
        }
        const payload: Record<string, unknown> = {
            observation: observationRecord,
            client_request_id: input.eventId,
            idempotency_key: input.eventId,
            ...(input.workRunId ? { work_run_id: input.workRunId } : {}),
            ...(input.generation !== undefined ? { generation: input.generation } : {}),
        }
        if (input.generation !== undefined && (!Number.isInteger(input.generation) || input.generation < 1)) throw new Error("generation must be a positive integer")
        if (payloadBytes(payload) > MAX_OBSERVATION_BYTES) throw new Error(`observation exceeds ${MAX_OBSERVATION_BYTES} bytes`)
        return this.invoke("capture.observation", payload)
    }

    /**
     * Dispatch a host-owned Taric operation. Model query/proposal methods do
     * not expose this escape hatch; governance code is the only caller.
     */
    async invokeHost(operation: (typeof TARIC_HOST_ONLY_OPERATIONS)[number], input: Record<string, unknown>): Promise<unknown> {
        if (!TARIC_HOST_ONLY_OPERATIONS.includes(operation)) throw new Error(`unsupported Taric host operation: ${operation}`)
        return this.invoke(operation, input)
    }

    private async invoke(operation: string, input: Record<string, unknown>): Promise<unknown> {
        const allowedFields = OPERATION_FIELDS[operation]
        if (!allowedFields) throw new Error(`unsupported Taric operation: ${operation}`)
        for (const key of Object.keys(input)) {
            if (key !== "engagement_id" && !allowedFields.includes(key)) throw new Error(`${key} is not accepted by Taric ${operation}`)
        }
        if (input.engagement_id !== undefined && input.engagement_id !== this.options.binding.engagementId) {
            throw new Error("engagement_id is host-bound and does not match the trusted project context")
        }
        const request = { ...input, engagement_id: this.options.binding.engagementId }
        const maxBytes = operation === "capture.observation" ? MAX_OBSERVATION_BYTES : MAX_PROPOSAL_BYTES
        if (payloadBytes(request) > maxBytes) throw new Error(`request exceeds ${maxBytes} bytes`)
        const adapter = this.requireReadyAdapter()
        try {
            const response = await adapter.invoke(operation, request)
            if (!isRecord(response) || typeof response.ok !== "boolean") {
                throw new TaricUnavailableError("Taric adapter returned an invalid dispatch response", this.options.mode)
            }
            if (response.ok) return response.data
            const error = isRecord(response.error) ? response.error : {}
            const operationError = new TaricOperationError(String(error.code ?? "internal_error"), String(error.message ?? "Taric operation failed").slice(0, 256), safeOperationDetails(error.details))
            if (operationError.code === "unavailable_host") this.markDegraded(operationError.message)
            throw operationError
        } catch (error) {
            if (error instanceof TaricOperationError) {
                if (error.code === "unavailable_host") this.markDegraded(error.message)
                throw error
            }
            this.markDegraded(error instanceof Error ? error.message : String(error))
            if (error instanceof TaricUnavailableError) throw new TaricUnavailableError(error.message, this.options.mode, "after_dispatch")
            throw new TaricUnavailableError(this.currentHealth.reason ?? "Taric transport failed", this.options.mode, "after_dispatch")
        }
    }

    async close(): Promise<void> {
        if (this.closed) return
        this.closed = true
        const adapter = this.adapter
        this.adapter = undefined
        this.currentHealth = { status: "closed", profile: "unavailable", mode: this.options.mode, checkedAt: nowIso() }
        if (adapter) await adapter.close()
    }

    private validateProfile(profile: TaricAdapterProfile): void {
        if (profile.status !== "verified") throw new Error("Taric adapter profile is unavailable or unverified")
        const mismatches = compareTaricCompatibility(this.options.expectedCompatibility, profile.compatibility)
        if (mismatches.length > 0) throw new Error(`Taric compatibility mismatch: ${mismatches.join(", ")}`)
    }

    private markDegraded(reason: string): void {
        this.currentHealth = {
            status: "degraded",
            profile: this.adapter?.transportProfile ?? "bun_in_process",
            mode: this.options.mode,
            checkedAt: nowIso(),
            reason,
        }
    }

    private requireReadyAdapter(): TaricServiceAdapter {
        this.assertOpen()
        if (!this.initialized || this.currentHealth.status !== "healthy" || !this.adapter) {
            throw new TaricUnavailableError(this.currentHealth.reason ?? "Taric authority is unavailable", this.options.mode)
        }
        return this.adapter
    }

    private assertOpen(): void {
        if (this.closed) throw new TaricUnavailableError("Taric host module is closed", this.options.mode)
    }

    private async closeAdapterAfterStartupFailure(adapter: TaricServiceAdapter): Promise<void> {
        this.adapter = undefined
        try {
            await adapter.close()
        } catch {
            // Preserve the startup validation error while still attempting resource cleanup.
        }
    }
}

export function createTaricHostModule(options: TaricHostModuleOptions): TaricHostModule {
    return new TaricHostModule(options)
}
