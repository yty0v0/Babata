import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { safetyGuardrailExtension } from "./safety-guardrail"
import { readSolverGuardrailAudit } from "../guardrail-audit"
import type { HostGuardrailSettings } from "../../config/types"

function fakePi() {
    const handlers = new Map<string, (event: any) => any>()
    return {
        pi: {
            on(event: string, handler: (event: any) => any) {
                handlers.set(event, handler)
            },
        },
        async run(event: any) {
            const handler = handlers.get("tool_call")
            if (!handler) throw new Error("tool_call handler is not registered")
            return handler(event)
        },
    }
}

describe("safety guardrail extension", () => {
    test("observe phase records without blocking", async () => {
        const workspaceRoot = await mkdtemp(join(tmpdir(), "guardrail-extension-observe-"))
        try {
            const settings: HostGuardrailSettings = { enabled: true, phase: "observe" }
            const fake = fakePi()
            safetyGuardrailExtension({ workspaceRoot, settings })(fake.pi as any)
            const result = await fake.run({ toolName: "bash", input: { command: "rm -rf /" } })
            expect(result).toBeUndefined()
            const events = await readSolverGuardrailAudit(workspaceRoot)
            expect(events).toHaveLength(1)
            expect(events[0].decision).toBe("observed")
        } finally {
            await rm(workspaceRoot, { recursive: true, force: true })
        }
    })

    test("enforce phase records and blocks", async () => {
        const workspaceRoot = await mkdtemp(join(tmpdir(), "guardrail-extension-enforce-"))
        try {
            const settings: HostGuardrailSettings = { enabled: true, phase: "enforce" }
            const fake = fakePi()
            safetyGuardrailExtension({ workspaceRoot, settings })(fake.pi as any)
            const result = await fake.run({ toolName: "bash", input: { command: "rm -rf /" } })
            expect(result).toMatchObject({ block: true })
            const events = await readSolverGuardrailAudit(workspaceRoot)
            expect(events).toHaveLength(1)
            expect(events[0].decision).toBe("blocked")
        } finally {
            await rm(workspaceRoot, { recursive: true, force: true })
        }
    })
})
