import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import { resolve } from "path"
import { ConfigManager } from "./index"

let dir: string

beforeEach(async () => {
    dir = await mkdtemp(resolve(tmpdir(), "tch-taric-settings-"))
})

afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
})

describe("Taric admission settings", () => {
    test("defaults proposal admission mode to hitl_l1", async () => {
        const config = await ConfigManager.getInstance(dir)
        await config.setHostSettings({
            taric: { enabled: true, proposal: { enabled: true } },
        })
        const settings = await config.getHostSettings()
        expect(settings.taric?.proposal?.admissionMode).toBe("hitl_l1")
    })

    test("rejects invalid admission mode", async () => {
        const config = await ConfigManager.getInstance(dir)
        await expect(
            config.setHostSettings({
                taric: { proposal: { admissionMode: "invalid" as "hitl_l1" } },
            }),
        ).rejects.toThrow("taric.proposal.admissionMode")
    })

    test("preserves readBoard settings when updating proposal mode", async () => {
        const config = await ConfigManager.getInstance(dir)
        await config.setHostSettings({
            taric: {
                enabled: true,
                readBoard: { enabled: true, baseUrl: "http://127.0.0.1:9123" },
                proposal: { enabled: true, admissionMode: "hitl_l1" },
            },
        })
        await config.setHostSettings({
            taric: { proposal: { admissionMode: "auto_l1" } },
        })
        const settings = await config.getHostSettings()
        expect(settings.taric?.readBoard?.enabled).toBe(true)
        expect(settings.taric?.readBoard?.baseUrl).toBe("http://127.0.0.1:9123")
        expect(settings.taric?.proposal?.admissionMode).toBe("auto_l1")
    })
})
