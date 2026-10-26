import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
    aggregateGuardrailAudit,
    appendGuardrailAuditEvent,
    guardrailAuditPath,
    readSolverGuardrailAudit,
} from "./guardrail-audit"

describe("guardrail audit", () => {
    test("appends and reads JSONL events", async () => {
        const workspaceRoot = await mkdtemp(join(tmpdir(), "guardrail-audit-"))
        try {
            await appendGuardrailAuditEvent(guardrailAuditPath(workspaceRoot), {
                timestamp: "2026-10-25T00:00:00.000Z",
                solverId: "solver-a",
                challengeId: "challenge-a",
                role: "executor",
                toolName: "bash",
                ruleId: "bash.reverse_shell",
                decision: "observed",
                reason: "reverse shell detected",
                phase: "observe",
            })

            const events = await readSolverGuardrailAudit(workspaceRoot)
            expect(events).toHaveLength(1)
            expect(events[0].toolName).toBe("bash")
            expect(events[0].decision).toBe("observed")
        } finally {
            await rm(workspaceRoot, { recursive: true, force: true })
        }
    })

    test("ignores malformed audit lines", async () => {
        const workspaceRoot = await mkdtemp(join(tmpdir(), "guardrail-audit-corrupt-"))
        try {
            await writeFile(
                guardrailAuditPath(workspaceRoot),
                '{"toolName":"bash","decision":"observed"}\nnot-json\n',
                "utf8",
            )
            const events = await readSolverGuardrailAudit(workspaceRoot)
            expect(events).toHaveLength(1)
        } finally {
            await rm(workspaceRoot, { recursive: true, force: true })
        }
    })

    test("aggregates and sorts challenge audit records", () => {
        const result = aggregateGuardrailAudit([
            {
                solverId: "solver-b",
                events: [
                    {
                        timestamp: "2026-10-25T00:00:02.000Z",
                        toolName: "bash",
                        decision: "blocked",
                        phase: "enforce",
                    },
                ],
            },
            {
                solverId: "solver-a",
                events: [
                    {
                        timestamp: "2026-10-25T00:00:01.000Z",
                        toolName: "read",
                        decision: "observed",
                        phase: "observe",
                    },
                ],
            },
        ])

        expect(result.events.map((event) => event.timestamp)).toEqual([
            "2026-10-25T00:00:01.000Z",
            "2026-10-25T00:00:02.000Z",
        ])
        expect(result.observed).toBe(1)
        expect(result.blocked).toBe(1)
        expect(result.allowed).toBe(0)
    })
})
