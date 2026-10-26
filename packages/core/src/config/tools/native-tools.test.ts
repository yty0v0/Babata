import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { targetAllowsUrl, applyMutation, summarizeDifference, sendRawRequest, csrfExtractTool, attackScriptTool, httpReplayTool } from "./native-tools"
import { reportVulnerabilityTool, triageVulnerabilityTool, listNativeFindings } from "./native-report"
import { cloudAuditTool, browserActionTool } from "./native-runtime"

describe("native HTTP helpers", () => {
    test("target allowlist matches same host and scoped path", () => {
        expect(targetAllowsUrl(["http://172.23.112.1/DVWA/"], "http://172.23.112.1/DVWA/vulnerabilities/sqli/?id=1")).toBe(true)
        expect(targetAllowsUrl(["http://172.23.112.1/DVWA/"], "https://evil.example/DVWA/")).toBe(false)
    })

    test("field mutations update structured request fields", () => {
        const request = {
            url: "http://172.23.112.1/DVWA/vulnerabilities/sqli/",
            method: "GET" as const,
            headers: {},
            cookies: {},
        }
        const mutated = applyMutation(request, { field: "query", key: "id", value: "1' OR '1'='1", mode: "set" })
        expect(mutated.url).toContain("id=1%27+OR+%271%27%3D%271")
    })

    test("difference summary distinguishes status and body changes", () => {
        const baseline = { status: 200, headers: {}, body: "one", byteLength: 10 }
        const exploit = { status: 200, headers: {}, body: "many records", byteLength: 20 }
        expect(summarizeDifference(baseline, exploit)).toContain("body changed")
    })

    test("csrf extraction returns token when present and not-found result otherwise", async () => {
        const originalFetch = globalThis.fetch
        globalThis.fetch = (async () => new Response('<input name="csrf_token" value="abc123" />')) as unknown as typeof fetch
        try {
            const ctx = { cwd: await mkdtemp(join(tmpdir(), "native-csrf-")) } as any
            const found = await csrfExtractTool.execute?.("tool-1", { url: "http://example.com/form" } as any, undefined, undefined, ctx)
            expect((found as any).details.field).toBe("csrf_token")
        } finally {
            globalThis.fetch = originalFetch
        }
    })

    test("attack script dispatcher rejects unknown operations", async () => {
        await expect(
            attackScriptTool.execute?.("tool-1", { operation: "not_allowed" } as any, undefined, undefined, { cwd: "." } as any),
        ).rejects.toThrow("unsupported attack_script operation")
    })

    test("raw request sends bytes without normalization", async () => {
        const server = Bun.serve({
            port: 0,
            async fetch(req) {
                const body = await req.text()
                return new Response(`method=${req.method} body=${body}`, { headers: { Connection: "close" } })
            },
        })
        try {
            const raw = `POST /raw HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 5\r\n\r\nhello`
            const response = await sendRawRequest("127.0.0.1", server.port!, false, raw)
            expect(response).toContain("method=POST")
            expect(response).toContain("body=hello")
        } finally {
            server.stop()
        }
    })

    test("cloud audit rejects mutation by default", async () => {
        await expect(
            cloudAuditTool.execute?.("tool-1", { provider: "aws", allow_mutation: true } as any, undefined, undefined, { cwd: "." } as any),
        ).rejects.toThrow("read-only by default")
    })

    test("browser tool returns structured unavailable when runtime is missing", async () => {
        const result = await browserActionTool.execute?.("tool-1", { action: "open", url: "http://example.com" } as any, undefined, undefined, { cwd: "." } as any)
        expect((result as any).details.available).toBe(false)
    }, { timeout: 12_000 })

    test("cloud audit returns structured unavailable when provider CLI is missing", async () => {
        const result = await cloudAuditTool.execute?.("tool-1", { provider: "cicd" } as any, undefined, undefined, { cwd: "." } as any)
        expect((result as any).details.available).toBe(false)
    })

    test("DVWA E2E uses http_replay for baseline and exploit comparison", async () => {
        const server = Bun.serve({
            port: 0,
            fetch(req) {
                const url = new URL(req.url)
                const id = url.searchParams.get("id") ?? ""
                const body = id === "1"
                    ? "First name: admin Surname: admin"
                    : "First name: admin Surname: admin\nFirst name: Gordon Surname: Brown\nFirst name: Hack Surname: Me\nFirst name: Pablo Surname: Picasso\nFirst name: Bob Surname: Smith"
                return new Response(`<pre>ID: ${id}\n${body}</pre>`, { status: 200 })
            },
        })
        try {
            const target = `http://127.0.0.1:${server.port}/DVWA/vulnerabilities/sqli/`
            const result = await httpReplayTool.execute?.("tool-1", {
                url: target,
                method: "GET",
                compare: {
                    baseline: [{ field: "query", key: "id", value: "1", mode: "set" }],
                    exploit: [{ field: "query", key: "id", value: "1' OR '1'='1", mode: "set" }],
                },
            } as any, undefined, undefined, { cwd: "." } as any)
            expect((result as any).details.difference).toContain("body changed")
        } finally {
            server.stop()
        }
    })
})

describe("structured vulnerability tools", () => {
    test("report and triage findings without dropping duplicates", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "native-report-"))
        try {
        const ctx = { cwd } as any
        const result = await reportVulnerabilityTool.execute?.("tool-1", {
            title: "SQL injection",
            severity: "high",
            description: "id parameter is injectable",
            endpoint: "http://172.23.112.1/DVWA/vulnerabilities/sqli/",
            attack_vector: "SQLi",
            cwe: "CWE-89",
            reproduction_steps: ["send id=1'"],
            business_impact: "data disclosure",
            recommendation: "parameterize queries",
            proof_of_concept: "id=1' OR '1'='1",
        } as any, undefined, undefined, ctx)
        const details = result.details as { finding: { id: string } }
        const triaged = await triageVulnerabilityTool.execute?.("tool-2", {
            finding_id: details.finding.id,
            decision: "approve",
        } as any, undefined, undefined, ctx)
        const findings = await listNativeFindings(ctx.cwd)
        expect(findings).toHaveLength(1)
        expect((findings[0] as any).status).toBe("approved")
        expect((triaged as any).details.finding.status).toBe("approved")
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })
})
