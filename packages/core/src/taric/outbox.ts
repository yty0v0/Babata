import { appendFile, mkdir } from "fs/promises"
import { dirname } from "path"

export type TaricOutboxEventStatus = "pending" | "replayed" | "conflict" | "indeterminate"

export interface TaricOutboxEvent<T = unknown> {
    eventId: string
    projectId: string
    sequence: number
    createdAt: string
    payload: T
    status: TaricOutboxEventStatus
    result?: unknown
    conflict?: string
    indeterminate?: string
    readSeq?: number
    replayedAt?: string
    attempts?: number
    lastError?: string
}

export interface TaricOutboxReplayResponse<TResult = unknown> {
    result: TResult
    /** The authority read watermark confirmed by the successful request. */
    readSeq: number
}

export interface TaricOutboxReplayOptions<TPayload = unknown, TResult = unknown> {
    projectId?: string
    apply: (event: TaricOutboxEvent<TPayload>) => Promise<TaricOutboxReplayResponse<TResult>>
    isConflict?: (error: unknown) => boolean
}

export interface TaricOutboxReplayResult<TResult = unknown> {
    eventId: string
    status: "replayed" | "conflict" | "pending"
    result?: TResult
    conflict?: string
    readSeq?: number
}

export interface TaricOutboxReplaySummary<TResult = unknown> {
    replayed: number
    conflicts: number
    stopped: boolean
    watermark: number
    results: TaricOutboxReplayResult<TResult>[]
}

export type TaricSubscriptionRefreshReason = "signal" | "reconnect" | "slow_consumer" | "token_revoked" | "manual"

export interface TaricSubscriptionRefresh<TRecord = unknown> {
    projectId: string
    afterReadSeq: number
    reason: TaricSubscriptionRefreshReason
}

export interface TaricSubscriptionRefreshResponse<TRecord = unknown> {
    records: readonly TRecord[]
    /** The authority watermark after applying the returned authoritative delta. */
    readSeq: number
}

export interface TaricSubscriptionRecoveryOptions<TRecord = unknown> {
    projectId: string
    initialReadSeq?: number
    query: (request: TaricSubscriptionRefresh<TRecord>) => Promise<TaricSubscriptionRefreshResponse<TRecord>>
    apply?: (response: TaricSubscriptionRefreshResponse<TRecord>) => Promise<void> | void
}

export type TaricSubscriptionRecoveryState = "idle" | "refreshing" | "healthy" | "degraded" | "closed"

export interface TaricSubscriptionRecoverySnapshot {
    projectId: string
    state: TaricSubscriptionRecoveryState
    confirmedReadSeq: number
    lastRefreshAt?: string
    lastError?: string
}

export interface TaricOutboxOptions {
    path: string
    key?: Uint8Array
    maxBytes?: number
    maxEvents?: number
}

export class TaricOutboxError extends Error {
    readonly code: "TARIC_OUTBOX_KEY_UNAVAILABLE" | "TARIC_OUTBOX_FULL" | "TARIC_OUTBOX_CONFLICT"

    constructor(code: TaricOutboxError["code"], message: string) {
        super(message)
        this.name = "TaricOutboxError"
        this.code = code
    }
}

interface StoredRecord {
    type: "append" | "status"
    eventId: string
    keyVersion: 1
    nonce: string
    ciphertext: string
}

interface StoredStatus {
    status: TaricOutboxEventStatus
    result?: unknown
    conflict?: string
    readSeq?: number
    replayedAt?: string
    attempts?: number
    lastError?: string
    indeterminate?: string
}

function encode(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString("base64url")
}

function decode(value: string): Uint8Array {
    return new Uint8Array(Buffer.from(value, "base64url"))
}

function requireKey(key: Uint8Array | undefined): Uint8Array {
    if (!key || key.byteLength !== 32) throw new TaricOutboxError("TARIC_OUTBOX_KEY_UNAVAILABLE", "Taric outbox encryption key is unavailable")
    return key
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function encrypt(value: unknown, key: Uint8Array): Promise<{ nonce: string; ciphertext: string }> {
    const nonce = crypto.getRandomValues(new Uint8Array(12))
    const cryptoKey = await crypto.subtle.importKey("raw", asArrayBuffer(key), "AES-GCM", false, ["encrypt"])
    const plaintext = new TextEncoder().encode(JSON.stringify(value))
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: asArrayBuffer(nonce) }, cryptoKey, asArrayBuffer(plaintext)))
    return { nonce: encode(nonce), ciphertext: encode(ciphertext) }
}

async function decrypt(record: StoredRecord, key: Uint8Array): Promise<unknown> {
    const cryptoKey = await crypto.subtle.importKey("raw", asArrayBuffer(key), "AES-GCM", false, ["decrypt"])
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: asArrayBuffer(decode(record.nonce)) }, cryptoKey, asArrayBuffer(decode(record.ciphertext)))
    return JSON.parse(new TextDecoder().decode(plaintext)) as unknown
}

/** Encrypted JSONL transport buffer. Status changes append records and never rewrite history. */
export class EncryptedTaricOutbox {
    private readonly path: string
    private readonly key: Uint8Array | undefined
    private readonly maxBytes: number
    private readonly maxEvents: number
    private nextSequence = 1
    private appendQueue: Promise<void> = Promise.resolve()
    private replayQueue: Promise<void> = Promise.resolve()

    constructor(options: TaricOutboxOptions) {
        this.path = options.path
        this.key = options.key
        this.maxBytes = options.maxBytes ?? 10 * 1024 * 1024
        this.maxEvents = options.maxEvents ?? 10_000
        if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1) throw new Error("outbox maxBytes must be positive")
        if (!Number.isSafeInteger(this.maxEvents) || this.maxEvents < 1) throw new Error("outbox maxEvents must be positive")
    }

    async append<T>(input: { eventId: string; projectId: string; payload: T }): Promise<TaricOutboxEvent<T>> {
        return this.withAppendLock(async () => {
        const key = requireKey(this.key)
        const eventId = requiredText(input.eventId, "eventId")
        const projectId = requiredText(input.projectId, "projectId")
        const current = await this.list()
        if (current.some((event) => event.eventId === eventId)) {
            const existing = current.find((event) => event.eventId === eventId) as TaricOutboxEvent<T>
            if (existing.projectId !== projectId) throw new TaricOutboxError("TARIC_OUTBOX_CONFLICT", "eventId is already bound to another project")
            return existing
        }
        if (current.length >= this.maxEvents) throw new TaricOutboxError("TARIC_OUTBOX_FULL", "Taric outbox event limit reached")
        const event: TaricOutboxEvent<T> = {
            eventId,
            projectId,
            sequence: this.nextSequence++,
            createdAt: new Date().toISOString(),
            payload: input.payload,
            status: "pending",
        }
        const encrypted = await encrypt(event, key)
        const record: StoredRecord = { type: "append", eventId: event.eventId, keyVersion: 1, ...encrypted }
        const line = `${JSON.stringify(record)}\n`
        const file = Bun.file(this.path)
        const size = file.size
        if (size + Buffer.byteLength(line) > this.maxBytes) throw new TaricOutboxError("TARIC_OUTBOX_FULL", "Taric outbox byte limit reached")
        await mkdir(dirname(this.path), { recursive: true })
        await appendFile(this.path, line, { encoding: "utf8" })
        return event
        })
    }

    async list<T = unknown>(): Promise<TaricOutboxEvent<T>[]> {
        const key = requireKey(this.key)
        const file = Bun.file(this.path)
        if (!(await file.exists())) return []
        const records = (await file.text()).split("\n").filter(Boolean).map((line) => JSON.parse(line) as StoredRecord)
        const events = new Map<string, TaricOutboxEvent<T>>()
        for (const record of records) {
            if (record.keyVersion !== 1) throw new Error(`unsupported outbox key version: ${record.keyVersion}`)
            const value = (await decrypt(record, key)) as TaricOutboxEvent<T> | { status: TaricOutboxEventStatus; result?: unknown; conflict?: string }
            if (record.type === "append") events.set(record.eventId, value as TaricOutboxEvent<T>)
            else {
                const event = events.get(record.eventId)
                if (event) Object.assign(event, value)
            }
        }
        const result = [...events.values()].sort((a, b) => a.sequence - b.sequence)
        this.nextSequence = Math.max(this.nextSequence, ...result.map((item) => item.sequence + 1), 1)
        return result
    }

    async pending<T = unknown>(projectId?: string): Promise<TaricOutboxEvent<T>[]> {
        return (await this.list<T>()).filter((event) => event.status === "pending" && (!projectId || event.projectId === projectId))
    }

    async markReplayed(eventId: string, result?: unknown): Promise<void> {
        await this.appendStatus(eventId, { status: "replayed", result, replayedAt: new Date().toISOString() })
    }

    async markConflict(eventId: string, conflict: string): Promise<void> {
        await this.appendStatus(eventId, { status: "conflict", conflict })
        throw new TaricOutboxError("TARIC_OUTBOX_CONFLICT", conflict)
    }

    /** Preserve an ambiguous non-idempotent write for operator reconciliation. */
    async markIndeterminate(eventId: string, reason: string): Promise<void> {
        await this.appendStatus(eventId, { status: "indeterminate", indeterminate: reason.slice(0, 512), lastError: reason.slice(0, 512) })
    }

    /**
     * Replays pending events in sequence order. A conflict stops the queue so
     * later events cannot overtake a stale authority version. Already replayed
     * events are returned from the stored result without invoking `apply`.
     */
    async replayOrdered<TPayload = unknown, TResult = unknown>(options: TaricOutboxReplayOptions<TPayload, TResult>): Promise<TaricOutboxReplaySummary<TResult>> {
        const projectId = options.projectId?.trim()
        return this.withReplayLock(async () => {
            const events = await this.list<TPayload>()
            const matching = events.filter((event) => !projectId || event.projectId === projectId)
            const results: TaricOutboxReplayResult<TResult>[] = []
            let replayed = 0
            let conflicts = 0
            let stopped = false
            let watermark = matching.reduce((max, event) => Math.max(max, event.readSeq ?? 0), 0)
            for (const event of matching) {
                if (event.status === "replayed") {
                    results.push({ eventId: event.eventId, status: "replayed", result: event.result as TResult, ...(event.readSeq !== undefined ? { readSeq: event.readSeq } : {}) })
                    continue
                }
                if (event.status === "conflict") {
                    results.push({ eventId: event.eventId, status: "conflict", conflict: event.conflict ?? "outbox event is in conflict" })
                    conflicts += 1
                    stopped = true
                    break
                }
                if (event.status === "indeterminate") {
                    results.push({ eventId: event.eventId, status: "pending", conflict: event.indeterminate ?? "outbox event requires operator reconciliation" })
                    stopped = true
                    break
                }
                try {
                    const response = await options.apply(event)
                    validateReadSeq(response.readSeq)
                    if (response.readSeq < watermark) throw new Error("Taric replay read_seq moved backwards")
                    await this.appendStatus(event.eventId, {
                        status: "replayed",
                        result: response.result,
                        readSeq: response.readSeq,
                        replayedAt: new Date().toISOString(),
                    })
                    watermark = response.readSeq
                    replayed += 1
                    results.push({ eventId: event.eventId, status: "replayed", result: response.result, readSeq: response.readSeq })
                } catch (error) {
                    if (isOutboxConflict(error, options.isConflict)) {
                        const conflict = error instanceof Error ? error.message : String(error)
                        await this.appendStatus(event.eventId, { status: "conflict", conflict })
                        conflicts += 1
                        results.push({ eventId: event.eventId, status: "conflict", conflict })
                    } else {
                        results.push({ eventId: event.eventId, status: "pending", conflict: error instanceof Error ? error.message : String(error) })
                    }
                    stopped = true
                    break
                }
            }
            return {
                replayed,
                conflicts,
                stopped,
                watermark,
                results,
            }
        })
    }

    /** Return the greatest authority watermark confirmed for the project. */
    async confirmedReadSeq(projectId?: string): Promise<number> {
        const project = projectId?.trim()
        return (await this.list()).reduce((max, event) => {
            if (project && event.projectId !== project) return max
            return Math.max(max, event.readSeq ?? 0)
        }, 0)
    }

    private async appendStatus(eventId: string, status: StoredStatus): Promise<void> {
        await this.withAppendLock(async () => {
        const key = requireKey(this.key)
        const events = await this.list()
        if (!events.some((event) => event.eventId === eventId)) throw new Error(`outbox event "${eventId}" not found`)
        const encrypted = await encrypt(status, key)
        const record: StoredRecord = { type: "status", eventId, keyVersion: 1, ...encrypted }
        const line = `${JSON.stringify(record)}\n`
        const file = Bun.file(this.path)
        if (file.size + Buffer.byteLength(line) > this.maxBytes) throw new TaricOutboxError("TARIC_OUTBOX_FULL", "Taric outbox byte limit reached")
        await appendFile(this.path, line, { encoding: "utf8" })
        })
    }

    private async withAppendLock<T>(action: () => Promise<T>): Promise<T> {
        const previous = this.appendQueue
        let release = () => {}
        this.appendQueue = new Promise<void>((resolve) => {
            release = resolve
        })
        await previous
        try {
            return await action()
        } finally {
            release()
        }
    }

    private async withReplayLock<T>(action: () => Promise<T>): Promise<T> {
        const previous = this.replayQueue
        let release = () => {}
        this.replayQueue = new Promise<void>((resolve) => {
            release = resolve
        })
        await previous
        try {
            return await action()
        } finally {
            release()
        }
    }
}

/**
 * Subscription notifications are hints. This helper always queries the
 * authority from the last confirmed watermark and coalesces signals received
 * while a recovery query is in flight.
 */
export class TaricSubscriptionRecovery<TRecord = unknown> {
    private readonly options: TaricSubscriptionRecoveryOptions<TRecord>
    private stateValue: TaricSubscriptionRecoveryState = "idle"
    private confirmedReadSeqValue: number
    private lastRefreshAtValue: string | undefined
    private lastErrorValue: string | undefined
    private refreshAgain = false
    private nextReason: TaricSubscriptionRefreshReason = "signal"
    private refreshPromise: Promise<TaricSubscriptionRefreshResponse<TRecord>> | undefined

    constructor(options: TaricSubscriptionRecoveryOptions<TRecord>) {
        const projectId = requiredText(options.projectId, "projectId")
        const initialReadSeq = options.initialReadSeq ?? 0
        validateReadSeq(initialReadSeq)
        this.options = { ...options, projectId }
        this.confirmedReadSeqValue = initialReadSeq
    }

    snapshot(): TaricSubscriptionRecoverySnapshot {
        return {
            projectId: this.options.projectId,
            state: this.stateValue,
            confirmedReadSeq: this.confirmedReadSeqValue,
            ...(this.lastRefreshAtValue ? { lastRefreshAt: this.lastRefreshAtValue } : {}),
            ...(this.lastErrorValue ? { lastError: this.lastErrorValue } : {}),
        }
    }

    get confirmedReadSeq(): number {
        return this.confirmedReadSeqValue
    }

    /** Request an authoritative refresh. Duplicate signals are safe. */
    notify(reason: TaricSubscriptionRefreshReason = "signal"): Promise<TaricSubscriptionRefreshResponse<TRecord>> {
        if (this.stateValue === "closed") return Promise.reject(new Error("Taric subscription recovery is closed"))
        if (this.refreshPromise) {
            this.refreshAgain = true
            this.nextReason = reason
            return this.refreshPromise
        }
        this.nextReason = reason
        this.refreshPromise = this.drain(reason)
        return this.refreshPromise
    }

    async close(): Promise<void> {
        this.stateValue = "closed"
        this.refreshAgain = false
        await this.refreshPromise?.catch(() => {})
    }

    private async drain(reason: TaricSubscriptionRefreshReason): Promise<TaricSubscriptionRefreshResponse<TRecord>> {
        this.stateValue = "refreshing"
        let latest: TaricSubscriptionRefreshResponse<TRecord> | undefined
        try {
            do {
                this.refreshAgain = false
                const request: TaricSubscriptionRefresh<TRecord> = {
                    projectId: this.options.projectId,
                    afterReadSeq: this.confirmedReadSeqValue,
                    reason: this.nextReason,
                }
                const response = await this.options.query(request)
                if ((this.stateValue as TaricSubscriptionRecoveryState) === "closed") {
                    latest = response
                    break
                }
                validateReadSeq(response.readSeq)
                if (!Array.isArray(response.records)) throw new Error("Taric subscription query must return records")
                if (response.readSeq < this.confirmedReadSeqValue) throw new Error("Taric subscription read_seq moved backwards")
                await this.options.apply?.(response)
                this.confirmedReadSeqValue = response.readSeq
                this.lastRefreshAtValue = new Date().toISOString()
                this.lastErrorValue = undefined
                this.stateValue = "healthy"
                latest = response
                reason = this.nextReason
            } while (this.refreshAgain)
            if (!latest) throw new Error("Taric subscription recovery closed before a refresh completed")
            return latest
        } catch (error) {
            this.stateValue = "degraded"
            this.lastErrorValue = error instanceof Error ? error.message : String(error)
            throw error
        } finally {
            this.refreshPromise = undefined
        }
    }
}

export const TaricOutbox = EncryptedTaricOutbox

function requiredText(value: string, field: string): string {
    const text = value.trim()
    if (!text) throw new Error(`${field} is required`)
    return text
}

function validateReadSeq(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("readSeq must be a non-negative safe integer")
}

function isOutboxConflict(error: unknown, predicate?: (error: unknown) => boolean): boolean {
    if (predicate) return predicate(error)
    if (error instanceof TaricOutboxError && error.code === "TARIC_OUTBOX_CONFLICT") return true
    if (!error || typeof error !== "object") return false
    const code = (error as { code?: unknown }).code
    return code === "conflict" || code === "idempotency_conflict" || code === "stale_version"
}
