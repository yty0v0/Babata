import { describe, expect, test } from "bun:test"
import { commandScansOutsideScope, containsWindowsDrivePath } from "./scope-guard"

describe("scope guard path detection", () => {
    test("does not treat URL schemes as Windows drive paths", () => {
        expect(containsWindowsDrivePath("python fetch.py http://172.23.112.1/DVWA/login.php")).toBe(false)
        expect(containsWindowsDrivePath("curl https://example.test/a")).toBe(false)
        expect(containsWindowsDrivePath("python dump.py file:///C:/Windows/win.ini")).toBe(true)
    })

    test("still detects real absolute Windows paths", () => {
        expect(containsWindowsDrivePath('type C:\\Windows\\win.ini')).toBe(true)
        expect(containsWindowsDrivePath("dir D:/data")).toBe(true)
    })

    test("commands that only reference the in-scope URL stay in scope", () => {
        expect(commandScansOutsideScope("python fetch.py http://172.23.112.1/DVWA/login.php")).toBe(false)
        expect(commandScansOutsideScope("echo ok")).toBe(false)
        expect(commandScansOutsideScope("dir C:\\Windows")).toBe(true)
        expect(commandScansOutsideScope("dir /s")).toBe(true)
    })
})
