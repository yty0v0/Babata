import { describe, expect, test } from "bun:test"

const BASE_URL = "http://127.0.0.1:3000"
const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiYjY1NWFmOS02MzgxLTRlMjItOWExNy1iMThiMDI2YTZkZTAiLCJ1c2VybmFtZSI6Imd1YXJkcmFpbF9kdndhXzE3OTI5MTY1NzYiLCJpYXQiOjE3OTI5MTY1NzcsImV4cCI6MTc5MzUyMTM3N30.MFYUJQYNmXEXgHzMgzrLNSR1YHiMo4X7w2LyxWqPwgU"

async function fetchJson(path: string) {
    const response = await fetch(`${BASE_URL}${path}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
    })
    return response
}

describe("guardrail audit API", () => {
    test("missing challenge returns 404", async () => {
        const response = await fetchJson("/api/challenges/does-not-exist/guardrail-audit")
        expect(response.status).toBe(404)
    })

    test("existing challenge returns audit summary", async () => {
        const response = await fetchJson("/api/challenges/dd3ac1a8/guardrail-audit")
        expect(response.status).toBe(200)
        const body = await response.json()
        expect(typeof body.observed).toBe("number")
        expect(typeof body.blocked).toBe("number")
        expect(Array.isArray(body.events)).toBe(true)
    })
})
