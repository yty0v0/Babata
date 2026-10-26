import { HostBridgeError } from "./host-bridge-types"
import type { TaricProposalOutboxEntry, TaricProposalDispatcher } from "./taric-proposal-outbox"

export interface TaricDockerProposalDispatcherOptions {
    image: string
    volume: string
    dockerPath?: string
    timeoutMs?: number
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function proposalKind(subjectType: string): string {
    return subjectType === "action_recommendation" ? "action_intent" : subjectType
}

export function toProposalRequest(entry: TaricProposalOutboxEntry): Record<string, unknown> {
    const content = {
        ...entry.proposal.content,
        schema_version: "1.0.0",
        engagement_id: entry.engagement_id,
        kind: proposalKind(entry.proposal.subject_type),
    }
    return {
        engagement_id: entry.engagement_id,
        subject_type: entry.proposal.subject_type,
        expected_version: entry.proposal.expected_version,
        client_request_id: entry.idempotency_key,
        content,
        ...(entry.proposal.target_id ? { target_id: entry.proposal.target_id } : {}),
        ...(entry.proposal.subject_ref ? { subject_ref: entry.proposal.subject_ref } : {}),
        ...(entry.proposal.content.work_run_ref ? { work_run_id: entry.proposal.content.work_run_ref } : {}),
        ...(typeof entry.proposal.content.generation === "number" ? { generation: entry.proposal.content.generation } : {}),
    }
}

export function createDockerTaricProposalDispatcher(options: TaricDockerProposalDispatcherOptions): TaricProposalDispatcher {
    return async (entry) => {
        const request = toProposalRequest(entry)
        const args = [
            options.dockerPath ?? "docker",
            "run", "--rm",
            "-e", "TARIC_DB=/data/authority.sqlite",
            "-e", "TARIC_CONTENT_ROOT=/data/content",
            "-e", `TARIC_ENGAGEMENT_ID=${entry.engagement_id}`,
            "-e", "TARIC_PRINCIPAL_ROLE=model",
            "-e", `TARIC_PRINCIPAL_ID=${entry.role}-${entry.solver_id}`,
            "-v", `${options.volume}:/data`,
            options.image,
            "proposal.submit",
            JSON.stringify(request),
        ]
        const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
        const timer = setTimeout(() => {
            proc.kill()
        }, options.timeoutMs ?? 15_000)
        if (typeof timer === "object" && "unref" in timer) {
            ;(timer as { unref: () => void }).unref()
        }
        try {
            const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
            if (exitCode === 0) {
                try {
                    return JSON.parse(stdout) as { ok: boolean; data?: unknown; error?: { code?: string; message?: string } }
                } catch {
                    return { ok: false, error: { code: "internal_error", message: "Taric CLI returned invalid JSON" } }
                }
            }
            const stderr = await new Response(proc.stderr).text()
            return {
                ok: false,
                error: {
                    code: "unavailable_host",
                    message: stderr.trim() || `Taric CLI exited with ${exitCode}`,
                },
            }
        } catch (error) {
            return { ok: false, error: { code: "unavailable_host", message: getErrorMessage(error) } }
        } finally {
            clearTimeout(timer)
        }
    }
}


export interface TaricDockerAdmissionDispatcherOptions {
    image: string
    volume: string
    dockerPath?: string
    timeoutMs?: number
    policyDigest: string
}

export type TaricAdmissionDispatcher = (input: { entry: TaricProposalOutboxEntry }) => Promise<{ ok: boolean; data?: unknown; error?: { code?: string; message?: string } }>

export function createDockerTaricAdmissionDispatcher(options: TaricDockerAdmissionDispatcherOptions): TaricAdmissionDispatcher {
    return async ({ entry }) => {
        if (!entry.taric_proposal_id) {
            return { ok: false, error: { code: "validation_error", message: "proposal has no Taric proposal id" } }
        }
        const request = {
            engagement_id: entry.engagement_id,
            proposal_id: entry.taric_proposal_id,
            expected_version: entry.proposal.expected_version,
            policy_digest: options.policyDigest,
        }
        const args = [
            options.dockerPath ?? "docker",
            "run", "--rm",
            "-e", "TARIC_DB=/data/authority.sqlite",
            "-e", "TARIC_CONTENT_ROOT=/data/content",
            "-e", `TARIC_ENGAGEMENT_ID=${entry.engagement_id}`,
            "-e", "TARIC_PRINCIPAL_ROLE=operator",
            "-e", `TARIC_PRINCIPAL_ID=${entry.reviewed_by ?? "breachweave-operator"}`,
            "-v", `${options.volume}:/data`,
            options.image,
            "admission.evaluate",
            JSON.stringify(request),
        ]
        const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
        const timer = setTimeout(() => {
            proc.kill()
        }, options.timeoutMs ?? 15_000)
        if (typeof timer === "object" && "unref" in timer) {
            ;(timer as { unref: () => void }).unref()
        }
        try {
            const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
            if (exitCode === 0) {
                try {
                    return JSON.parse(stdout) as { ok: boolean; data?: unknown; error?: { code?: string; message?: string } }
                } catch {
                    return { ok: false, error: { code: "internal_error", message: "Taric CLI returned invalid JSON" } }
                }
            }
            const stderr = await new Response(proc.stderr).text()
            return {
                ok: false,
                error: { code: "unavailable_host", message: stderr.trim() || `Taric CLI exited with ${exitCode}` },
            }
        } catch (error) {
            return { ok: false, error: { code: "unavailable_host", message: getErrorMessage(error) } }
        } finally {
            clearTimeout(timer)
        }
    }
}
