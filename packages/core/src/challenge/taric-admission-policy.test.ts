import { describe, expect, test } from "bun:test"
import { taricDefaultAdmissionPolicyDigest } from "./taric-admission-policy"

describe("Taric admission policy", () => {
    test("default policy digest is stable", () => {
        const first = taricDefaultAdmissionPolicyDigest()
        const second = taricDefaultAdmissionPolicyDigest()
        expect(first).toBe(second)
        expect(first).toMatch(/^sha256:[0-9a-f]{64}$/)
    })
})
