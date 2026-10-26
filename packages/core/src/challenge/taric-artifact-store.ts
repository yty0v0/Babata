import { appendFile, mkdir, readdir, rename, rm } from "fs/promises"
import { dirname, join, resolve } from "path"
import { TCH_AGENT_HOME_DIR } from "../config/index"
import { HostBridgeError } from "./host-bridge-types"

export type TaricArtifactStatus = "open" | "committed" | "failed" | "expired"

export interface TaricArtifactAcl {
    read: boolean
}

export interface TaricArtifactRecord {
    artifact_id: string
    engagement_id: string
    /** Attempt that produced this artifact, used to scope checkpoint evidence. */
    attempt_id?: string
    work_run_id?: string
    content_ref: string
    expected_hash?: string
    hash?: string
    ordinal: number
    total_bytes: number
    expected_total_bytes?: number
    status: TaricArtifactStatus
    acl: TaricArtifactAcl
    retention_days: number
    last_error?: string
    created_at: string
    updated_at: string
}

export interface TaricArtifactStoreOptions {
    rootDir?: string
    maxInlineBytes?: number
    retentionDays?: number
    redactText?: boolean
    backupDir?: string
}

const DEFAULT_TARIC_ARTIFACT_DIR = resolve(TCH_AGENT_HOME_DIR, "taric-artifacts")
const DEFAULT_MAX_INLINE_BYTES = 64 * 1024
const DEFAULT_MAX_READ_BYTES = 1024 * 1024

function nowIso(): string {
    return new Date().toISOString()
}

function requireText(value: string | undefined, field: string): string {
    const text = value?.trim()
    if (!text) throw new HostBridgeError("validation_error", `${field} is required`)
    return text
}

function requireSafeId(value: string): string {
    const id = requireText(value, "artifact_id")
    if (id.includes("/") || id.includes("\\") || id === "." || id === "..") {
        throw new HostBridgeError("validation_error", "artifact_id is invalid")
    }
    return id
}

function digestBytes(bytes: Uint8Array): string {
    const hash = new Bun.CryptoHasher("sha256")
    hash.update(bytes)
    return `sha256:${hash.digest("hex")}`
}

export function redactTaricArtifactText(value: string): string {
    return value
        .replace(/\bBearer\s+[A-Za-z0-9._-]+/g, "Bearer <redacted>")
        .replace(/(authorization\s*[:=]\s*)([^\s,;]+)/gi, "$1<redacted>")
        .replace(/(cookie\s*[:=]\s*)([^\r\n]+)/gi, "$1<redacted>")
        .replace(/(set-cookie\s*[:=]\s*)([^\r\n]+)/gi, "$1<redacted>")
        .replace(/(api[_-]?key\s*[:=]\s*)([^\s,;]+)/gi, "$1<redacted>")
        .replace(/(password\s*[:=]\s*)([^\s,;]+)/gi, "$1<redacted>")
        .replace(/(secret\s*[:=]\s*)([^\s,;]+)/gi, "$1<redacted>")
}

function toUint8Array(chunk: Uint8Array | string): Uint8Array {
    if (typeof chunk === "string") return new TextEncoder().encode(chunk)
    if (!(chunk instanceof Uint8Array)) throw new HostBridgeError("validation_error", "artifact chunk must be bytes or text")
    return chunk
}

function requireNonNegativeInteger(value: number | undefined, field: string): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new HostBridgeError("validation_error", `${field} must be a non-negative integer`)
    }
    return value
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

export class TaricArtifactStore {
    private readonly rootDir: string
    private readonly maxInlineBytes: number
    private readonly maxReadBytes: number
    private readonly retentionDays: number
    private readonly redactText: boolean
    private readonly backupDir?: string
    private readonly accessLogPath: string

    constructor(options: TaricArtifactStoreOptions = {}) {
        this.rootDir = resolve(options.rootDir ?? DEFAULT_TARIC_ARTIFACT_DIR)
        this.maxInlineBytes = options.maxInlineBytes ?? DEFAULT_MAX_INLINE_BYTES
        this.maxReadBytes = Math.max(options.maxInlineBytes ?? DEFAULT_MAX_INLINE_BYTES, DEFAULT_MAX_READ_BYTES)
        this.retentionDays = options.retentionDays ?? 30
        this.redactText = options.redactText === true
        this.backupDir = options.backupDir?.trim() ? resolve(options.backupDir) : undefined
        this.accessLogPath = join(this.rootDir, "access.jsonl")
    }

    private recordPath(artifactId: string): string {
        return join(this.rootDir, "records", `${encodeURIComponent(requireSafeId(artifactId))}.json`)
    }

    private chunkDir(artifactId: string): string {
        return join(this.rootDir, "chunks", requireSafeId(artifactId))
    }

    private chunkPath(artifactId: string, ordinal: number): string {
        return join(this.chunkDir(artifactId), `${ordinal}.bin`)
    }

    async begin(input: {
        engagementId: string
        attemptId?: string
        workRunId?: string
        expectedHash?: string
        totalBytes?: number
        acl?: TaricArtifactAcl
        retentionDays?: number
    }): Promise<TaricArtifactRecord> {
        const artifactId = crypto.randomUUID()
        const record: TaricArtifactRecord = {
            artifact_id: artifactId,
            engagement_id: requireText(input.engagementId, "engagementId"),
            ...(input.attemptId?.trim() ? { attempt_id: input.attemptId.trim() } : {}),
            ...(input.workRunId?.trim() ? { work_run_id: input.workRunId.trim() } : {}),
            content_ref: `taric-artifact:${artifactId}`,
            expected_hash: input.expectedHash?.trim() || undefined,
            ordinal: 0,
            total_bytes: 0,
            expected_total_bytes: input.totalBytes !== undefined ? requireNonNegativeInteger(input.totalBytes, "totalBytes") : undefined,
            status: "open",
            acl: { read: input.acl?.read === true },
            retention_days: input.retentionDays !== undefined ? requireNonNegativeInteger(input.retentionDays, "retentionDays") : this.retentionDays,
            created_at: nowIso(),
            updated_at: nowIso(),
        }
        await mkdir(this.chunkDir(artifactId), { recursive: true })
        await atomicWriteJson(this.recordPath(artifactId), record)
        return record
    }

    async append(artifactId: string, chunk: Uint8Array | string): Promise<TaricArtifactRecord> {
        const record = await this.requireOpen(artifactId)
        const rawBytes = toUint8Array(chunk)
        const bytes = this.redactText && typeof chunk === "string"
            ? new TextEncoder().encode(redactTaricArtifactText(chunk))
            : rawBytes
        const ordinal = record.ordinal
        const path = this.chunkPath(artifactId, ordinal)
        try {
            await Bun.write(path, bytes)
        } catch (error) {
            await rm(path, { force: true }).catch(() => {})
            throw new HostBridgeError("unavailable", `failed to append artifact chunk: ${error instanceof Error ? error.message : String(error)}`)
        }

        const updated: TaricArtifactRecord = {
            ...record,
            ordinal: ordinal + 1,
            total_bytes: record.total_bytes + bytes.length,
            updated_at: nowIso(),
        }
        await atomicWriteJson(this.recordPath(artifactId), updated)
        return updated
    }

    async commit(artifactId: string): Promise<TaricArtifactRecord & { summary: string }> {
        const record = await this.requireOpen(artifactId)
        const bytes = await this.readAll(record)
        const hash = digestBytes(bytes)
        if (this.backupDir) {
            await mkdir(this.backupDir, { recursive: true })
            await Bun.write(join(this.backupDir, `${record.artifact_id}.bin`), bytes)
        }
        if (record.expected_total_bytes !== undefined && bytes.length !== record.expected_total_bytes) {
            await this.markFailed(artifactId, `artifact size mismatch: expected ${record.expected_total_bytes}, got ${bytes.length}`)
            throw new HostBridgeError("conflict", "artifact size mismatch")
        }
        if (record.expected_hash && record.expected_hash !== hash) {
            await this.markFailed(artifactId, `artifact hash mismatch: expected ${record.expected_hash}, got ${hash}`)
            throw new HostBridgeError("conflict", "artifact hash mismatch")
        }
        const updated: TaricArtifactRecord = {
            ...record,
            hash,
            status: "committed",
            updated_at: nowIso(),
        }
        await atomicWriteJson(this.recordPath(artifactId), updated)
        return {
            ...updated,
            summary: this.summarize(bytes),
        }
    }

    async readAuthorized(artifactId: string, principal: "host" | "operator"): Promise<Uint8Array> {
        const record = await this.requireReadable(artifactId, principal)
        const bytes = await this.readAll(record)
        await this.recordAccess(record.artifact_id, principal, 0, bytes.length)
        return bytes
    }

    async readAuthorizedRange(artifactId: string, principal: "host" | "operator", offset: number, length: number): Promise<{ bytes: Uint8Array; record: TaricArtifactRecord }> {
        if (principal !== "host" && principal !== "operator") {
            throw new HostBridgeError("authorization_error", "artifact content read requires a host or operator principal")
        }
        const start = requireNonNegativeInteger(offset, "offset")
        const count = requireNonNegativeInteger(length, "length")
        if (count < 1 || count > this.maxReadBytes) {
            throw new HostBridgeError("validation_error", `length must be between 1 and ${this.maxReadBytes}`)
        }
        const record = await this.requireReadable(artifactId, principal)
        const all = await this.readAll(record)
        if (start > all.length) throw new HostBridgeError("validation_error", "offset exceeds artifact size")
        const bytes = all.slice(start, Math.min(all.length, start + count))
        await this.recordAccess(record.artifact_id, principal, start, bytes.length)
        return { bytes, record }
    }

    private async requireReadable(artifactId: string, principal: "host" | "operator"): Promise<TaricArtifactRecord> {
        if (principal !== "host" && principal !== "operator") {
            throw new HostBridgeError("authorization_error", "artifact content read requires a host or operator principal")
        }
        const record = await this.get(artifactId)
        if (!record) throw new HostBridgeError("validation_error", "artifact not found")
        if (!record.acl.read) throw new HostBridgeError("authorization_error", "artifact read is not authorized")
        if (record.status !== "committed") throw new HostBridgeError("stale_version", `artifact is ${record.status}`)
        return record
    }

    private async recordAccess(artifactId: string, principal: "host" | "operator", offset: number, length: number): Promise<void> {
        await mkdir(dirname(this.accessLogPath), { recursive: true })
        await appendFile(this.accessLogPath, `${JSON.stringify({ artifact_id: artifactId, principal, offset, length, accessed_at: nowIso() })}\n`, "utf8").catch(() => {})
    }

    async markFailed(artifactId: string, reason: string): Promise<TaricArtifactRecord> {
        const record = await this.get(artifactId)
        if (!record) throw new HostBridgeError("validation_error", "artifact not found")
        const updated: TaricArtifactRecord = {
            ...record,
            status: "failed",
            last_error: requireText(reason, "reason"),
            updated_at: nowIso(),
        }
        await atomicWriteJson(this.recordPath(artifactId), updated)
        return updated
    }

    async expire(artifactId: string): Promise<TaricArtifactRecord> {
        const record = await this.get(artifactId)
        if (!record) throw new HostBridgeError("validation_error", "artifact not found")
        const updated: TaricArtifactRecord = {
            ...record,
            status: "expired",
            updated_at: nowIso(),
        }
        await atomicWriteJson(this.recordPath(artifactId), updated)
        return updated
    }

    async sweepExpired(now = Date.now()): Promise<number> {
        let expired = 0
        for (const record of await this.list()) {
            if (record.status !== "committed") continue
            const createdAt = Date.parse(record.created_at)
            if (!Number.isFinite(createdAt)) continue
            if (createdAt + record.retention_days * 24 * 60 * 60 * 1000 > now) continue
            await this.expire(record.artifact_id)
            expired += 1
        }
        return expired
    }

    async get(artifactId: string): Promise<TaricArtifactRecord | undefined> {
        const path = this.recordPath(artifactId)
        if (!(await Bun.file(path).exists())) return
        try {
            return await Bun.file(path).json() as TaricArtifactRecord
        } catch {
            throw new HostBridgeError("unavailable", "failed to read artifact record")
        }
    }

    async list(): Promise<TaricArtifactRecord[]> {
        let files: string[] = []
        try {
            files = await readdir(join(this.rootDir, "records"))
        } catch {
            return []
        }
        const records: TaricArtifactRecord[] = []
        for (const file of files.filter((item) => item.endsWith(".json"))) {
            try {
                const record = await Bun.file(join(this.rootDir, "records", file)).json() as TaricArtifactRecord
                records.push(record)
            } catch {
                // Ignore malformed records until operator-driven repair.
            }
        }
        return records.sort((a, b) => a.created_at.localeCompare(b.created_at))
    }

    private async requireOpen(artifactId: string): Promise<TaricArtifactRecord> {
        const record = await this.get(artifactId)
        if (!record) throw new HostBridgeError("validation_error", "artifact not found")
        if (record.status !== "open") throw new HostBridgeError("stale_version", `artifact is ${record.status}`)
        return record
    }

    private async readAll(record: TaricArtifactRecord): Promise<Uint8Array> {
        const chunks: Uint8Array[] = []
        for (let ordinal = 0; ordinal < record.ordinal; ordinal += 1) {
            const path = this.chunkPath(record.artifact_id, ordinal)
            if (!(await Bun.file(path).exists())) {
                throw new HostBridgeError("unavailable", `artifact chunk ${ordinal} is missing`)
            }
            chunks.push(new Uint8Array(await Bun.file(path).arrayBuffer()))
        }
        const total = chunks.reduce((sum, item) => sum + item.length, 0)
        const output = new Uint8Array(total)
        let offset = 0
        for (const chunk of chunks) {
            output.set(chunk, offset)
            offset += chunk.length
        }
        return output
    }

    private summarize(bytes: Uint8Array): string {
        const text = new TextDecoder().decode(bytes.slice(0, this.maxInlineBytes))
        return text.length >= bytes.length ? text : `${text}...`
    }
}
