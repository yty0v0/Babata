import { describe, expect, test } from "bun:test"
import {
    TARIC_ARTIFACT_MANIFEST,
    TARIC_BUN_DRIVER_INTEGRITY,
    TARIC_BUN_DRIVER_PACKAGE,
    TARIC_BUN_DRIVER_VERSION,
    TARIC_CLEAN_CONSUMER_PROFILE,
    TARIC_COMPATIBILITY_BASELINE,
    TARIC_PACKAGE_ARTIFACTS,
    TARIC_UPSTREAM_COMMIT,
    TARIC_OPERATION_CONTRACTS,
    validateTaricOperationContracts,
    validateTaricArtifactManifest,
} from "./compatibility"

describe("Taric artifact compatibility manifest", () => {
    test("matches the isolated clean-consumer evidence and has no workspace links", () => {
        expect(() => validateTaricArtifactManifest()).not.toThrow()
        expect(TARIC_ARTIFACT_MANIFEST.status).toBe("clean_consumer_verified")
        expect(TARIC_ARTIFACT_MANIFEST.sourceCommit).toBe(TARIC_UPSTREAM_COMMIT)
        expect(TARIC_COMPATIBILITY_BASELINE).toMatchObject({
            apiContractVersion: "1.2.0",
            schemaVersion: "1.0.0",
            coreVersion: "1.0.1",
            storageContract: "authority-storage/3",
        })
        expect(Object.values(TARIC_PACKAGE_ARTIFACTS).every(({ version }) => version === "1.0.1")).toBe(true)
        expect(TARIC_CLEAN_CONSUMER_PROFILE.workspaceLinked).toBe(false)
        expect(TARIC_ARTIFACT_MANIFEST.upstreamComponents["@taric/cli"].version).toBe("1.0.1")
        expect(TARIC_ARTIFACT_MANIFEST.upstreamComponents["@taric/mcp"].version).toBe("1.0.1")
        expect(TARIC_ARTIFACT_MANIFEST.bunDriver).toMatchObject({
            packageName: TARIC_BUN_DRIVER_PACKAGE,
            version: TARIC_BUN_DRIVER_VERSION,
            integrity: TARIC_BUN_DRIVER_INTEGRITY,
        })
    })

    test("locks replay policy and error classes for host operations", () => {
        expect(() => validateTaricOperationContracts()).not.toThrow()
        expect(TARIC_OPERATION_CONTRACTS.find((item) => item.operation === "capture.observation")).toMatchObject({
            replayPolicy: "reconcile_before_replay",
        })
        expect(() => validateTaricOperationContracts(TARIC_OPERATION_CONTRACTS.filter((item) => item.operation !== "capture.observation"))).toThrow("capture.observation")
    })
})
