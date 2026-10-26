import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { HostBridgeError } from "./host-bridge-types"
import { TaricArtifactStore, redactTaricArtifactText } from "./taric-artifact-store"

const tempDirs: string[] = []

afterEach(async () => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop()
        if (dir) await rm(dir, { recursive: true, force: true })
    }
})

async function createStore() {
    const dir = await mkdtemp(join(tmpdir(), "taric-artifact-"))
    tempDirs.push(dir)
    return new TaricArtifactStore({ rootDir: dir, maxInlineBytes: 8 })
}

describe("Taric artifact store", () => {
    test("buffers chunks and returns a bounded summary on commit", async () => {
        const store = await createStore()
        const opened = await store.begin({
            engagementId: "engagement-1",
            totalBytes: 18,
            acl: { read: true },
        })
        await store.append(opened.artifact_id, "hello ")
        const appended = await store.append(opened.artifact_id, "world 123456")
        expect(appended.ordinal).toBe(2)
        expect(appended.total_bytes).toBe(18)

        const committed = await store.commit(opened.artifact_id)
        expect(committed.status).toBe("committed")
        expect(committed.hash).toMatch(/^sha256:[0-9a-f]{64}$/)
        expect(committed.summary).toBe("hello wo...")
    })

    test("committed raw content is only available through authorized read", async () => {
        const store = await createStore()
        const opened = await store.begin({
            engagementId: "engagement-1",
            acl: { read: true },
        })
        await store.append(opened.artifact_id, "sensitive output")
        const committed = await store.commit(opened.artifact_id)
        const bytes = await store.readAuthorized(committed.artifact_id, "host")
        expect(new TextDecoder().decode(bytes)).toBe("sensitive output")
    })

    test("denies unauthorized raw reads", async () => {
        const store = await createStore()
        const opened = await store.begin({
            engagementId: "engagement-1",
            acl: { read: false },
        })
        await store.append(opened.artifact_id, "secret")
        await store.commit(opened.artifact_id)
        await expect(store.readAuthorized(opened.artifact_id, "host")).rejects.toBeInstanceOf(HostBridgeError)
        try {
            await store.readAuthorized(opened.artifact_id, "host")
        } catch (error) {
            expect((error as HostBridgeError).code).toBe("authorization_error")
        }
    })

    test("hash mismatch fails the artifact", async () => {
        const store = await createStore()
        const opened = await store.begin({
            engagementId: "engagement-1",
            expectedHash: "sha256:deadbeef",
            acl: { read: true },
        })
        await store.append(opened.artifact_id, "payload")
        await expect(store.commit(opened.artifact_id)).rejects.toBeInstanceOf(HostBridgeError)
        expect((await store.get(opened.artifact_id))?.status).toBe("failed")
    })

    test("expired artifacts stop authorized raw reads", async () => {
        const store = await createStore()
        const opened = await store.begin({
            engagementId: "engagement-1",
            retentionDays: 1,
            acl: { read: true },
        })
        await store.append(opened.artifact_id, "old output")
        await store.commit(opened.artifact_id)
        await store.expire(opened.artifact_id)
        expect((await store.get(opened.artifact_id))?.status).toBe("expired")
        await expect(store.readAuthorized(opened.artifact_id, "host")).rejects.toBeInstanceOf(HostBridgeError)
    })

    test("redacts configured secret fields and writes commit backups", async () => {
        const root = await mkdtemp(join(tmpdir(), "taric-artifact-redact-"))
        tempDirs.push(root)
        const backupDir = join(root, "backup")
        const store = new TaricArtifactStore({ rootDir: join(root, "spool"), redactText: true, backupDir })
        const opened = await store.begin({ engagementId: "engagement-1", acl: { read: true } })
        await store.append(opened.artifact_id, "Authorization: Bearer abc123\napi_key: super-secret\n")
        const committed = await store.commit(opened.artifact_id)
        const bytes = await store.readAuthorized(opened.artifact_id, "host")
        const text = new TextDecoder().decode(bytes)
        expect(text).not.toContain("abc123")
        expect(text).not.toContain("super-secret")
        expect(await Bun.file(join(backupDir, `${opened.artifact_id}.bin`)).exists()).toBe(true)
        expect(committed.content_ref).toBe(`taric-artifact:${opened.artifact_id}`)
    })

    test("redacts common secret patterns", () => {
        expect(redactTaricArtifactText("password=hello secret:world Bearer token123")).not.toContain("hello")
        expect(redactTaricArtifactText("api_key=hello")).not.toContain("hello")
    })

    test("authorized range reads are bounded and audited", async () => {
        const store = await createStore()
        const opened = await store.begin({ engagementId: "engagement-1", acl: { read: true } })
        await store.append(opened.artifact_id, "0123456789abcdef")
        await store.commit(opened.artifact_id)

        const range = await store.readAuthorizedRange(opened.artifact_id, "operator", 4, 6)
        expect(new TextDecoder().decode(range.bytes)).toBe("456789")
        const audit = await Bun.file(join((store as unknown as { rootDir: string }).rootDir, "access.jsonl")).text()
        expect(audit).toContain(opened.artifact_id)

        await expect(store.readAuthorizedRange(opened.artifact_id, "operator", 0, 1024 * 1024 + 1)).rejects.toBeInstanceOf(HostBridgeError)
    })

    test("retention sweep expires committed artifacts", async () => {
        const store = await createStore()
        const opened = await store.begin({ engagementId: "engagement-1", retentionDays: 0, acl: { read: true } })
        await store.append(opened.artifact_id, "old")
        await store.commit(opened.artifact_id)

        expect(await store.sweepExpired(Date.now() + 1_000)).toBe(1)
        expect((await store.get(opened.artifact_id))?.status).toBe("expired")
    })
})
