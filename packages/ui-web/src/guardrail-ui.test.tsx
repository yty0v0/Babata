import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test"
import { cleanup, render, waitFor } from "@testing-library/react"
import { JSDOM } from "jsdom"
import { GuardrailPage } from "./components/config/guardrail"
import { GuardrailAuditContent } from "./components/challenge/guardrail-audit-dialog"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" })

beforeAll(() => {
    globalThis.window = dom.window as unknown as Window & typeof globalThis
    globalThis.document = dom.window.document
    globalThis.navigator = dom.window.navigator
    globalThis.Element = dom.window.Element
    globalThis.Node = dom.window.Node
    globalThis.HTMLElement = dom.window.HTMLElement
    globalThis.SVGElement = dom.window.SVGElement
    globalThis.DocumentFragment = dom.window.DocumentFragment
    globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
    globalThis.MutationObserver = dom.window.MutationObserver
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    globalThis.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    })) as typeof window.matchMedia
})

afterAll(() => {
    cleanup()
})

mock.module("./lib/api", () => ({
    hostSettings: {
        get: async () => ({ guardrail: { enabled: true, phase: "enforce" } }),
        set: async () => {},
    },
    challenges: {
        guardrailAudit: async () => ({
            challengeId: "challenge-1",
            events: [
                {
                    timestamp: "2026-10-25T00:00:00.000Z",
                    solverId: "solver-1",
                    challengeId: "challenge-1",
                    role: "executor",
                    toolName: "bash",
                    ruleId: "bash.sensitive_mutation",
                    decision: "blocked",
                    reason: "command mutates a sensitive path",
                    phase: "enforce",
                },
            ],
            observed: 0,
            blocked: 1,
            allowed: 0,
        }),
    },
}))

describe("guardrail frontend views", () => {
    test("GuardrailPage shows enforcement state", async () => {
        const utils = render(<GuardrailPage />)
        await waitFor(() => expect(utils.getByText("enforcement active")).toBeTruthy())
    })

    test("GuardrailAuditContent shows blocked records", async () => {
        const data = {
            challengeId: "challenge-1",
            events: [
                {
                    timestamp: "2026-10-25T00:00:00.000Z",
                    solverId: "solver-1",
                    challengeId: "challenge-1",
                    role: "executor",
                    toolName: "bash",
                    ruleId: "bash.sensitive_mutation",
                    decision: "blocked" as const,
                    reason: "command mutates a sensitive path",
                    phase: "enforce" as const,
                },
            ],
            observed: 0,
            blocked: 1,
            allowed: 0,
        }
        const utils = render(<GuardrailAuditContent data={data} loading={false} error="" />)
        expect(utils.getAllByText("blocked").length).toBeGreaterThan(0)
        expect(utils.getByText("bash.sensitive_mutation")).toBeTruthy()
    })

    test("GuardrailAuditContent shows empty state", () => {
        const data = { events: [], observed: 0, blocked: 0, allowed: 0 }
        const utils = render(<GuardrailAuditContent data={data} loading={false} error="" />)
        expect(utils.getByText("No guardrail audit records.")).toBeTruthy()
    })
})
