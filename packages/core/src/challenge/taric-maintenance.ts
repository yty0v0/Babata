import { HostBridgeError } from "./host-bridge-types"

export type TaricMaintenanceOperation = "audit.doctor" | "audit.reconcile"

export type TaricMaintenanceDispatcher = (input: {
    operation: TaricMaintenanceOperation
    request: Record<string, unknown>
    engagementId?: string
}) => Promise<{ ok: boolean; data?: unknown; error?: { code?: string; message?: string } }>

export interface TaricMaintenanceOptions {
    dispatcher: TaricMaintenanceDispatcher
}

export interface TaricReconcileResult {
    applied: number
    committedSeq?: number
    projectedSeq?: number
    pendingOutbox?: number
}

function toNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function readWatermarks(data: Record<string, unknown> | undefined): { committedSeq?: number; projectedSeq?: number } {
    const watermarks = data?.watermarks
    if (!watermarks || typeof watermarks !== "object") return {}
    const record = watermarks as Record<string, unknown>
    return {
        committedSeq: toNumber(record.committed_seq),
        projectedSeq: toNumber(record.projected_seq),
    }
}

/**
 * Taric writes authority and derived projections through an outbox. The
 * BreachWeave host runs Taric as one-shot containers, so nothing consumes that
 * outbox unless the host does it. Without this the board accepts writes but
 * every read still sees the pre-write projection.
 *
 * Reconciliation is idempotent and only rebuilds derived state, so running it
 * on startup and after admissions is safe.
 */
export class TaricMaintenance {
    constructor(private readonly options: TaricMaintenanceOptions) {}

    async doctor(engagementId: string): Promise<{ committedSeq?: number; projectedSeq?: number; pendingOutbox?: number }> {
        const response = await this.options.dispatcher({
            operation: "audit.doctor",
            engagementId,
            request: { engagement_id: engagementId },
        })
        if (!response.ok) {
            throw new HostBridgeError("unavailable", response.error?.message?.trim() || "Taric audit.doctor failed")
        }
        const data = response.data as Record<string, unknown> | undefined
        const watermarks = readWatermarks(data)
        return {
            ...watermarks,
            pendingOutbox: toNumber(data?.pending_outbox),
        }
    }

    async reconcile(engagementId: string): Promise<TaricReconcileResult> {
        const preview = await this.options.dispatcher({
            operation: "audit.reconcile",
            engagementId,
            request: { engagement_id: engagementId, action: "preview" },
        })
        if (!preview.ok) {
            throw new HostBridgeError("unavailable", preview.error?.message?.trim() || "Taric audit.reconcile preview failed")
        }
        const pending = toNumber((preview.data as Record<string, unknown> | undefined)?.pending_outbox) ?? 0
        if (pending === 0) {
            const watermarks = readWatermarks(preview.data as Record<string, unknown> | undefined)
            return { applied: 0, ...watermarks, pendingOutbox: 0 }
        }
        const replay = await this.options.dispatcher({
            operation: "audit.reconcile",
            engagementId,
            request: { engagement_id: engagementId, action: "replay" },
        })
        if (!replay.ok) {
            throw new HostBridgeError("unavailable", replay.error?.message?.trim() || "Taric audit.reconcile replay failed")
        }
        const data = replay.data as Record<string, unknown> | undefined
        const doctor = data?.doctor as Record<string, unknown> | undefined
        const watermarks = readWatermarks(doctor ?? data)
        return {
            applied: toNumber(data?.applied) ?? 0,
            ...watermarks,
            pendingOutbox: toNumber(doctor?.pending_outbox),
        }
    }
}
