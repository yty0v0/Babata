import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "fs/promises"
import { tmpdir } from "os"
import { resolve } from "path"
import type { ConfigManager } from "../config/index"
import { deriveCompositeProjectKey } from "../project/types"
import type { ChallengeMemoryProvider, ChallengeMemoryScope } from "./memory-provider"
import { CHALLENGE_ENV_DIR } from "./env"
import { ChallengeManager } from "./manager"
import { createChallengeRecord } from "./store"

let challengeDir: string
let manager: ChallengeManager

beforeEach(async () => {
    challengeDir = await mkdtemp(resolve(tmpdir(), "tch-challenge-memory-test-"))
    process.env[CHALLENGE_ENV_DIR] = challengeDir
    const config = {
        getHostSettings: async () => ({ runtime: {}, planner: {} }),
    } as unknown as ConfigManager
    manager = new ChallengeManager(config)
})

afterEach(async () => {
    delete process.env[CHALLENGE_ENV_DIR]
    await rm(challengeDir, { recursive: true, force: true })
})

describe("challenge-memory", () => {
    test("adds, edits, and deletes ideas by id prefix", async () => {
        const first = await manager.addIdea("abc123", { content: "Try SQL injection on /login" })
        expect(first.created).toBe(true)
        expect(first.item.status).toBe("pending")

        const deduped = await manager.addIdea("abc123", { content: "try sql injection on /login" })
        expect(deduped.created).toBe(false)
        expect(deduped.item.id).toBe(first.item.id)

        const updated = await manager.updateIdea("abc123", first.item.id.slice(0, 8), {
            content: "Try SQL injection on /admin/login",
            status: "failed",
            result: "No injection point",
        })
        expect(updated.content).toBe("Try SQL injection on /admin/login")
        expect(updated.status).toBe("failed")
        expect(updated.result).toBe("No injection point")

        const deleted = await manager.deleteIdea("abc123", first.item.id.slice(0, 8))
        expect(deleted.id).toBe(first.item.id)

        const items = await manager.listIdeas("abc123")
        expect(items).toHaveLength(0)
    })

    test("listing ideas does not create storage for missing challenge", async () => {
        const items = await manager.listIdeas("missing")
        expect(items).toEqual([])
        expect(await readdir(challengeDir)).toEqual([])
    })

    test("rejects editing an idea into another existing normalized value", async () => {
        const first = await manager.addIdea("abc123", { content: "Try SQL injection on /login" })
        const second = await manager.addIdea("abc123", { content: "Check upload polyglot" })

        expect(first.created).toBe(true)
        expect(second.created).toBe(true)

        await expect(
            manager.updateIdea("abc123", second.item.id, {
                content: "  try sql injection on /login  ",
            }),
        ).rejects.toThrow("duplicates")
    })

    test("adds idea with status/result and without content length limit", async () => {
        const longContent = "A".repeat(240)
        const created = await manager.addIdea("abc123", {
            content: longContent,
            status: "verified",
            result: "worked",
        })

        expect(created.created).toBe(true)
        expect(created.item.content).toBe(longContent)
        expect(created.item.status).toBe("verified")
        expect(created.item.result).toBe("worked")
    })

    test("appends and lists memory entries", async () => {
        await manager.appendMemory({
            challengeId: "abc123",
            kind: "fact",
            content: "found /admin",
            refs: ["evidence/http-1.txt"],
            source: "solver:1",
        })
        await manager.appendMemory({
            challengeId: "abc123",
            kind: "failure",
            content: "sqli failed",
            refs: [],
            source: "solver:1",
        })

        const entries = await manager.listMemory("abc123")
        expect(entries).toHaveLength(2)
        expect(entries.some((item) => item.kind === "fact")).toBe(true)
        expect(entries.some((item) => item.kind === "failure")).toBe(true)
    })

    test("Taric-managed challenge reads fail closed instead of falling back to local JSON", async () => {
        const project = {
            mode: "competition" as const,
            provider: "local_practice" as const,
            tenant_id: "tenant-a",
            platform_id: "platform-a",
            competition_id: "competition-a",
            team_id: "team-a",
            challenge_code: "challenge-a",
            memory_mode: "taric_best_effort" as const,
            taric_engagement_id: "engagement-a",
        }
        await manager.createChallenge(createChallengeRecord({ id: "taric-challenge", name: "Taric challenge", project }))
        const rejectingManager = new ChallengeManager(
            {
                getHostSettings: async () => ({ runtime: {}, planner: {} }),
            } as unknown as ConfigManager,
            undefined,
            undefined,
            undefined,
            async () => { throw new Error("Taric unavailable") },
        )
        await expect(rejectingManager.listMemory("taric-challenge")).rejects.toThrow("Taric unavailable")
        await expect(readdir(resolve(challengeDir, "taric-challenge", "memory"))).rejects.toThrow()
    })

    test("routes a Taric project through one cached provider and a trusted composite scope", async () => {
        const project = {
            mode: "competition" as const,
            provider: "local_practice" as const,
            tenant_id: "tenant-a",
            platform_id: "platform-a",
            competition_id: "competition-a",
            team_id: "team-a",
            challenge_code: "challenge-taric",
            memory_mode: "taric_best_effort" as const,
            taric_engagement_id: "engagement-a",
        }
        await manager.createChallenge(createChallengeRecord({ id: "taric-project", name: "Taric project", project }))

        const scopes: ChallengeMemoryScope[] = []
        const provider = {
            mode: "taric_best_effort" as const,
            listMemory: async (scope: ChallengeMemoryScope) => {
                scopes.push(scope)
                return [{
                    id: "taric-memory-1",
                    challengeId: scope.challengeId,
                    kind: "fact" as const,
                    content: "authoritative fact",
                    refs: [],
                    source: "taric",
                    trustState: "admitted" as const,
                    created_at: "2026-10-31T00:00:00.000Z",
                    updated_at: "2026-10-31T00:00:00.000Z",
                }]
            },
        } as unknown as ChallengeMemoryProvider
        let factoryCalls = 0
        const providerManager = new ChallengeManager(
            {
                getHostSettings: async () => ({ runtime: {}, planner: {} }),
            } as unknown as ConfigManager,
            undefined,
            undefined,
            undefined,
            async (scope) => {
                factoryCalls += 1
                expect(scope.projectKey).toBe(deriveCompositeProjectKey(project))
                expect(scope.project?.taric_engagement_id).toBe("engagement-a")
                return provider
            },
        )

        expect((await providerManager.listMemory("taric-project"))[0].content).toBe("authoritative fact")
        expect((await providerManager.listMemory("taric-project"))[0].content).toBe("authoritative fact")
        expect(factoryCalls).toBe(1)
        expect(scopes).toHaveLength(2)
        expect(scopes.every((scope) => scope.challengeId === "taric-project" && scope.projectKey === deriveCompositeProjectKey(project))).toBe(true)
        await expect(readdir(resolve(challengeDir, "taric-project", "memory"))).rejects.toThrow()
    })
    test("explicit legacy-local project keeps its challenge-scoped local board", async () => {
        const project = {
            mode: "competition" as const,
            provider: "local_practice" as const,
            tenant_id: "tenant-a",
            platform_id: "platform-a",
            competition_id: "competition-a",
            team_id: "team-a",
            challenge_code: "challenge-local",
            memory_mode: "legacy_local" as const,
        }
        await manager.createChallenge(createChallengeRecord({ id: "local-challenge", name: "Local challenge", project }))
        await manager.appendMemory({ challengeId: "local-challenge", kind: "fact", content: "local fact", source: "operator" })
        expect((await manager.listMemory("local-challenge")).map((entry) => entry.content)).toEqual(["local fact"])
    })

    test("updates and deletes memory by id prefix", async () => {
        const first = await manager.appendMemory({
            challengeId: "abc123",
            kind: "fact",
            content: "found /admin",
            refs: ["evidence/http-1.txt"],
            source: "solver:1",
        })
        const second = await manager.appendMemory({
            challengeId: "abc123",
            kind: "failure",
            content: "sqli failed",
            refs: [],
            source: "solver:1",
        })

        const updated = await manager.updateMemory("abc123", first.id.slice(0, 8), {
            kind: "evidence",
            content: "found /admin/login",
            refs: ["evidence/http-2.txt"],
            source: "observer:solver-1",
        })
        expect(updated.id).toBe(first.id)
        expect(updated.kind).toBe("evidence")
        expect(updated.content).toBe("found /admin/login")
        expect(updated.refs).toEqual(["evidence/http-2.txt"])
        expect(updated.source).toBe("observer:solver-1")
        expect(updated.updated_at).not.toBe(updated.created_at)

        const deleted = await manager.deleteMemory("abc123", second.id.slice(0, 8))
        expect(deleted.id).toBe(second.id)

        const entries = await manager.listMemory("abc123")
        expect(entries).toHaveLength(1)
        expect(entries[0].id).toBe(first.id)
        expect(entries[0].content).toBe("found /admin/login")
    })
})
