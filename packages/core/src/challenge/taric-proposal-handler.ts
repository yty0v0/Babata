import { CHALLENGE_ENV_CHALLENGE_ID } from "./env"
import { HostBridgeError } from "./host-bridge-types"
import { TaricBindingRegistry } from "./taric-binding-registry"
import { normalizeTaricProposal } from "./taric-proposal-schema"
import { TaricProposalOutbox, type TaricProposalDispatcher } from "./taric-proposal-outbox"
import type { TaricWorkManager } from "./taric-work-manager"
import type { HostBridgeHandleContext, HostBridgeHandler } from "../runtime/types"

export interface TaricProposalSettings {
    enabled?: boolean
    autoAcknowledge?: boolean
    outbox?: TaricProposalOutbox
    dispatcher?: TaricProposalDispatcher
}

export interface TaricProposalHandlerOptions {
    settings: TaricProposalSettings
    bindingRegistry?: TaricBindingRegistry
    workManager?: TaricWorkManager
}

export function createTaricProposalHandler(options: TaricProposalHandlerOptions): HostBridgeHandler {
    const bindingRegistry = options.bindingRegistry ?? new TaricBindingRegistry()
    const outbox = options.settings.outbox ?? new TaricProposalOutbox()

    async function submitProposal(context: HostBridgeHandleContext): Promise<unknown> {
        if (options.settings.enabled !== true) {
            return { degraded: true, reason: "taric_proposal_disabled" }
        }
        const challengeId = context.getSolverEnvValue(CHALLENGE_ENV_CHALLENGE_ID)?.trim()
        if (!challengeId) {
            return { degraded: true, reason: "challenge_taric_binding_unavailable" }
        }
        const binding = await bindingRegistry.getActiveBinding(challengeId)
        if (!binding?.engagement_id) {
            return { degraded: true, reason: "challenge_taric_binding_unavailable" }
        }

        const workState = context.getWorkState?.()
        const checkpointAuthority = options.workManager && workState?.workRunId
            ? await options.workManager.checkpointAuthority(workState.workRunId, workState.generation)
            : undefined
        let proposal
        try {
            proposal = normalizeTaricProposal(context.params, checkpointAuthority)
        } catch (error) {
            throw new HostBridgeError("validation_error", error instanceof Error ? error.message : String(error))
        }

        const role = context.getSolver?.()?.role
        const solverId = context.solverId
        let idempotencyKey: string
        try {
            const existing = await outbox.list(["pending", "failed", "inflight"])
            const duplicate = existing.find((entry) =>
                entry.challenge_id === challengeId &&
                entry.engagement_id === binding.engagement_id &&
                entry.solver_id === solverId &&
                JSON.stringify(entry.proposal) === JSON.stringify(proposal)
            )
            idempotencyKey = duplicate?.idempotency_key ?? crypto.randomUUID()
        } catch (error) {
            if (error instanceof HostBridgeError) throw error
            throw new HostBridgeError("unavailable", "failed to inspect Taric proposal outbox")
        }

        const existingEntry = await outbox.get(idempotencyKey)
        const entry = existingEntry ?? await outbox.enqueue({
            idempotency_key: idempotencyKey,
            challenge_id: challengeId,
            engagement_id: binding.engagement_id,
            solver_id: solverId,
            role: role ?? "executor",
            proposal,
        })

        if (options.settings.autoAcknowledge === true) {
            const dispatcher = options.settings.dispatcher
            if (!dispatcher) throw new HostBridgeError("unavailable", "Taric proposal dispatcher is unavailable")
            const result = await outbox.replay(dispatcher)
            return {
                proposal_id: entry.idempotency_key,
                status: result.applied > 0 ? "acknowledged" : "pending",
                replay: result,
            }
        }
        return {
            proposal_id: entry.idempotency_key,
            status: entry.status,
            trust_level: "L0",
        }
    }

    return {
        async handle(context) {
            if (context.action !== "taric_proposal_submit") return { handled: false }
            return {
                handled: true,
                data: await submitProposal(context),
            }
        },
    }
}
