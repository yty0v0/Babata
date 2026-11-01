import { describe, expect, test } from "bun:test"

// This is an opt-in deployed-server integration test. Do not silently bind it
// to whichever application happens to be running on localhost:3000.
const BASE_URL = process.env.BW_GUARDRAIL_API_URL
const TOKEN = process.env.BW_GUARDRAIL_API_TOKEN
const CHALLENGE_ID = process.env.BW_GUARDRAIL_CHALLENGE_ID
const integrationConfigured = Boolean(BASE_URL && TOKEN && CHALLENGE_ID)

async function fetchJson(path: string) {
    return fetch(`${BASE_URL}${path}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
    })
}

describe.skipIf(!integrationConfigured)("guardrail audit API integration", () => {
    test("missing challenge returns 404", async () => {
        const response = await fetchJson("/api/challenges/does-not-exist/guardrail-audit")
        expect(response.status).toBe(404)
    })

    test("existing challenge returns audit summary", async () => {
        const response = await fetchJson(`/api/challenges/${encodeURIComponent(CHALLENGE_ID!)}/guardrail-audit`)
        expect(response.status).toBe(200)
        const body = await response.json()
        expect(typeof body.observed).toBe("number")
        expect(typeof body.blocked).toBe("number")
        expect(Array.isArray(body.events)).toBe(true)
    })
})
