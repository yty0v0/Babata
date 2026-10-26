import { readdir } from "fs/promises"
import { join, relative, resolve } from "path"

const root = resolve(import.meta.dir, "../packages/core/src")
const pattern = /from\s+["'](\.[^"']*\/)["']/g

async function collectFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) files.push(...await collectFiles(path))
        else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(path)
    }
    return files
}

const failures: string[] = []
for (const file of await collectFiles(root)) {
    const text = await Bun.file(file).text()
    for (const match of text.matchAll(pattern)) {
        failures.push(`${relative(root, file)}: directory import ${match[1]}`)
    }
}

if (failures.length > 0) {
    console.error(failures.join("\n"))
    process.exit(1)
}

console.log("no directory imports found")
