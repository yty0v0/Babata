import type { TaricHostSettings } from "../config/types"

export type GovernanceReadinessStatus = "implemented" | "partial" | "blocked"

export interface GovernanceCapabilityReadiness {
    id: string
    status: GovernanceReadinessStatus
    tasks: readonly { id: string; status: GovernanceReadinessStatus | "complete" }[]
    summary: string
    supportNeeded?: string
}

export interface AuthorizedGovernanceReadiness {
    format: "breachweave-authorized-governance-readiness/1"
    generatedAt: string
    status: "partial" | "blocked"
    deployment: {
        taricEnabled: boolean
        profile: NonNullable<TaricHostSettings["profile"]> | "unconfigured"
        engagementBoundary: NonNullable<TaricHostSettings["engagementBoundary"]>
        projectBoundAuthorityReady: false
    }
    capabilities: readonly GovernanceCapabilityReadiness[]
}

const CAPABILITIES: readonly GovernanceCapabilityReadiness[] = [
    {
        id: "project_engagement_isolation",
        status: "partial",
        tasks: [{ id: "3.3", status: "partial" }, { id: "3.4", status: "blocked" }],
        summary: "Shared Engagement with host-derived project filtering is supported for local development.",
        supportNeeded: "Project-bound Engagements and credential lifecycle for a future multi-tenant deployment.",
    },
    {
        id: "scope_egress_enforcement",
        status: "partial",
        tasks: [{ id: "4.2", status: "partial" }, { id: "4.3", status: "partial" }, { id: "4.4", status: "complete" }],
        summary: "Local scope evaluation is available; connection-time network enforcement is a separate deployment hardening step.",
        supportNeeded: "Optional host egress proxy/firewall for deployments that require network-level scope enforcement.",
    },
    {
        id: "workrun_scheduler",
        status: "partial",
        tasks: [{ id: "5.1", status: "partial" }, { id: "5.2", status: "partial" }, { id: "5.7", status: "complete" }],
        summary: "Local single-worker workflow helpers are available; scheduler and solver dispatch integration remains in progress.",
        supportNeeded: "Optional scheduler and durable lease integration for multi-worker deployments.",
    },
    {
        id: "artifact_evidence",
        status: "partial",
        tasks: [{ id: "5.3", status: "partial" }, { id: "5.4", status: "partial" }],
        summary: "Local encrypted artifact helpers are available; metadata recovery and end-to-end evidence linkage are in progress.",
        supportNeeded: "Complete local metadata recovery and capture linkage; retention automation can be added when needed.",
    },
    {
        id: "coverage_report",
        status: "partial",
        tasks: [{ id: "5.5", status: "complete" }, { id: "5.6", status: "partial" }],
        summary: "Host coverage recording and gate helpers exist, but approved manifest generation and report snapshots are not connected to the authorized project workflow.",
        supportNeeded: "An approved versioned manifest and authoritative gate/read_seq contract that can bind report digests to the same manifest, Scope, Resource, and coverage snapshot.",
    },
    {
        id: "review_close_recovery",
        status: "partial",
        tasks: [{ id: "6.1", status: "partial" }, { id: "6.2", status: "partial" }, { id: "6.3", status: "partial" }, { id: "6.4", status: "partial" }, { id: "6.5", status: "complete" }],
        summary: "Host actor review, admission, local close, and checkpoint helpers are available; API exposure and durable restart recovery are in progress.",
        supportNeeded: "Expose the local workflow API; durable authority-backed recovery is optional hardening.",
    },
    {
        id: "controlled_evaluation",
        status: "partial",
        tasks: [{ id: "7.2", status: "partial" }, { id: "7.3", status: "partial" }, { id: "7.5", status: "partial" }],
        summary: "Local smoke observations are supported; paired outcome evaluation is optional and has not been run.",
        supportNeeded: "Controlled repeated trials only when making comparative outcome claims.",
    },
]

/** Report implementation boundaries without implying that local helpers are an active governance workflow. */
export function buildAuthorizedGovernanceReadiness(input: {
    taric?: TaricHostSettings
    now?: Date
} = {}): AuthorizedGovernanceReadiness {
    return {
        format: "breachweave-authorized-governance-readiness/1",
        generatedAt: (input.now ?? new Date()).toISOString(),
        status: input.taric?.enabled === true && (input.taric.engagementBoundary ?? "shared_development") === "shared_development" ? "partial" : "blocked",
        deployment: {
            taricEnabled: input.taric?.enabled === true,
            profile: input.taric?.profile ?? "unconfigured",
            engagementBoundary: input.taric?.engagementBoundary ?? "shared_development",
            projectBoundAuthorityReady: false,
        },
        capabilities: CAPABILITIES,
    }
}
