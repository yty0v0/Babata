import { HostBridgeError } from "./host-bridge-types"
import { taricDefaultAdmissionPolicyDigest } from "./taric-admission-policy"
import { TaricProposalOutbox, type TaricProposalDispatcher, type TaricProposalOutboxEntry } from "./taric-proposal-outbox"
import type { NormalizedTaricProposal } from "./taric-proposal-schema"

export type TaricAdmissionMode = "hitl_l1" | "auto_l1" | "disabled"
export type TaricAdmissionDispatcher = (input: { entry: TaricProposalOutboxEntry }) => Promise<{ ok: boolean; data?: unknown; error?: { code?: string; message?: string } }>

export interface TaricAdmissionManagerOptions {
    outbox: TaricProposalOutbox
    proposalDispatcher: TaricProposalDispatcher
    admissionDispatcher: TaricAdmissionDispatcher
    mode?: TaricAdmissionMode
    /**
     * Host-side follow-up after a proposal is admitted. Used to close the
     * WorkRun loop for checkpoints, which the model is not allowed to commit.
     */
    onAdmitted?: (entry: TaricProposalOutboxEntry) => Promise<void>
    /**
     * Re-derive host-owned metadata for a buffered proposal immediately before
     * it is submitted. HITL review can span lease renewals, so authority that
     * was captured at enqueue time may already be stale.
     */
    refreshProposal?: (entry: TaricProposalOutboxEntry) => Promise<NormalizedTaricProposal | undefined>
    /**
     * In auto_l1 mode only structural, non-assertive proposals are admitted
     * without a human. A checkpoint records work state; it does not publish a
     * finding. Claims still require review because they become authoritative
     * facts.
     */
    autoAdmitKinds?: NormalizedTaricProposal["kind"][]
}

export class TaricAdmissionManager {
    constructor(private readonly options: TaricAdmissionManagerOptions) {}

    get mode(): TaricAdmissionMode {
        return this.options.mode ?? "hitl_l1"
    }

    async list() {
        const entries = await this.options.outbox.list()
        return entries.map((entry) => ({
            ...entry,
            admission_mode: this.mode,
        }))
    }

    async approve(input: { idempotencyKey: string; reviewer: string }): Promise<{ entry: unknown; admission: unknown }> {
        const automated = this.mode === "auto_l1"
        if (this.mode === "disabled") {
            throw new HostBridgeError("authorization_error", "proposal admission mode is not hitl_l1")
        }
        const reviewerName = input.reviewer?.trim()
        if (!reviewerName) throw new HostBridgeError("validation_error", "reviewer is required")

        let entry = await this.options.outbox.get(input.idempotencyKey)
        if (!entry) throw new HostBridgeError("validation_error", "proposal is not found")
        if (entry.admission_state === "approved") {
            // Admission may have succeeded while the host-side follow-up
            // (for example checkpoint.commit) failed. Retrying approval must
            // be able to finish that idempotent host step.
            if (this.options.onAdmitted) await this.options.onAdmitted(entry)
            return { entry, admission: { already_applied: true } }
        }
        if (automated) {
            const allowed = this.options.autoAdmitKinds ?? ["checkpoint"]
            if (!allowed.includes(entry.proposal.kind)) {
                throw new HostBridgeError(
                    "authorization_error",
                    `auto_l1 admits only ${allowed.join(", ")}; ${entry.proposal.kind} requires human review`,
                )
            }
        }

        if (this.options.refreshProposal) {
            const refreshed = await this.options.refreshProposal(entry)
            if (refreshed) {
                if (entry.status === "acknowledged" && entry.taric_proposal_id) {
                    // A submitted Taric proposal is immutable, so a changed
                    // lease cannot be patched into it. Fail with guidance
                    // instead of surfacing an opaque admission error.
                    const queuedLease = entry.proposal.content.lease_expires_at
                    const currentLease = refreshed.content.lease_expires_at
                    if (typeof queuedLease !== "string" || queuedLease !== currentLease || Date.parse(queuedLease) <= Date.now()) {
                        throw new HostBridgeError(
                            "stale_version",
                            "checkpoint was already submitted under a stale work run lease; submit a fresh checkpoint from the active attempt",
                        )
                    }
                } else {
                    entry = (await this.options.outbox.updateProposal(entry.idempotency_key, refreshed)) ?? entry
                }
            }
        }

        // Submit the buffered model proposal first. This is the only buffered
        // operation in the governance path; admission below is fail-closed.
        if (entry.status !== "acknowledged" || !entry.taric_proposal_id) {
            // Only approve the entry under review: replaying the whole outbox
            // would submit other solvers' stale checkpoints as a side effect.
            const replay = await this.options.outbox.replay(this.options.proposalDispatcher, {
                idempotencyKeys: [entry.idempotency_key],
            })
            entry = await this.options.outbox.get(input.idempotencyKey)
            if (!entry) throw new HostBridgeError("unavailable", "proposal disappeared during replay")
            if (!entry.taric_proposal_id) {
                const detail = entry.last_error?.trim()
                const message = detail || (replay.failed > 0 ? "proposal submission did not return a Taric proposal id" : "proposal replay did not produce a Taric proposal id")
                await this.options.outbox.markAdmissionError(entry.idempotency_key, message)
                throw new HostBridgeError("unavailable", message)
            }
        }

        const admission = await this.options.admissionDispatcher({ entry })
        const data = admission.data as { ok?: unknown } | undefined
        if (!admission.ok || !data || data.ok === false) {
            const message = admission.error?.message ?? "Taric admission.evaluate failed"
            await this.options.outbox.markAdmissionError(entry.idempotency_key, message)
            throw new HostBridgeError("unavailable", message)
        }
        const updated = await this.options.outbox.markAdmission({
            idempotencyKey: entry.idempotency_key,
            state: "approved",
            reviewedBy: reviewerName,
        })
        if (updated && this.options.onAdmitted) {
            await this.options.onAdmitted(updated)
        }
        return { entry: updated, admission }
    }

    /**
     * Auto-admit pending proposals that the policy allows to skip review.
     * Used by the host heartbeat in auto_l1 mode so unattended runs still
     * close their WorkRuns instead of leaving proposals pending forever.
     */
    async admitPending(options: { limit?: number } = {}): Promise<{ admitted: number; failed: number }> {
        if (this.mode !== "auto_l1") return { admitted: 0, failed: 0 }
        const allowed = this.options.autoAdmitKinds ?? ["checkpoint"]
        const result = { admitted: 0, failed: 0 }
        const limit = Math.max(1, options.limit ?? 5)
        const entries = (await this.options.outbox.list(["pending"])).slice(0, limit)
        for (const entry of entries) {
            if (!allowed.includes(entry.proposal.kind)) continue
            try {
                await this.approve({ idempotencyKey: entry.idempotency_key, reviewer: "auto-policy" })
                result.admitted += 1
            } catch {
                result.failed += 1
            }
        }
        return result
    }

    async reject(input: { idempotencyKey: string; reviewer: string; reason: string }): Promise<{ entry: unknown }> {
        if (this.mode !== "hitl_l1") {
            throw new HostBridgeError("authorization_error", "proposal admission mode is not hitl_l1")
        }
        const reviewerName = input.reviewer?.trim()
        const reason = input.reason?.trim()
        if (!reviewerName) throw new HostBridgeError("validation_error", "reviewer is required")
        if (!reason) throw new HostBridgeError("validation_error", "reason is required")
        const entry = await this.options.outbox.get(input.idempotencyKey)
        if (!entry) throw new HostBridgeError("validation_error", "proposal is not found")
        const updated = await this.options.outbox.markAdmission({
            idempotencyKey: entry.idempotency_key,
            state: "rejected",
            reviewedBy: reviewerName,
            reason,
        })
        return { entry: updated }
    }
}

export function defaultTaricAdmissionMode(settingsMode?: string): TaricAdmissionMode {
    if (settingsMode === "auto_l1" || settingsMode === "disabled") return settingsMode
    return "hitl_l1"
}

export function defaultTaricPolicyDigest(): string {
    return taricDefaultAdmissionPolicyDigest()
}
