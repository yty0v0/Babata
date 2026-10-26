import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { ConfigManager } from "./index"

let configDir: string
let config: ConfigManager

beforeEach(async () => {
    configDir = await mkdtemp(resolve(tmpdir(), "tch-guardrail-"))
    config = await ConfigManager.getInstance(configDir)
})

afterEach(async () => {
    await rm(configDir, { recursive: true, force: true })
})

test("guardrail defaults to enabled enforcement phase", async () => {
    const settings = await config.getHostSettings()
    expect(settings.guardrail).toMatchObject({
        enabled: true,
        phase: "enforce",
    })
})

test("guardrail settings merge nested patches", async () => {
    await config.setHostSettings({
        guardrail: {
            enabled: false,
            phase: "observe",
        },
    })

    const settings = await config.getHostSettings()
    expect(settings.guardrail).toMatchObject({
        enabled: false,
        phase: "observe",
    })
})
