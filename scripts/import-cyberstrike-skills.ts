import { mkdir, readFile, readdir, stat, writeFile } from "fs/promises"
import { fileURLToPath } from "url"
import { basename, dirname, relative, resolve, sep } from "path"
import {
    CURATED_SKILL_MANIFEST,
    FRAMEWORK_MAP_SOURCES,
} from "../packages/core/src/config/skills/skill-manifest.ts"
import type { CuratedSkillEntry, FrameworkMapSource } from "../packages/core/src/config/skills/skill-manifest.ts"

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const builtinSkillsDir = resolve(projectRoot, "packages/core/src/config/skills/builtin")
const defaultCyberStrikeRoot = resolve(projectRoot, "..", "..", "CyberStrike-main")
const cyberStrikeRoot = resolve(process.env.CYBERSTRIKE_SOURCE_ROOT ?? defaultCyberStrikeRoot)

interface FrameworkMapEntry {
    id: string
    title: string
    path: string
}

function toPlatformPath(value: string): string {
    return value.replaceAll("/", sep)
}

function targetSkillName(target: string): string {
    return basename(dirname(target))
}

function rewriteSkillName(content: string, name: string): string {
    return content.replace(/^name:\s*.*$/m, `name: ${name}`)
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path)
        return true
    } catch {
        return false
    }
}

async function listSkillFiles(root: string): Promise<string[]> {
    const result: string[] = []

    async function walk(dir: string) {
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
        for (const entry of entries) {
            if (entry.name.startsWith(".") || entry.name === "node_modules") continue
            const fullPath = resolve(dir, entry.name)
            if (entry.isDirectory()) {
                await walk(fullPath)
                continue
            }
            if (entry.name === "SKILL.md") result.push(fullPath)
        }
    }

    await walk(root)
    return result.sort()
}

async function buildFrameworkMap(root: string): Promise<FrameworkMapEntry[]> {
    const files = await listSkillFiles(root)
    return files.map((file) => {
        const relativePath = relative(root, file)
        const directory = basename(dirname(file))
        return {
            id: directory,
            title: directory.replaceAll("_", " "),
            path: relativePath.replaceAll("\\", "/"),
        }
    })
}

export interface ImportCyberStrikeSkillsOptions {
    sourceRoot?: string
    targetDir?: string
    manifest?: CuratedSkillEntry[]
    frameworkSources?: FrameworkMapSource[]
}

export async function copyCuratedSkillEntry(
    entry: CuratedSkillEntry,
    sourceRoot: string,
    targetDir: string,
    summary: { created: number; skipped: number; errors: string[] },
) {
    const sourcePath = resolve(sourceRoot, toPlatformPath(entry.source))
    const targetPath = resolve(targetDir, toPlatformPath(entry.target))

    if (!(await pathExists(sourcePath))) {
        summary.errors.push(`missing source: ${entry.source}`)
        return
    }

    if (await pathExists(targetPath)) {
        summary.skipped += 1
        return
    }

    await mkdir(dirname(targetPath), { recursive: true })
    let content = await readFile(sourcePath, "utf-8")
    content = rewriteSkillName(content, targetSkillName(entry.target))
    await writeFile(targetPath, content)
    summary.created += 1
}

export async function importCyberStrikeSkills(options: ImportCyberStrikeSkillsOptions = {}) {
    const sourceRoot = options.sourceRoot ?? cyberStrikeRoot
    const targetDir = options.targetDir ?? builtinSkillsDir
    const manifest = options.manifest ?? CURATED_SKILL_MANIFEST
    const frameworkSources = options.frameworkSources ?? FRAMEWORK_MAP_SOURCES
    const summary = { created: 0, skipped: 0, frameworks: 0, errors: [] as string[] }

    for (const entry of manifest) {
        await copyCuratedSkillEntry(entry, sourceRoot, targetDir, summary)
    }

    for (const source of frameworkSources) {
        const root = resolve(sourceRoot, toPlatformPath(source.root))
        const targetPath = resolve(targetDir, toPlatformPath(source.target))

        if (!(await pathExists(root))) {
            summary.errors.push(`missing framework source: ${source.root}`)
            continue
        }

        const map = await buildFrameworkMap(root)
        await mkdir(dirname(targetPath), { recursive: true })
        await writeFile(targetPath, JSON.stringify(map, null, 2))
        summary.frameworks += map.length
    }

    return summary
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/import-cyberstrike-skills.ts")) {
    const result = await importCyberStrikeSkills()
    console.log(JSON.stringify(result, null, 2))
}
