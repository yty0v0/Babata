import { test, expect } from "bun:test"
import { readFile } from "fs/promises"
import { resolve } from "path"
import { generateBuiltinAssets } from "./generate-builtin-assets"

const projectRoot = resolve(import.meta.dir, "..")
const generatedPath = resolve(projectRoot, "packages/core/src/config/builtin-assets.generated.ts")

test("generated assets include curated skills and evidence prompt", async () => {
    await generateBuiltinAssets()
    const content = await readFile(generatedPath, "utf-8")

    expect(content).toContain("skills/builtin/attack-ssrf/SKILL.md")
    expect(content).toContain("skills/builtin/wstg-injection/SKILL.md")
    expect(content).toContain("prompts/builtin/PENTEST_EVIDENCE.md")
})

test("generated assets index framework maps without embedding full framework trees", async () => {
    await generateBuiltinAssets()
    const content = await readFile(generatedPath, "utf-8")

    expect(content).toContain("skills/builtin/frameworks-mitreattack.json")
    expect(content).toContain("skills/builtin/frameworks-cis.json")
    expect(content).toContain("skills/builtin/frameworks-nist.json")
    expect(content).not.toContain(".cyberstrike/skill/CIS_benchmarks/")
})
