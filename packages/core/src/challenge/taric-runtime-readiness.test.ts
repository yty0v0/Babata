import { describe, expect, mock, test } from "bun:test"
import { checkTaricRuntimeReadiness, type TaricRuntimeCommandResult } from "./taric-runtime-readiness"

const success = (stdout = ""): TaricRuntimeCommandResult => ({ exitCode: 0, stdout, stderr: "", timedOut: false })

describe("Taric Docker runtime readiness", () => {
    test("checks daemon, pinned image, persistent volume, and Taric authority without provisioning Docker resources", async () => {
        const run = mock(async (args: string[]) => {
            if (args.includes("info")) return success("27.1.0")
            if (args.includes("image") && args.includes("--format")) return success(JSON.stringify(["taric-p0@sha256:abc"]))
            if (args.includes("image")) return success("sha256:image")
            if (args.includes("volume")) return success("volume-name")
            if (args.includes("audit.doctor")) return success(JSON.stringify({ ok: true, data: { healthy: true } }))
            throw new Error("unexpected command")
        })

        const readiness = await checkTaricRuntimeReadiness({ image: "taric-p0:local", expectedDigest: "sha256:abc", volume: "authority", run })

        expect(readiness).toMatchObject({ ready: true, image: "taric-p0:local", volume: "authority", dockerVersion: "27.1.0" })
        expect(run.mock.calls.map(([args]) => args.slice(1, 3))).toEqual([
            ["info", "--format"],
            ["image", "inspect"],
            ["image", "inspect"],
            ["volume", "inspect"],
            ["run", "--rm"],
        ])
        expect(run.mock.calls.some(([args]) => args.includes("pull") || args.includes("create"))).toBe(false)
        expect(run.mock.calls.at(-1)?.[0]).toContain("authority:/data")
        expect(run.mock.calls.at(-1)?.[0]).not.toContain("authority:/data:ro")
    })

    test("allows SQLite startup writes when running the real authority doctor contract", async () => {
        const run = mock(async (args: string[]) => {
            if (args.includes("info")) return success("27.1.0")
            if (args.includes("image")) return success("sha256:image")
            if (args.includes("volume")) return success("authority")
            if (args.includes("audit.doctor")) {
                // The pinned Taric CLI masks SQLite read-only startup failures as
                // configuration_invalid before the doctor operation is dispatched.
                if (!args.includes("authority:/data")) {
                    return { exitCode: 1, stdout: "", stderr: JSON.stringify({ ok: false, error: { code: "configuration_invalid", message: "invalid authority configuration" } }), timedOut: false }
                }
                return success(JSON.stringify({ ok: true, data: { valid: true } }))
            }
            throw new Error("unexpected command")
        })

        const readiness = await checkTaricRuntimeReadiness({ image: "taric-p0:local", volume: "authority", run })
        expect(readiness.ready).toBe(true)
        expect(run).toHaveBeenCalledTimes(4)
    })

    test("reports Docker unavailability with a bounded actionable diagnostic", async () => {
        const run = mock(async () => ({ exitCode: 1, stdout: "", stderr: "Cannot connect to the Docker daemon", timedOut: false }))
        const readiness = await checkTaricRuntimeReadiness({ image: "taric:local", volume: "authority", run })
        expect(readiness).toMatchObject({ ready: false, failure: { code: "docker_unavailable" } })
        expect(run).toHaveBeenCalledTimes(1)
    })

    test("does not create a missing named volume", async () => {
        const run = mock(async (args: string[]) => {
            if (args.includes("info")) return success("27.1.0")
            if (args.includes("image") && args.includes("--format")) return success(JSON.stringify(["taric-p0@sha256:abc"]))
            if (args.includes("image")) return success("sha256:image")
            if (args.includes("volume")) return { exitCode: 1, stdout: "", stderr: "no such volume", timedOut: false }
            throw new Error("readiness must stop after volume check")
        })
        const readiness = await checkTaricRuntimeReadiness({ image: "taric:local", volume: "missing", run })
        expect(readiness).toMatchObject({ ready: false, failure: { code: "volume_missing" } })
        expect(run).toHaveBeenCalledTimes(3)
    })

    test("rejects a configured digest that does not match the installed image", async () => {
        const run = mock(async (args: string[]) => {
            if (args.includes("info")) return success("27.1.0")
            if (args.includes("image") && args.includes("--format")) return success(JSON.stringify(["taric-p0@sha256:other"]))
            if (args.includes("image")) return success("sha256:image")
            throw new Error("digest mismatch must stop readiness")
        })
        const readiness = await checkTaricRuntimeReadiness({ image: "taric-p0:local", expectedDigest: "sha256:required", volume: "authority", run })
        expect(readiness).toMatchObject({ ready: false, failure: { code: "digest_mismatch" } })
        expect(run).toHaveBeenCalledTimes(3)
    })

    test("reports Taric doctor failure as authority unhealthy", async () => {
        const run = mock(async (args: string[]) => {
            if (args.includes("info")) return success("27.1.0")
            if (args.includes("image") && args.includes("--format")) return success(JSON.stringify(["taric-p0@sha256:abc"]))
            if (args.includes("image")) return success("sha256:image")
            if (args.includes("volume")) return success("authority")
            return { exitCode: 1, stdout: "", stderr: "database integrity check failed", timedOut: false }
        })
        const readiness = await checkTaricRuntimeReadiness({ image: "taric:local", volume: "authority", run })
        expect(readiness).toMatchObject({ ready: false, failure: { code: "authority_unhealthy" } })
    })
})

