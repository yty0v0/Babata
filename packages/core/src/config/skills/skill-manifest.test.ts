import { test, expect } from "bun:test"
import { CURATED_SKILL_MANIFEST, FRAMEWORK_MAP_SOURCES } from "./skill-manifest"

test("curated manifest has no duplicate targets", () => {
    const targets = CURATED_SKILL_MANIFEST.map((entry) => entry.target)
    expect(new Set(targets).size).toBe(targets.length)
})

test("curated manifest targets are SKILL.md files", () => {
    for (const entry of CURATED_SKILL_MANIFEST) {
        expect(entry.source.endsWith("SKILL.md")).toBe(true)
        expect(entry.target.endsWith("SKILL.md")).toBe(true)
    }
})

test("framework map sources target JSON files", () => {
    for (const source of FRAMEWORK_MAP_SOURCES) {
        expect(source.target.endsWith(".json")).toBe(true)
    }
})
