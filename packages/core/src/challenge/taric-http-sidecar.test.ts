import { afterEach, describe, expect, mock, test } from "bun:test"
import { createDockerTaricReadDispatcher, isTaricReadOperation, taricCliPrincipalRole, toTaricCliOperation, TaricHttpSidecar } from "./taric-http-sidecar"

afterEach(async () => {
    // Sidecar instances in these tests stop themselves in each test.
})

describe("Taric HTTP sidecar", () => {
    test("maps host read capabilities to the pinned Taric CLI contract", () => {
        expect(toTaricCliOperation("context.query")).toBe("context.query")
        expect(toTaricCliOperation("resource.query")).toBe("query")
        expect(toTaricCliOperation("evidence.query")).toBe("query")
        expect(taricCliPrincipalRole("context.query")).toBe("model")
        expect(taricCliPrincipalRole("resource.query")).toBe("operator")
        expect(taricCliPrincipalRole("evidence.query")).toBe("operator")
    })

    test("exposes loopback health and rejects invalid token", async () => {
        const dispatcher = mock(async () => ({ ok: true, data: {} }))
        const sidecar = new TaricHttpSidecar({ dispatcher, token: "test-sidecar-token" })
        await sidecar.start()
        try {
            const health = await fetch(`http://127.0.0.1:${sidecar.port}/health`)
            expect(health.status).toBe(200)
            expect(await health.json()).toMatchObject({ ok: true, data: { service: "taric-read-sidecar" } })

            const invalidToken = await fetch(`http://127.0.0.1:${sidecar.port}/context.query`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-tch-sidecar-token": "wrong-token",
                    "x-tch-solver-id": "solver-a",
                    "x-tch-solver-role": "executor",
                },
                body: JSON.stringify({ engagement_id: "engagement-1" }),
            })
            expect(invalidToken.status).toBe(401)
            expect(await invalidToken.json()).toMatchObject({ ok: false, error: { code: "authorization_error" } })
            expect(dispatcher).not.toHaveBeenCalled()
        } finally {
            sidecar.stop()
        }
    })

    test("allows only model read operations", () => {
        expect(isTaricReadOperation("context.query")).toBe(true)
        expect(isTaricReadOperation("resource.query")).toBe(true)
        expect(isTaricReadOperation("evidence.query")).toBe(true)
        expect(isTaricReadOperation("proposal.submit")).toBe(false)
        expect(isTaricReadOperation("host.state")).toBe(false)
        expect(isTaricReadOperation("artifact.content.read")).toBe(false)
    })

    test("rejects unsupported operations and missing host-owned headers", async () => {
        const dispatcher = mock(async () => ({ ok: true, data: {} }))
        const sidecar = new TaricHttpSidecar({ dispatcher, token: "test-sidecar-token" })
        await sidecar.start()
        try {
            const forbidden = await fetch(`http://127.0.0.1:${sidecar.port}/proposal.submit`, {
                method: "POST",
                headers: {
                    "x-tch-sidecar-token": "test-sidecar-token",
                    "x-tch-solver-id": "solver-a",
                    "x-tch-solver-role": "executor",
                },
                body: "{}",
            })
            expect(forbidden.status).toBe(403)
            expect(await forbidden.json()).toMatchObject({ ok: false, error: { code: "authorization_error" } })
            expect(dispatcher).not.toHaveBeenCalled()

            const missingIdentity = await fetch(`http://127.0.0.1:${sidecar.port}/context.query`, {
                method: "POST",
                headers: { "x-tch-sidecar-token": "test-sidecar-token" },
                body: "{}",
            })
            expect(missingIdentity.status).toBe(400)
            expect(await missingIdentity.json()).toMatchObject({ ok: false, error: { code: "validation_error" } })
        } finally {
            sidecar.stop()
        }
    })

    test("dispatches scoped reads with host-owned solver identity", async () => {
        const dispatcher = mock(async (input) => {
            expect(input).toMatchObject({
                operation: "context.query",
                solverId: "solver-a",
                role: "observer",
                request: { engagement_id: "engagement-1" },
            })
            return { ok: true, data: { ok: true, read_seq: 3 } }
        })
        const sidecar = new TaricHttpSidecar({ dispatcher, token: "test-sidecar-token" })
        await sidecar.start()
        try {
            const response = await fetch(`http://127.0.0.1:${sidecar.port}/context.query`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-tch-sidecar-token": "test-sidecar-token",
                    "x-tch-solver-id": "solver-a",
                    "x-tch-solver-role": "observer",
                },
                body: JSON.stringify({ engagement_id: "engagement-1" }),
            })
            expect(await response.json()).toMatchObject({ ok: true, data: { ok: true, read_seq: 3 } })
            expect(dispatcher).toHaveBeenCalledTimes(1)
        } finally {
            sidecar.stop()
        }
    })
})

test("blocks health and reads when the Taric runtime is not ready", async () => {
    const dispatcher = mock(async () => ({ ok: true, data: {} }))
    const sidecar = new TaricHttpSidecar({
        dispatcher,
        token: "test-sidecar-token",
        readiness: { ready: false, failure: { code: "docker_unavailable", message: "Start Docker Desktop" } },
    })
    await sidecar.start()
    try {
        const health = await fetch(`http://127.0.0.1:${sidecar.port}/health`)
        expect(health.status).toBe(503)
        expect(await health.json()).toMatchObject({ ok: false, error: { code: "docker_unavailable" } })
        const read = await fetch(`http://127.0.0.1:${sidecar.port}/context.query`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-tch-sidecar-token": "test-sidecar-token",
                "x-tch-solver-id": "solver-a",
                "x-tch-solver-role": "executor",
            },
            body: JSON.stringify({ engagement_id: "engagement-1" }),
        })
        expect(read.status).toBe(503)
        expect(await read.json()).toMatchObject({ ok: false, error: { code: "unavailable" } })
        expect(dispatcher).not.toHaveBeenCalled()
    } finally {
        sidecar.stop()
    }
})


test("reflects readiness recovery without replacing the sidecar listener", async () => {
    const dispatcher = mock(async () => ({ ok: true, data: { recovered: true } }))
    let readiness: { ready: boolean; failure?: { code: string; message: string } } = {
        ready: false,
        failure: { code: "docker_unavailable", message: "Start Docker Desktop" },
    }
    const sidecar = new TaricHttpSidecar({
        dispatcher,
        token: "test-sidecar-token",
        readiness: () => readiness,
    })
    await sidecar.start()
    try {
        const port = sidecar.port
        expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(503)
        readiness = { ready: true }
        const health = await fetch(`http://127.0.0.1:${port}/health`)
        expect(health.status).toBe(200)
        const read = await fetch(`http://127.0.0.1:${port}/context.query`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-tch-sidecar-token": "test-sidecar-token",
                "x-tch-solver-id": "solver-a",
                "x-tch-solver-role": "observer",
            },
            body: JSON.stringify({ engagement_id: "engagement-1" }),
        })
        expect(read.status).toBe(200)
        expect(await read.json()).toMatchObject({ ok: true, data: { recovered: true } })
        expect(dispatcher).toHaveBeenCalledTimes(1)
    } finally {
        sidecar.stop()
    }
})


test("coalesces concurrent start calls and adopts the existing listener", async () => {
    const sidecar = new TaricHttpSidecar({
        dispatcher: mock(async () => ({ ok: true, data: {} })),
        token: "test-sidecar-token",
    })
    await Promise.all([sidecar.start(), sidecar.start(), sidecar.start()])
    try {
        const port = sidecar.port
        expect(port).toBeGreaterThan(0)
        expect(sidecar.running).toBe(true)
        await sidecar.start()
        expect(sidecar.port).toBe(port)
    } finally {
        sidecar.stop()
    }
})


test("leaves no half-started listener after a bind failure and can recover", async () => {
    const blocker = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("blocked") })
    const sidecar = new TaricHttpSidecar({
        port: blocker.port,
        dispatcher: mock(async () => ({ ok: true, data: {} })),
        token: "test-sidecar-token",
    })
    try {
        await expect(sidecar.start()).rejects.toThrow()
        expect(sidecar.running).toBe(false)
    } finally {
        blocker.stop()
    }
    await sidecar.start()
    expect(sidecar.running).toBe(true)
    sidecar.stop()
})


test("accepts daemon readiness updates without replacing the sidecar listener", async () => {
    const sidecar = new TaricHttpSidecar({
        dispatcher: mock(async () => ({ ok: true, data: {} })),
        token: "test-sidecar-token",
        readiness: { ready: false, failure: { code: "docker_unavailable", message: "Start Docker Desktop" } },
    })
    await sidecar.start()
    try {
        const port = sidecar.port
        expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(503)
        sidecar.setReadiness({ ready: true })
        expect(sidecar.port).toBe(port)
        expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200)
    } finally {
        sidecar.stop()
    }
})
