import type { TaricCheckpointProposalInput, TaricHostModule, TaricHostObservationInput } from "../taric"
import { TaricOperationError, TaricUnavailableError } from "../taric"
import type { EncryptedTaricOutbox } from "../taric"
import { deriveCompositeProjectKey } from "../project/types"
import type { TaricHostBinding } from "../taric"
import type { ChallengeMemoryProvider, ChallengeMemoryReadDiagnostics, ChallengeMemoryReadResult, ChallengeMemoryScope } from "./memory-provider"
import type { AddIdeaInput, AddIdeaResult, AddMemoryInput, IdeaRecord, MemoryEntry, UpdateIdeaInput } from "./memory"

interface TaricRecord {
    id?: unknown
    kind?: unknown
    engagement_id?: unknown
    title?: unknown
    proposition?: unknown
    content?: unknown
    evidence_refs?: unknown
    created_at?: unknown
    updated_at?: unknown
    status?: unknown
    result?: unknown
    normalized?: unknown
    subject_type?: unknown
    artifact_refs?: unknown
}

interface ProposalPayload {
    subjectType: "claim"
    content: Record<string, unknown>
}

export interface TaricMemoryProviderOptions {
    host: TaricHostModule
    mode: "taric_best_effort" | "taric_required"
    outbox?: EncryptedTaricOutbox
    readLimits?: Partial<TaricReadLimits>
}

export interface TaricReadLimits {
    maxPages: number
    maxRecords: number
    maxBytes: number
    maxCursorChars: number
    requestTimeoutMs: number
    deadlineMs: number
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const QUERY_PAGE_SIZE = 50
const MAX_QUERY_CURSOR_CHARS = 512
const DEFAULT_READ_LIMITS: TaricReadLimits = {
    maxPages: 24,
    maxRecords: 1000,
    maxBytes: 4 * 1024 * 1024,
    maxCursorChars: MAX_QUERY_CURSOR_CHARS,
    requestTimeoutMs: 10_000,
    deadlineMs: 30_000,
}

export type TaricReadTruncationReason = "max_pages" | "max_records" | "max_bytes"

export interface TaricReadSourceDiagnostics {
    status: "in_progress" | "complete" | "truncated" | "failed"
    pages: number
    records: number
    duplicatesSuppressed: number
    bytes: number
    hasMore: boolean
    readSeq?: number
    lastCursor?: string
    nextCursor?: string
    continuationSafe: boolean
    truncationReason?: TaricReadTruncationReason
    errorCode?: string
}

export interface TaricMemoryReadDiagnostics extends ChallengeMemoryReadDiagnostics {
    generatedAt: string
    source: "taric_authority"
    watermark?: number
    canonical: TaricReadSourceDiagnostics
    candidates: TaricReadSourceDiagnostics
    limits: TaricReadLimits
    totals: TaricReadTotals
}

export interface TaricReadTotals {
    pages: number
    records: number
    duplicatesSuppressed: number
    bytes: number
}

interface TaricQueryPage {
    records: TaricRecord[]
    readSeq: number
    nextCursor?: string
}

function nowIso(): string {
    return new Date().toISOString()
}

function text(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
        : []
}

function recordReferences(record: TaricRecord): string[] {
    return [...new Set([...stringArray(record.evidence_refs), ...stringArray(record.artifact_refs)])]
}

function responseData(value: unknown): unknown {
    if (!value || typeof value !== "object") return value
    const object = value as Record<string, unknown>
    return object.data ?? value
}

function queryPageFrom(value: unknown, key: "records" | "proposals", operation: "resource.query" | "proposal.list", maxCursorChars: number): TaricQueryPage {
    const data = responseData(value)
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new TaricOperationError("validation_error", `Taric ${operation} returned an invalid page`)
    }
    const object = data as Record<string, unknown>
    const rawRecords = object[key]
    if (!Array.isArray(rawRecords) || rawRecords.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
        throw new TaricOperationError("validation_error", `Taric ${operation} returned an invalid ${key} page`)
    }
    if (rawRecords.some((item) => {
        const id = (item as Record<string, unknown>).id
        return typeof id !== "string" || id.trim().length === 0
    })) {
        throw new TaricOperationError("validation_error", `Taric ${operation} returned a record without an id`)
    }
    const readSeq = object.read_seq
    if (!Number.isSafeInteger(readSeq) || Number(readSeq) < 0) {
        throw new TaricOperationError("validation_error", `Taric ${operation} returned an invalid read_seq`)
    }
    const nextCursor = object.next_cursor
    if (nextCursor !== undefined && (typeof nextCursor !== "string" || nextCursor.length === 0 || nextCursor.length > maxCursorChars)) {
        throw new TaricOperationError("invalid_cursor", `Taric ${operation} returned an invalid continuation cursor`)
    }
    return { records: rawRecords as TaricRecord[], readSeq: Number(readSeq), ...(nextCursor === undefined ? {} : { nextCursor }) }
}

function recordIdentity(record: TaricRecord): string {
    return `id:${record.id as string}`
}

function serializedBytes(value: unknown): number {
    const json = JSON.stringify(value)
    if (json === undefined) throw new TaricOperationError("validation_error", "Taric query returned a non-serializable record")
    return new TextEncoder().encode(json).byteLength
}

function createSourceDiagnostics(): TaricReadSourceDiagnostics {
    return {
        status: "in_progress",
        pages: 0,
        records: 0,
        duplicatesSuppressed: 0,
        bytes: 0,
        hasMore: false,
        continuationSafe: false,
    }
}

function readErrorCode(error: unknown): string {
    if (error instanceof TaricOperationError) return error.code
    if (error instanceof TaricUnavailableError) return error.code
    return "query_failed"
}

function splitReadLimits(total: TaricReadLimits): { canonical: TaricReadLimits; candidates: TaricReadLimits } {
    const split = (value: number) => [Math.ceil(value / 2), Math.floor(value / 2)] as const
    const [canonicalPages, candidatePages] = split(total.maxPages)
    const [canonicalRecords, candidateRecords] = split(total.maxRecords)
    const [canonicalBytes, candidateBytes] = split(total.maxBytes)
    return {
        canonical: { ...total, maxPages: canonicalPages, maxRecords: canonicalRecords, maxBytes: canonicalBytes },
        candidates: { ...total, maxPages: candidatePages, maxRecords: candidateRecords, maxBytes: candidateBytes },
    }
}

function recordText(record: TaricRecord): string {
    return text(record.proposition, text(record.content, ""))
}

function isIdea(record: TaricRecord): boolean {
    return typeof record.title === "string" && record.title.includes("] idea: ")
}

function isProjectRecord(scope: ChallengeMemoryScope, record: TaricRecord): boolean {
    return typeof record.title === "string" && record.title.startsWith(`BreachWeave [${scope.projectKey}] `)
}

function isBoundProjectRecord(scope: ChallengeMemoryScope, binding: TaricHostBinding, record: TaricRecord): boolean {
    if (typeof record.engagement_id === "string" && record.engagement_id !== binding.engagementId) return false
    return isProjectRecord(scope, record)
}

function memoryTitle(scope: ChallengeMemoryScope, kind: AddMemoryInput["kind"], source: string): string {
    return `BreachWeave [${scope.projectKey}] memory (${kind}): ${source}`
}

function ideaTitle(scope: ChallengeMemoryScope, content: string): string {
    return `BreachWeave [${scope.projectKey}] idea: ${content.slice(0, 120)}`
}

function toMemory(scope: ChallengeMemoryScope, record: TaricRecord, trustState: "candidate" | "admitted"): MemoryEntry {
    const timestamp = text(record.updated_at, text(record.created_at, nowIso()))
    const title = text(record.title, "")
    const kindMatch = /\] memory \((fact|evidence|failure|note|hint)\): /.exec(title)
    return {
        id: text(record.id, `taric_mem_${crypto.randomUUID().slice(0, 8)}`),
        challengeId: scope.challengeId,
        kind: (kindMatch?.[1] ?? "fact") as MemoryEntry["kind"],
        content: recordText(record),
        refs: recordReferences(record),
        source: `taric:${trustState}`,
        trustState,
        created_at: text(record.created_at, timestamp),
        updated_at: timestamp,
    }
}

function toIdea(record: TaricRecord, trustState: "candidate" | "admitted"): IdeaRecord {
    const content = recordText(record)
    const timestamp = text(record.updated_at, text(record.created_at, nowIso()))
    return {
        id: text(record.id, `taric_idea_${crypto.randomUUID().slice(0, 8)}`),
        content,
        normalized: content.trim().toLowerCase(),
        status: "pending",
        result: text(record.result, ""),
        trustState,
        created_at: text(record.created_at, timestamp),
        updated_at: timestamp,
    }
}

function requireScope(scope: ChallengeMemoryScope, binding: TaricHostBinding): void {
    if (!scope.project || !scope.projectKey) throw new Error("Taric memory requires a validated composite project scope")
    const derivedProjectId = deriveCompositeProjectKey(scope.project)
    if (scope.projectKey !== derivedProjectId || scope.projectKey !== binding.projectId) {
        throw new Error("Taric memory scope does not match the host-bound project")
    }
    if (scope.project.tenant_id !== binding.tenantId || scope.project.taric_engagement_id !== binding.engagementId) {
        throw new Error("Taric project tenant or Engagement does not match the host binding")
    }
}

function requireTaricReferences(refs: string[] | undefined): string[] {
    const values = [...new Set((refs ?? []).map((value) => value.trim()).filter(Boolean))]
    if (values.some((value) => !UUID_PATTERN.test(value))) {
        throw new Error("Taric memory refs must be UUID references to records in the bound Engagement")
    }
    return values
}

function createClaim(scope: ChallengeMemoryScope, engagementId: string, proposition: string, title: string, evidenceRefs: string[] = []): Record<string, unknown> {
    return {
        schema_version: "1.0.0",
        engagement_id: engagementId,
        created_at: nowIso(),
        kind: "claim",
        title,
        proposition,
        status: "proposed",
        evidence_refs: evidenceRefs,
        limitations: ["BreachWeave model or operator proposal; not an admitted fact."],
    }
}

function isConflict(error: unknown): boolean {
    return error instanceof TaricOperationError && ["conflict", "idempotency_conflict", "stale_version"].includes(error.code)
}

function isUnavailable(error: unknown): boolean {
    return error instanceof TaricUnavailableError || (error instanceof TaricOperationError && error.code === "unavailable_host")
}

export class TaricMemoryProvider implements ChallengeMemoryProvider {
    readonly mode: "taric_best_effort" | "taric_required"
    private readonly host: TaricHostModule
    private readonly outbox?: EncryptedTaricOutbox
    private readonly readLimits: TaricReadLimits
    private readDiagnosticsValue: Omit<TaricMemoryReadDiagnostics, "limits" | "totals"> | undefined

    constructor(options: TaricMemoryProviderOptions) {
        this.mode = options.mode
        this.host = options.host
        this.outbox = options.outbox
        this.readLimits = {
            ...DEFAULT_READ_LIMITS,
            ...(options.readLimits ?? {}),
        }
        if (!Number.isSafeInteger(this.readLimits.maxPages) || this.readLimits.maxPages < 2 || this.readLimits.maxPages > DEFAULT_READ_LIMITS.maxPages) {
            throw new Error(`Taric total read maxPages must be between 2 and ${DEFAULT_READ_LIMITS.maxPages}`)
        }
        if (!Number.isSafeInteger(this.readLimits.maxRecords) || this.readLimits.maxRecords < 2 || this.readLimits.maxRecords > DEFAULT_READ_LIMITS.maxRecords) {
            throw new Error(`Taric total read maxRecords must be between 2 and ${DEFAULT_READ_LIMITS.maxRecords}`)
        }
        if (!Number.isSafeInteger(this.readLimits.maxBytes) || this.readLimits.maxBytes < 2 || this.readLimits.maxBytes > DEFAULT_READ_LIMITS.maxBytes) {
            throw new Error(`Taric total read maxBytes must be between 2 and ${DEFAULT_READ_LIMITS.maxBytes}`)
        }
        if (!Number.isSafeInteger(this.readLimits.maxCursorChars) || this.readLimits.maxCursorChars < 1 || this.readLimits.maxCursorChars > MAX_QUERY_CURSOR_CHARS) {
            throw new Error(`Taric read maxCursorChars must be between 1 and ${MAX_QUERY_CURSOR_CHARS}`)
        }
        if (!Number.isSafeInteger(this.readLimits.requestTimeoutMs) || this.readLimits.requestTimeoutMs < 100 || this.readLimits.requestTimeoutMs > DEFAULT_READ_LIMITS.requestTimeoutMs) {
            throw new Error(`Taric read requestTimeoutMs must be between 100 and ${DEFAULT_READ_LIMITS.requestTimeoutMs}`)
        }
        if (!Number.isSafeInteger(this.readLimits.deadlineMs) || this.readLimits.deadlineMs < 100 || this.readLimits.deadlineMs > DEFAULT_READ_LIMITS.deadlineMs) {
            throw new Error(`Taric read deadlineMs must be between 100 and ${DEFAULT_READ_LIMITS.deadlineMs}`)
        }
    }

    getReadDiagnostics(): TaricMemoryReadDiagnostics | undefined {
        const diagnostics = this.readDiagnosticsValue
        if (!diagnostics) return undefined
        return {
            ...diagnostics,
            canonical: { ...diagnostics.canonical },
            candidates: { ...diagnostics.candidates },
            limits: { ...this.readLimits },
            totals: {
                pages: diagnostics.canonical.pages + diagnostics.candidates.pages,
                records: diagnostics.canonical.records + diagnostics.candidates.records,
                duplicatesSuppressed: diagnostics.canonical.duplicatesSuppressed + diagnostics.candidates.duplicatesSuppressed,
                bytes: diagnostics.canonical.bytes + diagnostics.candidates.bytes,
            },
        }
    }

    async assertAvailable(scope: ChallengeMemoryScope): Promise<void> {
        requireScope(scope, this.host.getBinding())
        await this.host.initialize()
        this.host.assertAvailable()
    }

    async getHealth(): Promise<ReturnType<TaricHostModule["health"]>> {
        // Health must reflect the live adapter, so probe it instead of returning
        // the pre-initialization snapshot.
        await this.host.initialize()
        return this.host.health()
    }

    async listMemory(scope: ChallengeMemoryScope): Promise<MemoryEntry[]> {
        requireScope(scope, this.host.getBinding())
        return (await this.readBoard(scope)).memory
    }

    async appendMemory(scope: ChallengeMemoryScope, input: Omit<AddMemoryInput, "challengeId">): Promise<MemoryEntry> {
        requireScope(scope, this.host.getBinding())
        await this.replayOutbox()
        const content = input.content.trim()
        if (!content) throw new Error("content is required")
        const evidenceRefs = requireTaricReferences(input.refs)
        const eventId = crypto.randomUUID()
        const proposal: ProposalPayload = {
            subjectType: "claim",
            content: createClaim(scope, this.host.getBinding().engagementId, content, memoryTitle(scope, input.kind, input.source.trim() || "unspecified"), evidenceRefs),
        }
        const result = await this.submitOrQueue(scope, eventId, proposal)
        const record = responseRecord(result)
        return toMemory(scope, { ...record, ...proposal.content, id: record.id ?? eventId, status: "proposed" }, "candidate")
    }

    async updateMemory(): Promise<MemoryEntry> {
        throw new Error("Taric memory update is proposal-only; append a correction proposal")
    }

    async deleteMemory(): Promise<MemoryEntry> {
        throw new Error("Taric memory deletion is unsupported; use an operator retention workflow")
    }

    async listIdeas(scope: ChallengeMemoryScope): Promise<IdeaRecord[]> {
        requireScope(scope, this.host.getBinding())
        return (await this.readBoard(scope)).ideas
    }

    async readBoard(scope: ChallengeMemoryScope): Promise<ChallengeMemoryReadResult> {
        requireScope(scope, this.host.getBinding())
        await this.replayOutbox()
        const { canonical, proposals } = await this.queryProjectClaims()
        const memory = [
            ...canonical.filter((record) => isBoundProjectRecord(scope, this.host.getBinding(), record) && !isIdea(record)).map((record) => toMemory(scope, record, "admitted")),
            ...proposals.filter((record) => isBoundProjectRecord(scope, this.host.getBinding(), record) && !isIdea(record)).map((record) => toMemory(scope, record, "candidate")),
        ].filter((record) => record.content.length > 0)
        const ideas = [
            ...canonical.filter((record) => isBoundProjectRecord(scope, this.host.getBinding(), record) && isIdea(record)).map((record) => toIdea(record, "admitted")),
            ...proposals.filter((record) => isBoundProjectRecord(scope, this.host.getBinding(), record) && isIdea(record)).map((record) => toIdea(record, "candidate")),
        ]
        return { memory, ideas, diagnostics: this.getReadDiagnostics() }
    }

    async searchIdeas(scope: ChallengeMemoryScope, query: string): Promise<IdeaRecord[]> {
        const ideas = await this.listIdeas(scope)
        const normalized = query.trim().toLowerCase()
        if (!normalized) return ideas
        return ideas.filter((idea) => idea.content.toLowerCase().includes(normalized) || idea.result.toLowerCase().includes(normalized))
    }

    async addIdea(scope: ChallengeMemoryScope, input: AddIdeaInput): Promise<AddIdeaResult> {
        requireScope(scope, this.host.getBinding())
        await this.replayOutbox()
        const content = input.content.trim()
        if (!content) throw new Error("content is required")
        const existing = (await this.listIdeas(scope)).find((idea) => idea.normalized === content.toLowerCase())
        if (existing) return { created: false, item: existing }
        const eventId = crypto.randomUUID()
        const proposal: ProposalPayload = {
            subjectType: "claim",
            content: createClaim(scope, this.host.getBinding().engagementId, content, ideaTitle(scope, content)),
        }
        const result = await this.submitOrQueue(scope, eventId, proposal)
        return {
            created: true,
            item: toIdea({ ...responseRecord(result), ...proposal.content, id: responseRecord(result).id ?? eventId }, "candidate"),
        }
    }

    async updateIdea(_scope: ChallengeMemoryScope, _ideaIdOrPrefix: string, _patch: UpdateIdeaInput): Promise<IdeaRecord> {
        throw new Error("Taric ideas are proposal-only; submit a replacement proposal")
    }

    async deleteIdea(): Promise<IdeaRecord> {
        throw new Error("Taric idea deletion is unsupported; use an operator retention workflow")
    }

    async captureObservation(scope: ChallengeMemoryScope, input: TaricHostObservationInput): Promise<unknown> {
        requireScope(scope, this.host.getBinding())
        if (this.outbox) {
            const previous = (await this.outbox.list<{ operation?: string }>()).find((event) => event.projectId === scope.projectKey && event.eventId === input.eventId && event.payload?.operation === "capture.observation")
            if (previous && (previous.status === "indeterminate" || previous.status === "conflict")) return { outcome: "indeterminate", eventId: previous.eventId }
            if (previous?.status === "pending") return { outcome: "deferred", eventId: previous.eventId }
        }
        try {
            await this.host.initialize()
            return await this.host.captureObservation(input)
        } catch (error) {
            if (this.mode !== "taric_best_effort" || !this.outbox || !isUnavailable(error)) throw error
            const event = await this.outbox.append({ eventId: input.eventId, projectId: scope.projectKey ?? "", payload: { operation: "capture.observation", input } })
            if (error instanceof TaricUnavailableError && error.dispatchState === "after_dispatch") {
                await this.outbox.markIndeterminate(event.eventId, "capture.observation commit status is unknown; reconcile against the authoritative Resource before retry")
                return { outcome: "indeterminate", eventId: event.eventId }
            }
            return { outcome: "deferred", eventId: event.eventId }
        }
    }

    async proposeCheckpoint(scope: ChallengeMemoryScope, input: TaricCheckpointProposalInput): Promise<unknown> {
        requireScope(scope, this.host.getBinding())
        await this.host.initialize()
        return this.host.proposeCheckpoint(input)
    }

    async replayOutbox(): Promise<{ replayed: number; conflicts: number }> {
        if (!this.outbox) return { replayed: 0, conflicts: 0 }
        const binding = this.host.getBinding()
        if ((await this.host.refreshHealth()).status !== "healthy") return { replayed: 0, conflicts: 0 }
        // capture.observation is explicitly non-idempotent in Taric's registry.
        // Without a durable absence/reconciliation query, a deferred capture is
        // preserved for an operator and never replayed automatically.
        for (const event of await this.outbox.pending<{ operation?: string }>(binding.projectId)) {
            if (event.payload?.operation === "capture.observation") {
                await this.outbox.markIndeterminate(event.eventId, "capture.observation requires operator reconciliation before replay")
            }
        }
        const summary = await this.outbox.replayOrdered<ProposalPayload, unknown>({
            projectId: binding.projectId,
            apply: async (event) => {
                const payload = event.payload
                const result = await this.host.submitProposal({
                    eventId: event.eventId,
                    subjectType: payload.subjectType,
                    expectedVersion: 0,
                    content: payload.content,
                })
                const data = responseData(result)
                const readSeq = data && typeof data === "object" && typeof (data as Record<string, unknown>).read_seq === "number"
                    ? (data as Record<string, unknown>).read_seq as number
                    : Math.max(event.sequence, await this.outbox!.confirmedReadSeq(binding.projectId))
                return { result, readSeq }
            },
            isConflict,
        })
        return { replayed: summary.replayed, conflicts: summary.conflicts }
    }

    private async queryProjectClaims(): Promise<{ canonical: TaricRecord[]; proposals: TaricRecord[] }> {
        const diagnostics: Omit<TaricMemoryReadDiagnostics, "limits" | "totals"> = {
            generatedAt: nowIso(),
            source: "taric_authority",
            status: "in_progress",
            canonical: createSourceDiagnostics(),
            candidates: createSourceDiagnostics(),
        }
        this.readDiagnosticsValue = diagnostics
        try {
            const limits = splitReadLimits(this.readLimits)
            const deadlineAt = Date.now() + this.readLimits.deadlineMs
            const proposalPage = await this.queryPages("proposal.list", "proposals", {}, diagnostics.candidates, limits.candidates, undefined, deadlineAt)
            diagnostics.watermark = proposalPage.readSeq
            const canonicalPage = await this.queryPages(
                "resource.query",
                "records",
                { kind: "claim", as_of: diagnostics.watermark },
                diagnostics.canonical,
                limits.canonical,
                diagnostics.watermark,
                deadlineAt,
            )
            if (canonicalPage.readSeq !== diagnostics.watermark) {
                throw new TaricOperationError("conflict", "Taric combined memory read returned inconsistent read_seq values")
            }
            const canonical = canonicalPage.records
            const proposalRecords = proposalPage.records
            const proposals = proposalRecords.filter((record) => record.subject_type === "claim" && record.content && typeof record.content === "object")
                .map((record) => ({ ...(record.content as Record<string, unknown>), id: record.id, status: record.status, created_at: record.created_at, updated_at: record.updated_at, engagement_id: record.engagement_id ?? (record.content as Record<string, unknown>).engagement_id }))
            diagnostics.status = diagnostics.canonical.status === "truncated" || diagnostics.candidates.status === "truncated"
                ? "truncated"
                : "complete"
            return { canonical, proposals }
        } catch (error) {
            diagnostics.watermark ??= diagnostics.candidates.readSeq
            diagnostics.status = "failed"
            throw error
        }
    }

    private async withReadTimeout<T>(work: () => Promise<T>, deadlineAt: number, operation: string): Promise<T> {
        const remainingMs = deadlineAt - Date.now()
        if (remainingMs <= 0) throw new TaricOperationError("timeout", `Taric ${operation} read deadline exceeded`)
        const timeoutMs = Math.min(this.readLimits.requestTimeoutMs, remainingMs)
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
            return await Promise.race([
                work(),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new TaricOperationError("timeout", `Taric ${operation} read timed out`)), timeoutMs)
                }),
            ])
        } finally {
            if (timer) clearTimeout(timer)
        }
    }

    private async queryPages(
        operation: "resource.query" | "proposal.list",
        resultKey: "records" | "proposals",
        filters: Record<string, unknown>,
        diagnostics: TaricReadSourceDiagnostics,
        limits: TaricReadLimits,
        expectedReadSeq?: number,
        deadlineAt = Date.now() + this.readLimits.deadlineMs,
    ): Promise<{ records: TaricRecord[]; readSeq: number }> {
        const records: TaricRecord[] = []
        const seenRecords = new Set<string>()
        const seenCursors = new Set<string>()
        let cursor: string | undefined
        let readSeq: number | undefined

        try {
            await this.withReadTimeout(() => this.host.initialize(), deadlineAt, operation)
            while (diagnostics.pages < limits.maxPages) {
                diagnostics.lastCursor = cursor
                const input = {
                    ...filters,
                    page_size: QUERY_PAGE_SIZE,
                    ...(cursor ? { cursor } : {}),
                }
                const result = await this.withReadTimeout(
                    () => operation === "proposal.list"
                        ? this.host.invokeHost("proposal.list", input)
                        : this.host.query(operation, input),
                    deadlineAt,
                    operation,
                )
                diagnostics.pages += 1
                const page = queryPageFrom(result, resultKey, operation, this.readLimits.maxCursorChars)
                if (readSeq === undefined) {
                    readSeq = page.readSeq
                    diagnostics.readSeq = page.readSeq
                }
                if (page.readSeq !== readSeq || (expectedReadSeq !== undefined && page.readSeq !== expectedReadSeq)) {
                    throw new TaricOperationError("conflict", `Taric ${operation} pagination changed read_seq`)
                }
                diagnostics.nextCursor = page.nextCursor
                diagnostics.continuationSafe = false
                let unconsumed = false
                for (const record of page.records) {
                    const identity = recordIdentity(record)
                    if (seenRecords.has(identity)) {
                        diagnostics.duplicatesSuppressed += 1
                        continue
                    }
                    if (diagnostics.records >= limits.maxRecords) {
                        unconsumed = true
                        break
                    }
                    const bytes = serializedBytes(record)
                    if (diagnostics.bytes + bytes > limits.maxBytes) {
                        diagnostics.hasMore = true
                        diagnostics.status = "truncated"
                        diagnostics.truncationReason = "max_bytes"
                        return { records, readSeq }
                    }
                    seenRecords.add(identity)
                    records.push(record)
                    diagnostics.records += 1
                    diagnostics.bytes += bytes
                }

                if (unconsumed || (page.nextCursor && diagnostics.records >= limits.maxRecords)) {
                    diagnostics.hasMore = true
                    diagnostics.status = "truncated"
                    diagnostics.truncationReason = "max_records"
                    diagnostics.continuationSafe = !unconsumed
                    return { records, readSeq }
                }
                if (!page.nextCursor) {
                    diagnostics.status = "complete"
                    diagnostics.hasMore = false
                    diagnostics.continuationSafe = true
                    return { records, readSeq }
                }
                if (page.nextCursor === cursor || seenCursors.has(page.nextCursor)) {
                    throw new TaricOperationError("invalid_cursor", `Taric ${operation} repeated a continuation cursor`)
                }
                seenCursors.add(page.nextCursor)
                cursor = page.nextCursor
                diagnostics.hasMore = true
                diagnostics.continuationSafe = true
            }

            diagnostics.status = "truncated"
            diagnostics.truncationReason = "max_pages"
            diagnostics.hasMore = true
            return { records, readSeq: readSeq as number }
        } catch (error) {
            diagnostics.status = "failed"
            diagnostics.errorCode = readErrorCode(error)
            throw error
        }
    }

    private async submitOrQueue(scope: ChallengeMemoryScope, eventId: string, proposal: ProposalPayload): Promise<unknown> {
        try {
            await this.host.initialize()
            return await this.host.submitProposal({ eventId, subjectType: proposal.subjectType, expectedVersion: 0, content: proposal.content })
        } catch (error) {
            if (this.mode === "taric_best_effort" && this.outbox && isUnavailable(error)) {
                await this.outbox.append({ eventId, projectId: scope.projectKey ?? "", payload: proposal })
                return undefined
            }
            throw error
        }
    }
}

function responseRecord(value: unknown): TaricRecord {
    const data = responseData(value)
    return data && typeof data === "object" ? data as TaricRecord : {}
}
