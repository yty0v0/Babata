import http from "node:http"
import { chromium } from "playwright-core"

const port = Number(process.env.PORT || 9223)
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium"
let browser
let context
let page
const capturedRequests = []

function text(value) {
    return typeof value === "string" ? value.slice(0, 6000) : ""
}

async function ensurePage() {
    if (page && !page.isClosed()) return page
    if (!browser) {
        browser = await chromium.launch({
            headless: true,
            executablePath,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        })
    }
    context = await browser.newContext({ ignoreHTTPSErrors: true })
    page = await context.newPage()
    page.on("request", (request) => {
        capturedRequests.push({
            method: request.method(),
            url: request.url(),
            status: 0,
            resourceType: request.resourceType(),
        })
    })
    page.on("response", (response) => {
        const entry = capturedRequests.findLast((item) => item.url === response.url() && item.status === 0)
        if (entry) entry.status = response.status()
    })
    return page
}

async function handleAction(body) {
    const page = await ensurePage()
    if (body.action === "open") {
        await page.goto(body.url, { waitUntil: "domcontentloaded" })
        return {
            text: `opened ${page.url()}`,
            page_state: {
                url: page.url(),
                title: await page.title(),
                text: text(await page.locator("body").innerText().catch(() => "")),
            },
        }
    }
    if (body.action === "snapshot") {
        return {
            text: text(await page.locator("body").innerText().catch(() => "")),
            page_state: {
                url: page.url(),
                title: await page.title(),
                text: text(await page.locator("body").innerText().catch(() => "")),
            },
        }
    }
    if (body.action === "click") {
        await page.locator(body.ref).click()
        return { text: `clicked ${body.ref}` }
    }
    if (body.action === "fill") {
        await page.locator(body.ref).fill(body.value)
        return { text: `filled ${body.ref}` }
    }
    if (body.action === "submit") {
        await page.locator(body.ref).press("Enter")
        return { text: `submitted ${body.ref}` }
    }
    if (body.action === "network") {
        return { text: JSON.stringify(capturedRequests.slice(-100), null, 2), captured_requests: capturedRequests.slice(-100) }
    }
    const screenshot = await page.screenshot({ fullPage: true })
    return { text: `screenshot captured (${screenshot.length} bytes)`, screenshot_bytes: screenshot.length }
}

const server = http.createServer(async (req, res) => {
    res.setHeader("content-type", "application/json")
    if (req.url === "/health") {
        res.end(JSON.stringify({ ok: true }))
        return
    }
    if (req.method !== "POST" || req.url !== "/action") {
        res.statusCode = 404
        res.end(JSON.stringify({ available: false, error: "not found" }))
        return
    }
    let body = ""
    for await (const chunk of req) body += chunk
    try {
        const parsed = JSON.parse(body || "{}")
        const result = await handleAction(parsed)
        res.end(JSON.stringify({ available: true, ...result }))
    } catch (error) {
        res.statusCode = 500
        res.end(JSON.stringify({ available: false, error: error instanceof Error ? error.message : String(error) }))
    }
})

server.listen(port, "127.0.0.1")
