import { existsSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { platform } from "node:process"

if (process.versions.bun) {
    console.error("Run this check through the package script so Playwright uses Node.js: bun run --cwd packages/core test:playwright")
    process.exit(1)
}

const { chromium } = await import("playwright")
const configuredPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
const bundledPath = chromium.executablePath()

function findSystemBrowser() {
    if (platform === "win32") {
        const paths = [
            process.env.PROGRAMFILES && resolve(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
            process.env["PROGRAMFILES(X86)"] && resolve(process.env["PROGRAMFILES(X86)"], "Google/Chrome/Application/chrome.exe"),
            process.env.LOCALAPPDATA && resolve(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
        ].filter(Boolean)

        if (process.env.LOCALAPPDATA) {
            const browsersRoot = resolve(process.env.LOCALAPPDATA, "ms-playwright")
            try {
                const chromiumDirs = readdirSync(browsersRoot, { withFileTypes: true })
                    .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
                    .sort((a, b) => Number(b.name.slice(9)) - Number(a.name.slice(9)))
                paths.push(...chromiumDirs.map((entry) => resolve(browsersRoot, entry.name, "chrome-win64/chrome.exe")))
            } catch {
                // Playwright's browser cache may not exist yet.
            }
        }
        return paths.find(existsSync)
    }

    const paths = platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]
    return paths.find(existsSync)
}

let executablePath
if (configuredPath) {
    executablePath = resolve(configuredPath)
    if (!existsSync(executablePath)) {
        throw new Error(`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH does not exist: ${executablePath}`)
    }
} else if (existsSync(bundledPath)) {
    executablePath = bundledPath
} else {
    executablePath = findSystemBrowser()
    if (!executablePath) {
        throw new Error(`Playwright Chromium is missing (${bundledPath}). Install it with: node node_modules/playwright/cli.js install chromium`)
    }
    console.warn(`Playwright Chromium is missing; falling back to system browser: ${executablePath}`)
}

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000"
const browser = await chromium.launch({ headless: true, executablePath, timeout: 30_000 })
try {
    const page = await browser.newPage()
    const response = await page.goto(baseURL, { waitUntil: "domcontentloaded", timeout: 30_000 })
    if (!response || !response.ok()) {
        throw new Error(`Smoke test failed at ${baseURL}: HTTP ${response?.status() ?? "no response"}`)
    }
    console.log(`Playwright smoke test passed: ${response.status()} ${baseURL} (${browser.version()})`)
} finally {
    await browser.close()
}
