export interface AddResult {
    id: string
    rejected?: string
}

export interface HostRuntimeSettings {
    image?: string
    env?: Record<string, string>
    solverEnv?: Record<string, string>
    binds?: string[]
    maxSolvers?: number
    networkMode?: "bridge" | "host"
}

export interface HostPlannerSettings {
    tickIntervalMs?: number
    staleTimeoutMs?: number
}

export interface HostAuthSettings {
    registrationEnabled?: boolean
    jwtSecret?: string
}

export interface HostBridgeSecuritySettings {
    auditLogPath?: string
    requestByteLimit?: number
    requestsPerMinute?: number
    concurrentRequests?: number
    timeoutMs?: number
}

export interface HostTaricSettings {
    /** Project-scoped Taric integration settings; existing sidecar configuration remains supported. */
    enabled?: boolean
    engagementBoundary?: "shared_development" | "project_bound"
    authorityPath?: "host" | "model_proposal"
    hostPrincipalId?: string
    modelPrincipalId?: string
    profile?: "embedded_bun" | "authenticated_proxy"
    gatewayTransport?: "https" | "tls_tcp"
    gatewayUrl?: string
    gatewayHost?: string
    gatewayPort?: number
    gatewayPath?: string
    gatewayCaFile?: string
    gatewayTokenEnv?: string
    gatewayHostTokenEnv?: string
    gatewayModelTokenEnv?: string
    gatewayOperatorTokenEnv?: string
    gatewayOperatorPrincipalId?: string
    gatewayTimeoutMs?: number
    gatewayServerName?: string
    hostTokenEnv?: string
    modelTokenEnv?: string
    operatorTokenEnv?: string
    apiContractVersion?: string
    schemaVersion?: string
    coreVersion?: string
    storageContract?: string
    policyVersion?: string
    policyDigest?: string
    bunDriverPackage?: string
    bunDriverVersion?: string
    bunDriverIntegrity?: string
    verificationRequired?: boolean
    verificationReportPath?: string
    outboxPath?: string
    outboxMaxBytes?: number
    outboxMaxEvents?: number
    localCliPath?: string
    authoritativeLifecycle?: boolean
    image?: string
    imageDigest?: string
    requireImageDigest?: boolean
    volume?: string
    sidecarPort?: number
    readBoard?: {
        enabled?: boolean
        baseUrl?: string
        token?: string
        requestTimeoutMs?: number
        /** Test-only in-process dispatcher override. */
        dispatcher?: (input: {
            operation: "context.query" | "resource.query" | "evidence.query"
            request: Record<string, unknown>
            solverId: string
            role: "planner" | "executor" | "observer" | "reviewer"
        }) => Promise<{ ok: boolean; data?: unknown; error?: { code?: string; message?: string } }>
    }
    proposal?: {
        enabled?: boolean
        admissionMode?: "hitl_l1" | "auto_l1" | "disabled"
        outboxDir?: string
        /** Test-only dispatcher override. */
        dispatcher?: (entry: unknown) => Promise<{ ok: boolean; data?: unknown; error?: { code?: string; message?: string } }>
    }
    artifact?: {
        maxInlineBytes?: number
        retentionDays?: number
        redactText?: boolean
        backupDir?: string
    }
}

export type TaricHostSettings = HostTaricSettings

export interface HostGuardrailSettings {
    enabled?: boolean
    phase?: "observe" | "enforce"
    auditLogPath?: string
}

export interface HostSettings {
    runtime: HostRuntimeSettings
    planner: HostPlannerSettings
    auth: HostAuthSettings
    hostBridge?: HostBridgeSecuritySettings
    taric?: HostTaricSettings
    guardrail?: HostGuardrailSettings
}
