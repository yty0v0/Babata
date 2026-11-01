import type { TaricCompatibility } from "./types"

export const TARIC_COMPATIBILITY_BASELINE = {
    apiContractVersion: "1.2.0",
    schemaVersion: "1.0.0",
    coreVersion: "1.0.1",
    storageContract: "authority-storage/3",
    policyVersion: "1.0.0",
} as const

export const TARIC_UPSTREAM_COMMIT = "d20c18f2daa97ed75b51218fc3d63e700ea5a8c9"

export const TARIC_DEFAULT_POLICY_DIGEST = "sha256:264736f0b5c561c870f9aa9a94a539123ffe0f80901d98c0944131d0b2a27e13"

export const TARIC_PACKAGE_ARTIFACTS = {
    "@taric/schemas": {
        version: "1.0.1",
        filename: "taric-schemas-1.0.1.tgz",
        integrity: "sha512-esgW5luZ3gBVQV+Iyq9qzjoSZCIs9izZoQpMSdW0Voxtsez5SCU3x8U64HzgiBZkB1GNpe8tTZrHGZ3WKsV61Q==",
    },
    "@taric/core": {
        version: "1.0.1",
        filename: "taric-core-1.0.1.tgz",
        integrity: "sha512-5LdCFqBAxJCIAOzHO39czcvtJ0nhcU6qh0tazkYNrM0GwCpAFci7zPph7rXi7rG+lKvYzcomQ/ioLSQnxeUgGQ==",
    },
    "@taric/driver-bun-sqlite": {
        version: "1.0.1",
        filename: "taric-driver-bun-sqlite-1.0.1.tgz",
        integrity: "sha512-WRkb45Z+Slh0m8na7Z7fDFe+Hiu5X/qqhG/EYJbTnDETMdh8xHpG5Ea4+zd0pS1E9FpsBt1GxPEkJu7JMTnECQ==",
    },
} as const

/** Tarballs packed from the same upstream revision; these are version references, not BreachWeave runtime imports. */
export const TARIC_UPSTREAM_COMPONENT_ARTIFACTS = {
    "@taric/cli": {
        version: "1.0.1",
        filename: "taric-cli-1.0.1.tgz",
        integrity: "sha512-KuT784jnIZ/X7CSUgxAwD0p2dlphTOMUACO2qFvAYpnoTCD5Be/2t7c0ZPeA63E1LZDQYVKTsXlrsvQpL0lSGw==",
    },
    "@taric/mcp": {
        version: "1.0.1",
        filename: "taric-mcp-1.0.1.tgz",
        integrity: "sha512-qTyyprb/+IooX2VOw7n/yXjCyxsyJ4C5dgyKrubnPclxD0Se1TOX2L7Y+YjrYuhGztAJ8CfjKoi7ivqJrccOjg==",
    },
} as const

export const TARIC_BUN_DRIVER_PACKAGE = "@taric/driver-bun-sqlite"
export const TARIC_BUN_DRIVER_VERSION = TARIC_PACKAGE_ARTIFACTS[TARIC_BUN_DRIVER_PACKAGE].version
export const TARIC_BUN_DRIVER_INTEGRITY = TARIC_PACKAGE_ARTIFACTS[TARIC_BUN_DRIVER_PACKAGE].integrity

/**
 * Evidence captured by Taric's isolated clean-consumer run. The report is
 * intentionally represented as data here so validation does not depend on a
 * sibling checkout or a source/workspace path at runtime.
 */
export const TARIC_CLEAN_CONSUMER_PROFILE = {
    reportVersion: "taric-clean-consumer/1",
    sourceCommit: TARIC_UPSTREAM_COMMIT,
    workspaceLinked: false,
    packageImports: true,
    coreStartupAndMigration: true,
    coreCloseAndRestartRead: true,
    cliVersionAndPersistentDatabase: true,
    bunDriverImportAndQuery: true,
    packages: TARIC_PACKAGE_ARTIFACTS,
    limitations: ["Packed from the Taric workspace dist output; this verifies local tarball contents and dependency closure, not registry publication."],
} as const

// Exact pack integrity is known from the clean-consumer report; deployment
// supplies the approved registry URL and token through environment variables.
export const TARIC_ARTIFACT_MANIFEST = {
    status: "clean_consumer_verified",
    sourceCommit: TARIC_UPSTREAM_COMMIT,
    source: "TARIC_REGISTRY_URL",
    evidence: "taric-clean-consumer/1",
    evidenceScope: "locally packed artifacts; not a registry publication or BreachWeave integration claim",
    packages: TARIC_PACKAGE_ARTIFACTS,
    upstreamComponents: TARIC_UPSTREAM_COMPONENT_ARTIFACTS,
    cleanConsumer: TARIC_CLEAN_CONSUMER_PROFILE,
    bunDriver: {
        packageName: TARIC_BUN_DRIVER_PACKAGE,
        version: TARIC_BUN_DRIVER_VERSION,
        integrity: TARIC_BUN_DRIVER_INTEGRITY,
        status: "pinned_internal_registry_required",
    },
    breachWeaveProfile: "not_verified",
} as const

export type TaricReplayPolicy = "idempotent_replay" | "reconcile_before_replay" | "host_only"

export interface TaricOperationContract {
    operation: string
    replayPolicy: TaricReplayPolicy
    transientErrors: readonly string[]
    permanentErrors: readonly string[]
}

/**
 * Host-side copy of the operation contract required by this integration.
 * This is deliberately explicit: a stable client id does not make a
 * non-idempotent Taric operation safe to replay.
 */
export const TARIC_OPERATION_CONTRACTS: readonly TaricOperationContract[] = [
    {
        operation: "proposal.submit",
        replayPolicy: "idempotent_replay",
        transientErrors: ["unavailable_host", "transport_error", "timeout"],
        permanentErrors: ["validation_error", "authorization_error", "forbidden", "conflict", "stale_version"],
    },
    {
        operation: "capture.observation",
        replayPolicy: "reconcile_before_replay",
        transientErrors: ["unavailable_host", "transport_error", "timeout"],
        permanentErrors: ["validation_error", "authorization_error", "forbidden", "conflict"],
    },
    {
        operation: "coverage.record",
        replayPolicy: "idempotent_replay",
        transientErrors: ["unavailable_host", "transport_error", "timeout"],
        permanentErrors: ["validation_error", "authorization_error", "forbidden", "conflict", "stale_version"],
    },
    {
        operation: "work.transition",
        replayPolicy: "idempotent_replay",
        transientErrors: ["unavailable_host", "transport_error", "timeout"],
        permanentErrors: ["validation_error", "authorization_error", "forbidden", "conflict", "stale_version"],
    },
] as const

export function validateTaricOperationContracts(contracts: readonly TaricOperationContract[] = TARIC_OPERATION_CONTRACTS): void {
    const required = new Set(["proposal.submit", "capture.observation", "coverage.record", "work.transition"])
    const seen = new Set<string>()
    for (const contract of contracts) {
        if (!contract.operation.trim() || seen.has(contract.operation)) throw new Error("Taric operation contract names must be unique and non-empty")
        seen.add(contract.operation)
        if (contract.replayPolicy === "idempotent_replay" && contract.operation === "capture.observation") {
            throw new Error("capture.observation cannot use idempotent replay without an authority contract")
        }
        if (contract.replayPolicy === "reconcile_before_replay" && contract.operation !== "capture.observation") {
            throw new Error(`${contract.operation} requires an unsupported reconciliation policy`)
        }
        if (contract.transientErrors.length === 0 || contract.permanentErrors.length === 0) {
            throw new Error(`Taric operation ${contract.operation} must declare transient and permanent errors`)
        }
        if (contract.transientErrors.some((code) => contract.permanentErrors.includes(code))) {
            throw new Error(`Taric operation ${contract.operation} classifies one error as both transient and permanent`)
        }
    }
    for (const operation of required) if (!seen.has(operation)) throw new Error(`Taric operation contract is missing ${operation}`)
}

export function validateTaricArtifactManifest(): void {
    validateTaricOperationContracts()
    const packageNames = Object.keys(TARIC_PACKAGE_ARTIFACTS) as Array<keyof typeof TARIC_PACKAGE_ARTIFACTS>
    for (const packageName of packageNames) {
        const artifact = TARIC_PACKAGE_ARTIFACTS[packageName]
        const cleanConsumerArtifact = TARIC_CLEAN_CONSUMER_PROFILE.packages[packageName]
        if (cleanConsumerArtifact.version !== artifact.version || cleanConsumerArtifact.integrity !== artifact.integrity) {
            throw new Error(`Taric clean-consumer artifact mismatch for ${packageName}`)
        }
        if (artifact.filename.includes("/") || artifact.filename.includes("\\")) {
            throw new Error(`Taric artifact filename must be a package tarball: ${packageName}`)
        }
    }
    if (TARIC_CLEAN_CONSUMER_PROFILE.workspaceLinked) throw new Error("Taric clean consumer must not use workspace links")
    if (!TARIC_CLEAN_CONSUMER_PROFILE.packageImports || !TARIC_CLEAN_CONSUMER_PROFILE.bunDriverImportAndQuery) {
        throw new Error("Taric clean consumer did not verify package resolution")
    }
    for (const [packageName, artifact] of Object.entries(TARIC_UPSTREAM_COMPONENT_ARTIFACTS)) {
        if (!artifact.version.startsWith("1.0.")) throw new Error(`unsupported Taric upstream component version: ${packageName}`)
        if (artifact.filename.includes("/") || artifact.filename.includes("\\") || !artifact.integrity.startsWith("sha512-")) {
            throw new Error(`invalid Taric upstream component artifact: ${packageName}`)
        }
    }
}

export function compareTaricCompatibility(expected: TaricCompatibility, actual: TaricCompatibility): string[] {
    const mismatches: string[] = []
    for (const key of ["apiContractVersion", "schemaVersion", "coreVersion", "storageContract", "policyVersion", "policyDigest"] as const) {
        if (expected[key] !== actual[key]) mismatches.push(`${key} mismatch`)
    }
    for (const key of ["packageName", "version", "integrity"] as const) {
        if (expected.bunDriver[key] !== actual.bunDriver[key]) mismatches.push(`bunDriver.${key} mismatch`)
    }
    return mismatches
}

export function validateExpectedTaricCompatibility(compatibility: TaricCompatibility): void {
    validateTaricArtifactManifest()
    const mismatches = compareTaricCompatibility(
        {
            ...compatibility,
            ...TARIC_COMPATIBILITY_BASELINE,
        },
        compatibility,
    )
    if (mismatches.length > 0) {
        throw new Error(`unsupported Taric contract: ${mismatches.join(", ")}`)
    }
    if (!compatibility.policyDigest.trim()) throw new Error("Taric policyDigest is required")
    if (compatibility.bunDriver.packageName !== TARIC_BUN_DRIVER_PACKAGE) {
        throw new Error(`unsupported Taric Bun driver: ${compatibility.bunDriver.packageName}`)
    }
    if (compatibility.bunDriver.version !== TARIC_BUN_DRIVER_VERSION || compatibility.bunDriver.integrity !== TARIC_BUN_DRIVER_INTEGRITY) {
        throw new Error("Taric Bun driver version and integrity must match the locked artifact manifest")
    }
}
