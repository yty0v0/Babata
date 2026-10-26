import { HostBridgeError } from "./host-bridge-types"

export interface TaricHostStateSnapshot {
    ok: boolean
    degraded?: boolean
    reason?: string
    data?: unknown
    latencyMs: number
    polledAt: string
}

export type TaricHostStatePollerHandler = (snapshot: TaricHostStateSnapshot) => void | Promise<void>

export interface TaricHostStatePollerOptions {
    poll: () => Promise<unknown>
    timeoutMs?: number
    onSnapshot?: TaricHostStatePollerHandler
}

export function taricBackoffDelay(consecutiveFailures: number): number {
    if (consecutiveFailures <= 1) return 1_000
    if (consecutiveFailures === 2) return 5_000
    return 15_000
}

export class TaricHostStatePoller {
    private timer: ReturnType<typeof setTimeout> | undefined
    private running = false
    private consecutiveFailures = 0

    constructor(private readonly options: TaricHostStatePollerOptions) {}

    get active(): boolean {
        return this.running
    }

    start(): void {
        if (this.running) return
        this.running = true
        void this.run()
    }

    stop(): void {
        this.running = false
        if (this.timer) {
            clearTimeout(this.timer)
            this.timer = undefined
        }
    }

    async pollOnce(): Promise<TaricHostStateSnapshot> {
        const startedAt = Date.now()
        let controller: AbortController | undefined
        try {
            controller = new AbortController()
            const timeoutMs = this.options.timeoutMs ?? 5_000
            const timer = setTimeout(() => controller?.abort(), timeoutMs)
            if (typeof timer === "object" && "unref" in timer) {
                ;(timer as { unref: () => void }).unref()
            }
            try {
                const data = await Promise.race([
                    this.options.poll(),
                    new Promise<never>((_, reject) => {
                        const abort = () => reject(new HostBridgeError("timeout", "Taric host.state poll timed out"))
                        controller?.signal.addEventListener("abort", abort, { once: true })
                    }),
                ])
                this.consecutiveFailures = 0
                return { ok: true, data, latencyMs: Date.now() - startedAt, polledAt: new Date().toISOString() }
            } finally {
                clearTimeout(timer)
            }
        } catch (error) {
            this.consecutiveFailures += 1
            return {
                ok: false,
                degraded: true,
                reason: error instanceof Error ? error.message : String(error),
                latencyMs: Date.now() - startedAt,
                polledAt: new Date().toISOString(),
            }
        }
    }

    private async run(): Promise<void> {
        while (this.running) {
            const snapshot = await this.pollOnce()
            try {
                await this.options.onSnapshot?.(snapshot)
            } catch {
                // A subscriber failure should not stop polling.
            }
            if (!this.running) return
            await Bun.sleep(taricBackoffDelay(snapshot.ok ? 0 : this.consecutiveFailures))
        }
    }
}

export interface TaricIntegrationStatus {
    enabled: boolean
    sidecarRunning: boolean
    sidecarPort?: number
    authorityReachable: boolean
    doctorOk?: boolean
    activeBindings: number
    outboxPending: number
    outboxFailed: number
    recentErrors: string[]
    degradationReasons: string[]
    evidenceCoverage: {
        recentCheckpoints: number
        withEvidence: number
        withoutEvidence: number
        coverageRatio: number
        gaps: Array<{ workRunId: string; reason: string; recordedAt?: string }>
    }
    repair: {
        repaired: number
        awaitingRepair: number
        lastError?: string
    }
    checkedAt: string
}

export function buildTaricIntegrationStatus(input: Partial<TaricIntegrationStatus>): TaricIntegrationStatus {
    return {
        enabled: input.enabled === true,
        sidecarRunning: input.sidecarRunning === true,
        sidecarPort: input.sidecarPort,
        authorityReachable: input.authorityReachable === true,
        doctorOk: input.doctorOk,
        activeBindings: input.activeBindings ?? 0,
        outboxPending: input.outboxPending ?? 0,
        outboxFailed: input.outboxFailed ?? 0,
        recentErrors: input.recentErrors ?? [],
        degradationReasons: input.degradationReasons ?? [],
        evidenceCoverage: input.evidenceCoverage ?? {
            recentCheckpoints: 0,
            withEvidence: 0,
            withoutEvidence: 0,
            coverageRatio: 0,
            gaps: [],
        },
        repair: input.repair ?? {
            repaired: 0,
            awaitingRepair: 0,
        },
        checkedAt: input.checkedAt ?? new Date().toISOString(),
    }
}

export interface TaricAuditDrift {
    recordId: string
    field: string
    expected: unknown
    actual: unknown
}

export function verifyTaricAuditRecords(
    records: Array<{ id: string; action: string; status: string; outcome?: string }>,
): { ok: boolean; drift: TaricAuditDrift[] } {
    const drift: TaricAuditDrift[] = []
    for (const record of records) {
        if (!record.id || !record.action || !record.status) {
            drift.push({ recordId: record.id || "<missing>", field: "identity", expected: "non-empty", actual: record.id ?? record.action ?? record.status })
        }
        if (record.status === "completed" && !record.outcome) {
            drift.push({ recordId: record.id, field: "outcome", expected: "non-empty", actual: record.outcome })
        }
    }
    return { ok: drift.length === 0, drift }
}
