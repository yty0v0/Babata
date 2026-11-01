import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { archiveLegacyUnclassified, dryRunLegacyMigration } from "./migration"
import { createChallengeRecord, saveChallengeRecord } from "../challenge/store"

describe("legacy migration", () => {
    test("classifies without writing and archives only explicit ambiguous records", async () => {
        const root = await mkdtemp(join(tmpdir(), "bw-migration-"))
        const archive = await mkdtemp(join(tmpdir(), "bw-migration-archive-"))
        try {
            const trusted = createChallengeRecord({ id: "trusted", name: "Trusted", project: {
                mode: "competition", provider: "local_practice", tenant_id: "tenant", platform_id: "platform", competition_id: "competition", team_id: "team", challenge_code: "code", memory_mode: "legacy_local",
            } })
            const legacy = createChallengeRecord({ id: "legacy", name: "Legacy", description: "flag{secret}" })
            await saveChallengeRecord(root, trusted, "test")
            await saveChallengeRecord(root, legacy, "test")
            const before = await readFile(join(root, "legacy", "challenge.json"), "utf8")
            const report = await dryRunLegacyMigration(root)
            expect(report.readOnly).toBe(true)
            expect(report.counts).toMatchObject({ total: 2, trusted: 1, legacyUnclassified: 1, sensitive: 1 })
            expect(report.items.find((item) => item.challengeId === "legacy")).toMatchObject({ classification: "legacy_unclassified", contentDigest: expect.any(String) })
            expect(await readFile(join(root, "legacy", "challenge.json"), "utf8")).toBe(before)

            await expect(archiveLegacyUnclassified(report, ["trusted"], archive)).rejects.toThrow("not an unclassified")
            expect(await archiveLegacyUnclassified(report, ["legacy"], archive)).toMatchObject({ archived: ["legacy"] })
        } finally {
            await rm(root, { recursive: true, force: true })
            await rm(archive, { recursive: true, force: true })
        }
    })
})
