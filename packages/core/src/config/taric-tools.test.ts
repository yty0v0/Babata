import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { ConfigManager } from "./index"

const tempDirs: string[] = []

afterEach(async () => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop()
        if (!dir) continue
        await rm(dir, { recursive: true, force: true })
    }
})

describe("Taric tool enablement", () => {
    test("host-injected binding does not expose Taric tools to the solver container", async () => {
        const configDir = await mkdtemp(resolve(tmpdir(), "tch-taric-tools-"))
        tempDirs.push(configDir)
        const config = await ConfigManager.getInstance(configDir)
        await config.setPrompt({
            name: "taric-reader",
            meta: { tools: ["taric_board_query", "taric_proposal_submit"] },
            content: "read board and propose",
        })
        await config.setHostSettings({
            taric: { enabled: true, readBoard: { enabled: true }, proposal: { enabled: true } },
        })

        const previousChallenge = process.env.TCH_CHALLENGE_ID
        const previousBinding = process.env.TCH_TARIC_BINDING_ACTIVE
        process.env.TCH_CHALLENGE_ID = "container-only-challenge"
        process.env.TCH_TARIC_BINDING_ACTIVE = "1"
        try {
            const resolved = await config.resolvePromptSession("taric-reader")
            const names = resolved?.customTools?.map((tool) => tool.name) ?? []
            expect(names).not.toContain("taric_board_query")
            expect(names).not.toContain("taric_proposal_submit")
        } finally {
            if (previousChallenge === undefined) delete process.env.TCH_CHALLENGE_ID
            else process.env.TCH_CHALLENGE_ID = previousChallenge
            if (previousBinding === undefined) delete process.env.TCH_TARIC_BINDING_ACTIVE
            else process.env.TCH_TARIC_BINDING_ACTIVE = previousBinding
        }
    })

    test("Taric tools remain internal whether Taric is disabled or enabled", async () => {
        const configDir = await mkdtemp(resolve(tmpdir(), "tch-taric-tools-"))
        tempDirs.push(configDir)
        const config = await ConfigManager.getInstance(configDir)
        await config.setPrompt({
            name: "taric-reader",
            meta: { tools: ["taric_board_query", "taric_proposal_submit"] },
            content: "read board and propose",
        })

        await config.setHostSettings({ taric: { enabled: false, readBoard: { enabled: false } } })
        const disabled = await config.resolvePromptSession("taric-reader")
        const disabledTools = disabled?.customTools?.map((tool) => tool.name) ?? []
        expect(disabledTools).not.toContain("taric_board_query")
        expect(disabledTools).not.toContain("taric_proposal_submit")

        await config.setHostSettings({
            taric: { enabled: true, readBoard: { enabled: true }, proposal: { enabled: true } },
        })
        const enabled = await config.resolvePromptSession("taric-reader")
        const enabledTools = enabled?.customTools?.map((tool) => tool.name) ?? []
        expect(enabledTools).not.toContain("taric_board_query")
        expect(enabledTools).not.toContain("taric_proposal_submit")
    })
})
