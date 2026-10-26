import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { HostBridgeError } from "./host-bridge-types"
import { TaricBindingRegistry, type TaricBindingScopeSnapshot } from "./taric-binding-registry"

const scope: TaricBindingScopeSnapshot = {
    allowed_targets: ["https://example.test"],
    excluded_targets: [],
    rules_of_engagement_ref: "roe:web-001",
}

const tempDirs: string[] = []

let currentTempDirValue: string | undefined

function currentTempDir(): string {
    if (!currentTempDirValue) throw new Error("temp binding dir missing")
    return currentTempDirValue
}

async function createRegistry(): Promise<TaricBindingRegistry> {
    const dir = await mkdtemp(join(tmpdir(), "taric-binding-"))
    tempDirs.push(dir)
    currentTempDirValue = dir
    return new TaricBindingRegistry(dir)
}

describe("Taric binding registry", () => {
    test("creates pending binding and activates it with required Taric refs", async () => {
        const registry = await createRegistry()
        const pending = await registry.createPending({ challengeId: "web-001", scope })
        expect(pending.status).toBe("pending")
        expect(await registry.getActiveBinding("web-001")).toBeUndefined()

        const active = await registry.activate({
            challengeId: "web-001",
            engagementId: "01a167a1-521e-7ef1-88d0-ef049c750502",
            engagementRecordId: "01a167a1-521e-7ef1-88d0-ef049c750502",
            scopeRecordId: "01a167a1-521e-78ab-84b5-0ce5f322dc8c",
        })
        expect(active).toMatchObject({
            status: "active",
            engagement_id: "01a167a1-521e-7ef1-88d0-ef049c750502",
        })
        expect(await registry.requireActiveBinding("web-001")).toMatchObject({
            status: "active",
        })
    })

    test("failed binding drops engagement id and retains reason", async () => {
        const registry = await createRegistry()
        await registry.createPending({ challengeId: "web-001", scope })
        await registry.activate({
            challengeId: "web-001",
            engagementId: "engagement-1",
            engagementRecordId: "record-1",
        })
        const failed = await registry.fail({ challengeId: "web-001", reason: "authority unavailable" })
        expect(failed).toMatchObject({
            status: "failed",
            engagement_id: undefined,
            failure_reason: "authority unavailable",
        })
        expect(await registry.getActiveBinding("web-001")).toBeUndefined()
    })

    test("requires active binding before scoped Taric access", async () => {
        const registry = await createRegistry()
        await registry.createPending({ challengeId: "web-001", scope })
        let caught: unknown
        try {
            await registry.requireActiveBinding("web-001")
        } catch (error) {
            caught = error
        }
        expect(caught).toBeInstanceOf(HostBridgeError)
        expect((caught as HostBridgeError).code).toBe("authorization_error")
    })

    test("rejects invalid challenge ids and empty scope", async () => {
        const registry = await createRegistry()
        await expect(registry.createPending({ challengeId: "../escape", scope })).rejects.toThrow()
        await expect(registry.createPending({ challengeId: "web-001", scope: { ...scope, allowed_targets: [] } })).rejects.toThrow()
    })

    test("invalid or unreadable binding fails closed", async () => {
        const registry = await createRegistry()
        await registry.createPending({ challengeId: "web-001", scope })
        const bindingPath = join(await currentTempDir(), "web-001", "taric", "binding.json")
        const binding = (await Bun.file(bindingPath).json()) as Record<string, unknown>
        binding.status = "active"
        await Bun.write(bindingPath, JSON.stringify(binding, null, 2))
        await expect(registry.get("web-001")).rejects.toThrow()
    })
})

// Cleanup is intentionally explicit and only removes this test's temp dirs.
afterEach(async () => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop()
        if (!dir) continue
        await rm(dir, { recursive: true, force: true })
    }
})
