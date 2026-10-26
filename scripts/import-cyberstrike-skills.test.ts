import { test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile, readFile } from "fs/promises"
import { tmpdir } from "os"
import { join, resolve } from "path"
import { importCyberStrikeSkills } from "./import-cyberstrike-skills"

let root: string
let sourceRoot: string
let targetRoot: string

beforeEach(async () => {
    root = await mkdtemp(resolve(tmpdir(), "cyberstrike-import-test-"))
    sourceRoot = resolve(root, "source")
    targetRoot = resolve(root, "target")
    await mkdir(resolve(sourceRoot, "attack-demo"), { recursive: true })
    await writeFile(
        resolve(sourceRoot, "attack-demo", "SKILL.md"),
        "---\nname: attack-demo\ndescription: demo\n---\n# Demo\nOriginal",
    )
})

afterEach(async () => {
    await rm(root, { recursive: true, force: true })
})

test("copies curated skill and skips existing target on rerun", async () => {
    const manifest = [{ source: "attack-demo/SKILL.md", target: "attack-demo/SKILL.md" }]
    const first = await importCyberStrikeSkills({
        sourceRoot,
        targetDir: targetRoot,
        manifest,
        frameworkSources: [],
    })

    expect(first.created).toBe(1)
    expect(first.skipped).toBe(0)
    expect(first.errors).toEqual([])
    expect(await readFile(resolve(targetRoot, "attack-demo", "SKILL.md"), "utf-8")).toContain("Original")

    const second = await importCyberStrikeSkills({
        sourceRoot,
        targetDir: targetRoot,
        manifest,
        frameworkSources: [],
    })

    expect(second.created).toBe(0)
    expect(second.skipped).toBe(1)
    expect(await readFile(resolve(targetRoot, "attack-demo", "SKILL.md"), "utf-8")).toContain("Original")
})

test("reports missing manifest sources", async () => {
    const result = await importCyberStrikeSkills({
        sourceRoot,
        targetDir: targetRoot,
        manifest: [{ source: "missing/SKILL.md", target: "missing/SKILL.md" }],
        frameworkSources: [],
    })

    expect(result.created).toBe(0)
    expect(result.errors).toEqual(["missing source: missing/SKILL.md"])
})

test("rewrites skill name to target directory name", async () => {
    await importCyberStrikeSkills({
        sourceRoot,
        targetDir: targetRoot,
        manifest: [{ source: "attack-demo/SKILL.md", target: "renamed-demo/SKILL.md" }],
        frameworkSources: [],
    })

    const content = await readFile(resolve(targetRoot, "renamed-demo", "SKILL.md"), "utf-8")
    expect(content).toContain("name: renamed-demo")
})
