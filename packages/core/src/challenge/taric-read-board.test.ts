import { afterEach, describe, expect, mock, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { HostBridgeError } from "./host-bridge-types"
import { createTaricReadBoardHandler, assertTaricReadResponse, normalizeTaricReadOperation, normalizeTaricReadRequest, sanitizeTaricReadData } from "./taric-read-board"
import { TaricBindingRegistry, type TaricBindingScopeSnapshot } from "./taric-binding-registry"
import type { HostBridgeHandleContext } from "../runtime/types"

const scope: TaricBindingScopeSnapshot = {
    allowed_targets: ["https://example.test"],
    excluded_targets: [],
    rules_of_engagement_ref: "roe:web-001",
}

const tempDirs: string[] = []

async function createBindingRegistry(): Promise<TaricBindingRegistry> {
    const dir = await mkdtemp(join(tmpdir(), "taric-read-board-"))
    tempDirs.push(dir)
    const registry = new TaricBindingRegistry(dir)
    await registry.createPending({ challengeId: "web-001", scope })
    await registry.activate({ challengeId: "web-001", engagementId: "engagement-1", engagementRecordId: "record-1" })
    return registry
}

function createContext(challengeId?: string): HostBridgeHandleContext {
    return {
        solverId: "solver-a",
        action: "taric_board_query",
        params: {},
        getSolverEnvValue: (key: string) => (key === "TCH_CHALLENGE_ID" ? challengeId : undefined),
    }
}

describe("Taric read board", () => {
    test("normalizes allowed operations and removes identity fields", () => {
        expect(normalizeTaricReadOperation("context.query")).toBe("context.query")
        expect(() => normalizeTaricReadOperation("proposal.submit")).toThrow(HostBridgeError)
        const request = normalizeTaricReadRequest({
            engagement_id: "engagement-other",
            principal_id: "fake",
            role: "operator",
            budget: 100,
            page_size: 20,
        })
        expect(request).toEqual({ budget: 100, page_size: 20, include_candidates: true })
    })

    test("defaults to admitted L1 recall but never asks for L0 candidates", () => {
        expect(normalizeTaricReadRequest({ operation: "context.query" })).toMatchObject({ include_candidates: true })
        expect(normalizeTaricReadRequest({ include_candidates: false })).toMatchObject({ include_candidates: false })
    })
    test("bounds model pagination inputs and strips trusted scope filters", () => {
        expect(normalizeTaricReadRequest({
            page_size: 50,
            budget: 100,
            cursor: "cursor-1",
            read_seq: 3,
            filters: { project_id: "attacker-project", engagement_id: "attacker-engagement", status: "open" },
        })).toEqual({
            page_size: 50,
            budget: 100,
            cursor: "cursor-1",
            read_seq: 3,
            filters: { status: "open" },
            include_candidates: true,
        })
        expect(() => normalizeTaricReadRequest({ page_size: 51 })).toThrow(HostBridgeError)
        expect(() => normalizeTaricReadRequest({ budget: 4001 })).toThrow(HostBridgeError)
        expect(() => normalizeTaricReadRequest({ cursor: "x".repeat(513) })).toThrow(HostBridgeError)
    })

    test("requires both outer and inner success", () => {
        assertTaricReadResponse({ ok: true, data: { ok: true, read_seq: 3 } })
        let inner: HostBridgeError | undefined
        try {
            assertTaricReadResponse({ ok: true, data: { ok: false, error: { code: "authorization_error", message: "denied", follow_up: "review" } } })
        } catch (error) {
            inner = error as HostBridgeError
        }
        if (!inner) throw new Error("expected inner Taric failure to throw")
        expect(inner).toBeInstanceOf(HostBridgeError)
        expect(inner.code).toBe("authorization_error")
        expect(inner.details).toMatchObject({ taric_code: "authorization_error", follow_up: "review" })
        expect(() => assertTaricReadResponse({ ok: false, error: { code: "authorization_error", message: "denied" } })).toThrow(HostBridgeError)
    })

    test("returns degraded when disabled or unbound", async () => {
        const handler = createTaricReadBoardHandler({ settings: {} })
        const disabled = await handler.handle({ ...createContext("web-001"), params: { operation: "context.query" } })
        expect(disabled).toMatchObject({ handled: true, data: { degraded: true, reason: "taric_read_board_disabled" } })

        const enabledHandler = createTaricReadBoardHandler({
            settings: { enabled: true, baseUrl: "http://127.0.0.1:39999" },
            bindingRegistry: new TaricBindingRegistry(),
        })
        const unbound = await enabledHandler.handle({ ...createContext(undefined), params: { operation: "context.query" } })
        expect(unbound).toMatchObject({ handled: true, data: { degraded: true, reason: "challenge_taric_binding_unavailable" } })
    })

    test("removes raw artifact and credential fields recursively", () => {
        const result = sanitizeTaricReadData<Record<string, unknown>>({
            read_seq: 3,
            payload: "raw",
            nested: {
                secret: "raw",
                evidence: { content_ref: "taric://artifact", hash: "sha256:test" },
                items: [{ token: "raw", id: "item-1" }],
            },
        })
        expect(result).toEqual({
            read_seq: 3,
            nested: {
                evidence: { content_ref: "taric://artifact", hash: "sha256:test" },
                items: [{ id: "item-1" }],
            },
        })
    })

    test("calls only the allowlisted scoped operation", async () => {
        const bindingRegistry = await createBindingRegistry()
        const fetchImpl = mock(async (url: string, request: RequestInit) => {
            expect(url).toBe("http://127.0.0.1:3999/context.query")
            expect(JSON.parse(String(request.body))).toMatchObject({ engagement_id: "engagement-1", budget: 100 })
            const headers = request.headers as Record<string, string>
            expect(headers["x-tch-sidecar-token"]).toBe("test-sidecar-token")
            expect(headers["x-tch-solver-id"]).toBe("solver-a")
            expect(headers["x-tch-solver-role"]).toBe("executor")
            return new Response(JSON.stringify({ ok: true, data: { ok: true, read_seq: 3, items: [] } }), { status: 200 })
        })
        const handler = createTaricReadBoardHandler({
            settings: { enabled: true, baseUrl: "http://127.0.0.1:3999", token: "test-sidecar-token" },
            bindingRegistry,
            fetchImpl: fetchImpl as unknown as typeof fetch,
        })
        const result = await handler.handle({ ...createContext("web-001"), params: { operation: "context.query", budget: 100 } })
        expect(result.handled).toBe(true)
        expect(result.data).toMatchObject({ read_seq: 3 })
        expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    test("fails closed on stale or unknown projection before issuing a board read", async () => {
        const bindingRegistry = await createBindingRegistry()
        const dispatch = mock(async () => ({ ok: true, data: { ok: true, items: [] } }))
        const base = {
            settings: { enabled: true, baseUrl: "http://127.0.0.1:3999", dispatcher: dispatch },
            bindingRegistry,
        }
        const stale = createTaricReadBoardHandler({
            ...base,
            reconcileEngagement: async () => ({ applied: 0, committedSeq: 10, projectedSeq: 7, pendingOutbox: 3 }),
        })
        const staleResult = await stale.handle({ ...createContext("web-001"), params: { operation: "evidence.query" } })
        expect(staleResult).toMatchObject({
            handled: true,
            data: { degraded: true, reason: "taric_projection_stale", read_diagnostics: { diagnostic_code: "projection_lag", committed_seq: 10, projected_seq: 7, pending_outbox: 3 } },
        })
        expect(dispatch).not.toHaveBeenCalled()

        const unknown = createTaricReadBoardHandler({
            ...base,
            reconcileEngagement: async () => ({ applied: 0, pendingOutbox: 0 }),
        })
        const unknownResult = await unknown.handle({ ...createContext("web-001"), params: { operation: "evidence.query" } })
        expect(unknownResult).toMatchObject({ handled: true, data: { degraded: true, reason: "taric_projection_freshness_unknown" } })
        expect(dispatch).not.toHaveBeenCalled()
    })

    test("requires reconciliation when configured and fails closed if it is unavailable or fails", async () => {
        const bindingRegistry = await createBindingRegistry()
        const dispatch = mock(async () => ({ ok: true, data: { ok: true, items: [] } }))
        const requiredSettings = { enabled: true, requireFreshProjection: true, baseUrl: "http://127.0.0.1:3999", dispatcher: dispatch }
        const missing = createTaricReadBoardHandler({ settings: requiredSettings, bindingRegistry })
        const missingResult = await missing.handle({ ...createContext("web-001"), params: { operation: "evidence.query" } })
        expect(missingResult).toMatchObject({ handled: true, data: { degraded: true, reason: "taric_projection_freshness_unknown", read_diagnostics: { diagnostic_code: "reconciliation_unavailable" } } })

        const failing = createTaricReadBoardHandler({
            settings: requiredSettings,
            bindingRegistry,
            reconcileEngagement: async () => { throw new Error("private failure detail") },
        })
        const failedResult = await failing.handle({ ...createContext("web-001"), params: { operation: "evidence.query" } })
        expect(failedResult).toMatchObject({ handled: true, data: { degraded: true, reason: "taric_projection_stale", read_diagnostics: { diagnostic_code: "reconciliation_failed" } } })
        expect(JSON.stringify(failedResult)).not.toContain("private failure detail")
        expect(dispatch).not.toHaveBeenCalled()
    })

    test("reconciles projection before returning a fresh board result", async () => {
        const bindingRegistry = await createBindingRegistry()
        const dispatch = mock(async () => ({ ok: true, data: { ok: true, read_seq: 10, items: [] } }))
        const reconcileEngagement = mock(async (engagementId: string) => {
            expect(engagementId).toBe("engagement-1")
            return { applied: 3, committedSeq: 10, projectedSeq: 10, pendingOutbox: 0 }
        })
        const handler = createTaricReadBoardHandler({
            settings: { enabled: true, baseUrl: "http://127.0.0.1:3999", dispatcher: dispatch },
            bindingRegistry,
            reconcileEngagement,
        })
        const result = await handler.handle({ ...createContext("web-001"), params: { operation: "evidence.query" } })
        expect(result).toMatchObject({ handled: true, data: { read_seq: 10, items: [] } })
        expect(reconcileEngagement).toHaveBeenCalledTimes(1)
        expect(dispatch).toHaveBeenCalledTimes(1)
    })

    test("opens the circuit breaker after repeated sidecar failures", async () => {
        const bindingRegistry = await createBindingRegistry()
        const fetchImpl = mock(async () => {
            throw new Error("connection refused")
        })
        const handler = createTaricReadBoardHandler({
            settings: { enabled: true, baseUrl: "http://127.0.0.1:3999", token: "test-sidecar-token" },
            bindingRegistry,
            fetchImpl: fetchImpl as unknown as typeof fetch,
        })
        for (let index = 0; index < 3; index += 1) {
            const result = await handler.handle({ ...createContext("web-001"), params: { operation: "context.query" } })
            expect(result).toMatchObject({ handled: true, data: { degraded: true, reason: "taric_read_board_unavailable", diagnostic_code: "sidecar_request_failed" } })
            expect(JSON.stringify(result)).not.toContain("connection refused")
        }
        const openResult = await handler.handle({ ...createContext("web-001"), params: { operation: "context.query" } })
        expect(openResult).toMatchObject({ handled: true, data: { degraded: true, reason: "taric_read_board_circuit_open" } })
        expect(fetchImpl).toHaveBeenCalledTimes(3)
    })
})

afterEach(async () => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop()
        if (!dir) continue
        await rm(dir, { recursive: true, force: true })
    }
})
