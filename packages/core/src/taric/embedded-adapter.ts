import { TARIC_BUN_DRIVER_INTEGRITY, TARIC_BUN_DRIVER_PACKAGE, TARIC_BUN_DRIVER_VERSION, TARIC_COMPATIBILITY_BASELINE, TARIC_PACKAGE_ARTIFACTS } from "./compatibility"
import type { TaricCompatibility, TaricHostBinding, TaricServiceAdapter } from "./types"

interface TaricPrincipal {
    id: string
    role: "model" | "host"
    engagement_id?: string
    capabilities?: readonly string[]
    transport_verified: true
}

interface TaricStore {
    close(): Promise<void>
}

interface TaricCoreService {
    dispatch(operation: string, principal: TaricPrincipal, request: Record<string, unknown>): Promise<unknown>
    close(): Promise<void>
}

interface TaricCoreModule {
    AuthorityStore: new (driver: TaricStore) => TaricStore
    API_CONTRACT_VERSION: string
    AUTHORITY_STORAGE_CONTRACT_VERSION: string
    ADMISSION_POLICY_VERSION: string
    policyDigest(): string
    createCoreService(store: TaricStore, contentRoot?: string): Promise<TaricCoreService>
    createPrincipal(role: "model" | "host", id: string, engagementId?: string): TaricPrincipal
}

interface TaricSchemaModule {
    SCHEMA_VERSION: string
}

interface TaricDriverModule {
    BunSqliteAuthorityDriver: new (filename?: string) => TaricStore
}

export interface EmbeddedTaricAdapterOptions {
    authorityPath: string
    contentRoot?: string
    binding: TaricHostBinding
}

const HOST_OPERATIONS = new Set(["capture.observation", "proposal.list"])

function requiredText(value: string, field: string): string {
    const text = value.trim()
    if (!text) throw new Error(`${field} is required`)
    return text
}

function asError(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value))
}

/**
 * Construct the Bun-native Taric service from the scoped registry dependencies.
 * Dynamic imports keep legacy_local installations usable when Taric is not
 * installed; Taric modes still fail closed in the provider factory.
 */
export async function createEmbeddedTaricServiceAdapter(options: EmbeddedTaricAdapterOptions): Promise<TaricServiceAdapter> {
    const authorityPath = requiredText(options.authorityPath, "authorityPath")
    const hostPrincipalId = requiredText(options.binding.hostPrincipalId, "hostPrincipalId")
    const modelPrincipalId = requiredText(options.binding.modelPrincipalId, "modelPrincipalId")
    const corePackage = "@taric/core"
    const schemaPackage = "@taric/schemas"
    const driverPackage = "@taric/driver-bun-sqlite"

    let store: TaricStore | undefined
    try {
        const [coreValue, schemaValue, driverValue] = await Promise.all([
            import(corePackage),
            import(schemaPackage),
            import(driverPackage),
        ])
        const core = coreValue as unknown as TaricCoreModule
        const schemas = schemaValue as unknown as TaricSchemaModule
        const driver = driverValue as unknown as TaricDriverModule
        store = new core.AuthorityStore(new driver.BunSqliteAuthorityDriver(authorityPath))
        const service = await core.createCoreService(store, options.contentRoot)
        const hostPrincipal = core.createPrincipal("host", hostPrincipalId, options.binding.engagementId)
        const modelPrincipal = core.createPrincipal("model", modelPrincipalId, options.binding.engagementId)
        const compatibility: TaricCompatibility = {
            ...TARIC_COMPATIBILITY_BASELINE,
            apiContractVersion: core.API_CONTRACT_VERSION,
            schemaVersion: schemas.SCHEMA_VERSION,
            storageContract: core.AUTHORITY_STORAGE_CONTRACT_VERSION,
            policyVersion: core.ADMISSION_POLICY_VERSION,
            policyDigest: core.policyDigest(),
            bunDriver: {
                packageName: TARIC_BUN_DRIVER_PACKAGE,
                version: TARIC_BUN_DRIVER_VERSION,
                integrity: TARIC_BUN_DRIVER_INTEGRITY,
            },
        }

        return {
            async getProfile() {
                return { status: "verified", compatibility }
            },
            async getBinding() {
                return { ...options.binding }
            },
            async checkHealth() {
                const response = await service.dispatch("engagement.status", hostPrincipal, { engagement_id: options.binding.engagementId })
                if (!response || typeof response !== "object" || (response as { ok?: unknown }).ok !== true) {
                    const error = response && typeof response === "object" ? (response as { error?: { message?: unknown } }).error : undefined
                    throw new Error(typeof error?.message === "string" ? error.message : "Taric authority health check failed")
                }
            },
            async invoke(operation, request) {
                return service.dispatch(operation, HOST_OPERATIONS.has(operation) ? hostPrincipal : modelPrincipal, request)
            },
            async close() {
                await service.close()
            },
        }
    } catch (error) {
        if (store) await store.close().catch(() => {})
        throw asError(error)
    }
}

export const TARIC_EMBEDDED_DEPENDENCIES = {
    core: TARIC_PACKAGE_ARTIFACTS["@taric/core"],
    schemas: TARIC_PACKAGE_ARTIFACTS["@taric/schemas"],
    driver: TARIC_PACKAGE_ARTIFACTS["@taric/driver-bun-sqlite"],
} as const
