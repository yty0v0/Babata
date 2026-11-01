import { describe, expect, mock, test } from "bun:test"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { HostBridgeError, serializeHostBridgeError } from "./host-bridge-types"
import { HostBridgeSecurityPolicy, HOST_BRIDGE_ROLE_ACTIONS, assertTaricScope } from "./host-bridge-security"
import type { SolverInstance, SolverRole } from "../runtime/types"

function createSolver(role: SolverRole | undefined): SolverInstance {
    return {
        id: "solver-a",
        containerId: "container-a",
        name: "container-a",
        promptName: "prompt-a",
        task: "task",
        role,
        challengeId: "chal-1",
        status: "running",
        createdAt: 0,
    }
}

function createRequest(solver: SolverInstance | undefined, action: "challenge_get_state" | "challenge_submit_report" = "challenge_get_state") {
    return {
        requestId: "request-1",
        solver,
        solverId: solver?.id ?? "solver-a",
        action,
        params: {},
        challengeId: solver?.challengeId,
    }
}

async function createAuditPath(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "host-bridge-security-"))
    return join(dir, "audit.jsonl")
}

describe("host bridge security", () => {
    test("role action matrix separates planner, executor, and observer", () => {
        expect(HOST_BRIDGE_ROLE_ACTIONS.planner.has("challenge_submit_report")).toBe(false)
        expect(HOST_BRIDGE_ROLE_ACTIONS.executor.has("challenge_submit_report")).toBe(true)
        expect(HOST_BRIDGE_ROLE_ACTIONS.observer.has("challenge_submit_report")).toBe(false)
        expect(HOST_BRIDGE_ROLE_ACTIONS.observer.has("taric_proposal_submit")).toBe(true)
        expect(HOST_BRIDGE_ROLE_ACTIONS.observer.has("taric_board_query")).toBe(true)
        expect(HOST_BRIDGE_ROLE_ACTIONS.observer.has("challenge_memory_add")).toBe(false)
        expect(HOST_BRIDGE_ROLE_ACTIONS.observer.has("challenge_idea_add")).toBe(false)
    })

    test("rejects solver without active role and writes denial audit", async () => {
        const auditPath = await createAuditPath()
        const policy = new HostBridgeSecurityPolicy({ auditLogPath: auditPath, requestsPerMinute: 100 })
        const solver = createSolver(undefined)
        let caught: unknown
        try {
            await policy.execute(createRequest(solver), async () => "value")
        } catch (error) {
            caught = error
        }
        expect(caught).toBeInstanceOf(HostBridgeError)
        expect((caught as HostBridgeError).code).toBe("authorization_error")
        const audit = JSON.parse((await readFile(auditPath, "utf8")).trim())
        expect(audit).toMatchObject({
            solver_id: "solver-a",
            role: null,
            status: "denied",
            outcome: "authorization_error",
            error_code: "authorization_error",
        })
    })

    test("rejects planner escalation to executor-only action", async () => {
        const auditPath = await createAuditPath()
        const policy = new HostBridgeSecurityPolicy({ auditLogPath: auditPath, requestsPerMinute: 100 })
        const solver = createSolver("planner")
        let caught: unknown
        try {
            await policy.execute(createRequest(solver, "challenge_submit_report"), async () => "value")
        } catch (error) {
            caught = error
        }
        expect((caught as HostBridgeError).code).toBe("authorization_error")
    })

    test("rejects oversized params before invoking handler", async () => {
        const auditPath = await createAuditPath()
        const policy = new HostBridgeSecurityPolicy({ auditLogPath: auditPath, requestByteLimit: 8 })
        const handler = mock(async () => "value")
        const solver = createSolver("executor")
        let caught: unknown
        try {
            await policy.execute({ ...createRequest(solver), params: { text: "1234567890" } }, handler)
        } catch (error) {
            caught = error
        }
        expect(handler).not.toHaveBeenCalled()
        expect((caught as HostBridgeError).code).toBe("validation_error")
    })

    test("rejects rate limit and writes audit", async () => {
        const auditPath = await createAuditPath()
        const policy = new HostBridgeSecurityPolicy({ auditLogPath: auditPath, requestsPerMinute: 1 })
        const solver = createSolver("executor")
        await policy.execute(createRequest(solver), async () => "first")
        let caught: unknown
        try {
            await policy.execute({ ...createRequest(solver), requestId: "request-2" }, async () => "second")
        } catch (error) {
            caught = error
        }
        expect((caught as HostBridgeError).code).toBe("rate_limited")
    })

    test("normalizes timeout as typed error", async () => {
        const auditPath = await createAuditPath()
        const policy = new HostBridgeSecurityPolicy({ auditLogPath: auditPath, timeoutMs: 5 })
        const solver = createSolver("executor")
        let caught: unknown
        try {
            await policy.execute(createRequest(solver), async () => {
                await Bun.sleep(100)
                return "late"
            })
        } catch (error) {
            caught = error
        }
        expect((caught as HostBridgeError).code).toBe("timeout")
        const lines = (await readFile(auditPath, "utf8")).trim().split("\n")
        expect(JSON.parse(lines.at(-1)!)).toMatchObject({ outcome: "timeout", error_code: "timeout" })
    })

    test("rejects cross-engagement and inactive challenge bindings", () => {
        const binding = {
            challenge_id: "chal-1",
            engagement_id: "engagement-1",
            status: "active" as const,
        }
        expect(() => assertTaricScope({ challengeId: "chal-1", engagementId: "engagement-1", binding })).not.toThrow()
        expect(() => assertTaricScope({ challengeId: "chal-2", engagementId: "engagement-1", binding })).toThrow(HostBridgeError)
        expect(() => assertTaricScope({ challengeId: "chal-1", engagementId: "engagement-2", binding })).toThrow(HostBridgeError)
        expect(() => assertTaricScope({ challengeId: "chal-1", engagementId: "engagement-1", binding: { ...binding, status: "pending", engagement_id: undefined } })).toThrow(HostBridgeError)
    })

    test("serializes typed errors without leaking stack traces", () => {
        const error = new HostBridgeError("authorization_error", "action is not allowed")
        expect(serializeHostBridgeError(error)).toBe('{"code":"authorization_error","message":"action is not allowed"}')
    })
})
