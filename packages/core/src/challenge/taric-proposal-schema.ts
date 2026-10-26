export type TaricProposalKind = "work_item" | "claim" | "checkpoint" | "correction"

export interface NormalizedTaricProposal {
    kind: TaricProposalKind
    subject_type: "work_item" | "claim" | "checkpoint" | "action_recommendation"
    expected_version: number
    content: Record<string, unknown>
    target_id?: string
    subject_ref?: string
}

/**
 * Host-owned WorkRun metadata for a checkpoint. Taric rejects checkpoints
 * that are not bound to an active WorkRun Attempt, so these fields can never
 * be taken from model input.
 */
export interface TaricCheckpointAuthority {
    work_item_ref: string
    work_run_ref: string
    attempt_ref: string
    generation: number
    target_version: number
    work_item_version: number
    scope_version: number
    owner: { host_id: string; agent_id: string }
    lease_expires_at: string
    source_read_seq: number
    scope_ref?: string
}

/**
 * Re-stamp a queued checkpoint with fresh host authority.
 *
 * HITL review can take longer than a WorkRun lease. The checkpoint must be
 * bound to the lease that is current at submission time, not the lease that
 * happened to be current when the model enqueued it.
 */
export function applyTaricCheckpointAuthority(content: Record<string, unknown>, authority: TaricCheckpointAuthority): Record<string, unknown> {
    const contextManifest = getObject(content.context_manifest)
    const { scope_ref: _previousScopeRef, ...rest } = content
    return {
        ...rest,
        ...(authority.scope_ref ? { scope_ref: authority.scope_ref } : {}),
        work_item_ref: authority.work_item_ref,
        work_run_ref: authority.work_run_ref,
        attempt_ref: authority.attempt_ref,
        generation: authority.generation,
        target_version: authority.target_version,
        work_item_version: authority.work_item_version,
        scope_version: authority.scope_version,
        owner: { host_id: authority.owner.host_id, agent_id: authority.owner.agent_id },
        lease_expires_at: authority.lease_expires_at,
        source_read_seq: authority.source_read_seq,
        context_manifest: { ...contextManifest, read_seq: authority.source_read_seq },
    }
}

const PROPOSAL_KINDS = new Set<TaricProposalKind>(["work_item", "claim", "checkpoint", "correction"])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function getObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return value as Record<string, unknown>
}

function requireText(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
    return value.trim()
}

function optionalUuid(value: unknown, field: string): string | undefined {
    if (value === undefined) return undefined
    const text = requireText(value, field)
    if (!UUID_PATTERN.test(text)) throw new Error(`${field} must be a UUID`)
    return text
}

function stringList(value: unknown, field: string, options?: { minItems?: number; allowEmpty?: boolean }): string[] {
    if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
    if (options?.minItems !== undefined && value.length < options.minItems) throw new Error(`${field} must contain at least ${options.minItems} item(s)`)
    if (options?.allowEmpty === false && value.length === 0) throw new Error(`${field} must not be empty`)
    return value.map((item) => requireText(item, field))
}

function uuidList(value: unknown, field: string, options?: { minItems?: number }): string[] {
    const items = stringList(value, field, options)
    for (const item of items) {
        if (!UUID_PATTERN.test(item)) throw new Error(`${field} must contain UUIDs`)
    }
    return items
}

function rejectWriterFields(content: Record<string, unknown>): void {
    for (const field of ["id", "version", "trust_level", "trust_phase", "display_id", "commit_seq", "policy_digest", "policy_version", "review_ref", "review_refs", "admission_status", "policy_result", "accept"]) {
        if (field in content) {
            throw new Error(`proposal content must not contain writer field: ${field}`)
        }
    }
}

function requireNonNegativeInteger(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new Error(`${field} must be a non-negative integer`)
    }
    return value
}

function requirePositiveInteger(value: unknown, field: string): number {
    const parsed = requireNonNegativeInteger(value, field)
    if (parsed < 1) throw new Error(`${field} must be a positive integer`)
    return parsed
}

function requireTimestamp(value: unknown, field: string): string {
    const text = requireText(value, field)
    const time = Date.parse(text)
    if (!Number.isFinite(time)) throw new Error(`${field} must be an ISO timestamp`)
    return new Date(time).toISOString()
}

export function normalizeTaricProposal(params: unknown, checkpointAuthority?: TaricCheckpointAuthority): NormalizedTaricProposal {
    const data = getObject(params)
    const kind = requireText(data.kind, "kind") as TaricProposalKind
    if (!PROPOSAL_KINDS.has(kind)) {
        throw new Error(`unsupported Taric proposal kind: ${kind}`)
    }
    const expectedVersion = data.expected_version
    if (typeof expectedVersion !== "number" || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
        throw new Error("expected_version must be a non-negative integer")
    }
    const content = getObject(data.content)
    rejectWriterFields(content)

    if (kind === "work_item") {
        const normalized = {
            title: requireText(content.title, "content.title"),
            status: "queued" as const,
            acceptance_criteria: stringList(content.acceptance_criteria, "content.acceptance_criteria", { minItems: 1 }),
            ...(content.goal !== undefined ? { goal: requireText(content.goal, "content.goal") } : {}),
            ...(content.scope_ref !== undefined ? { scope_ref: optionalUuid(content.scope_ref, "content.scope_ref") } : {}),
            ...(content.depends_on !== undefined ? { depends_on: uuidList(content.depends_on, "content.depends_on") } : {}),
            ...(content.risk_class !== undefined ? { risk_class: requireText(content.risk_class, "content.risk_class") } : {}),
        }
        if (normalized.risk_class !== undefined && !["informational", "finding", "action"].includes(normalized.risk_class)) {
            throw new Error("content.risk_class is invalid")
        }
        return { kind, subject_type: "work_item", expected_version: expectedVersion, content: normalized, target_id: optionalUuid(data.target_id, "target_id"), subject_ref: optionalUuid(data.subject_ref, "subject_ref") }
    }

    if (kind === "claim") {
        return {
            kind,
            subject_type: "claim",
            expected_version: expectedVersion,
            content: {
                schema_version: "1.0.0",
                kind: "claim",
                proposition: requireText(content.proposition, "content.proposition"),
                status: "proposed" as const,
                evidence_refs: uuidList(content.evidence_refs, "content.evidence_refs", { minItems: 1 }),
                limitations: stringList(content.limitations, "content.limitations", { minItems: 1 }),
            },
            target_id: optionalUuid(data.target_id, "target_id"),
            subject_ref: optionalUuid(data.subject_ref, "subject_ref"),
        }
    }

    if (kind === "checkpoint") {
        if (!checkpointAuthority) {
            throw new Error("checkpoint requires an active Taric work run")
        }
        const optionalStringList = (value: unknown, field: string) => (value === undefined ? [] : stringList(value, field))
        const optionalUuidList = (value: unknown, field: string) => (value === undefined ? [] : uuidList(value, field))
        const authority = checkpointAuthority
        // A checkpoint create has no existing canonical record to target.
        // Forwarding target_id makes Taric treat it as an update, which then
        // fails the "updates require a positive version" rule.
        // Evidence and observation references are host-derived after admission.
        // Never forward model-supplied identifiers into the checkpoint.
        return {
            kind,
            subject_type: "checkpoint",
            // A checkpoint is always a new immutable record. Update semantics
            // would require a canonical checkpoint target, which a model
            // cannot supply; retries must still be creates.
            expected_version: 0,
            content: {
                schema_version: "1.0.0",
                kind: "checkpoint",
                ...(authority.scope_ref ? { scope_ref: optionalUuid(authority.scope_ref, "checkpoint.scope_ref") } : {}),
                work_item_ref: optionalUuid(authority.work_item_ref, "checkpoint.work_item_ref"),
                work_run_ref: optionalUuid(authority.work_run_ref, "checkpoint.work_run_ref"),
                attempt_ref: optionalUuid(authority.attempt_ref, "checkpoint.attempt_ref"),
                generation: requirePositiveInteger(authority.generation, "checkpoint.generation"),
                target_version: requireNonNegativeInteger(authority.target_version, "checkpoint.target_version"),
                work_item_version: requirePositiveInteger(authority.work_item_version, "checkpoint.work_item_version"),
                scope_version: requireNonNegativeInteger(authority.scope_version, "checkpoint.scope_version"),
                owner: {
                    host_id: requireText(authority.owner?.host_id, "checkpoint.owner.host_id"),
                    agent_id: requireText(authority.owner?.agent_id, "checkpoint.owner.agent_id"),
                },
                lease_expires_at: requireTimestamp(authority.lease_expires_at, "checkpoint.lease_expires_at"),
                source_read_seq: requireNonNegativeInteger(authority.source_read_seq, "checkpoint.source_read_seq"),
                completed_steps: stringList(content.completed_steps, "content.completed_steps", { minItems: 0 }),
                next_steps: stringList(content.next_steps, "content.next_steps", { minItems: 1 }),
                observation_refs: [],
                evidence_refs: [],
                negative_results: optionalStringList(content.negative_results, "content.negative_results"),
                unresolved_work: optionalStringList(content.unresolved_work ?? content.open_questions, "content.unresolved_work"),
                host_decision_refs: optionalUuidList(content.host_decision_refs, "content.host_decision_refs"),
                external_action_state: content.external_action_state === undefined ? "none" : requireText(content.external_action_state, "content.external_action_state"),
                budget: getObject(content.budget),
                draft_refs: optionalUuidList(content.draft_refs, "content.draft_refs"),
                handoff_refs: optionalUuidList(content.handoff_refs, "content.handoff_refs"),
                action_refs: optionalUuidList(content.action_refs, "content.action_refs"),
                tool_result_refs: optionalUuidList(content.tool_result_refs, "content.tool_result_refs"),
                context_manifest: {
                    ...getObject(content.context_manifest),
                    ...(content.facts_used === undefined
                        ? {}
                        : {
                              context_snapshot_id: crypto.randomUUID(),
                              read_seq: authority.source_read_seq,
                              builder_version: "breachweave-taric-work/1",
                              sources: stringList(content.facts_used, "content.facts_used").map((fact) => ({ kind: "fact", summary: fact })),
                          }),
                },
            },
            // A checkpoint is always a new immutable record. Forwarding
            // target_id turns it into an update, which Taric then rejects
            // because the target is not a checkpoint owned by this engagement.
            target_id: undefined,
            subject_ref: undefined,
        }
    }

    return {
        kind: "correction",
        subject_type: "action_recommendation",
        expected_version: expectedVersion,
        content: {
            schema_version: "1.0.0",
            kind: "action_intent",
            target: optionalUuid(content.target_ref, "content.target_ref") ?? "",
            method: "correction",
            status: "recommended",
            reason: requireText(content.reason, "content.reason"),
            replacement_refs: uuidList(content.replacement_refs, "content.replacement_refs", { minItems: 1 }),
        },
        target_id: optionalUuid(data.target_id, "target_id"),
        subject_ref: optionalUuid(data.subject_ref, "subject_ref"),
    }
}
