export { TARIC_ARTIFACT_MANIFEST, TARIC_BUN_DRIVER_INTEGRITY, TARIC_BUN_DRIVER_PACKAGE, TARIC_BUN_DRIVER_VERSION, TARIC_CLEAN_CONSUMER_PROFILE, TARIC_COMPATIBILITY_BASELINE, TARIC_DEFAULT_POLICY_DIGEST, TARIC_OPERATION_CONTRACTS, TARIC_PACKAGE_ARTIFACTS, TARIC_UPSTREAM_COMMIT, TARIC_UPSTREAM_COMPONENT_ARTIFACTS, compareTaricCompatibility, validateExpectedTaricCompatibility, validateTaricArtifactManifest, validateTaricOperationContracts } from "./compatibility"
export type { TaricOperationContract, TaricReplayPolicy } from "./compatibility"
export { createTaricHostModule, TaricHostModule, TARIC_HOST_ONLY_OPERATIONS, TARIC_MODEL_PROPOSAL_OPERATIONS, TARIC_MODEL_QUERY_OPERATIONS } from "./host-module"
export { createEmbeddedTaricServiceAdapter, TARIC_EMBEDDED_DEPENDENCIES } from "./embedded-adapter"
export { createNetworkTaricServiceAdapter } from "./network-adapter"
export { createTaricHostModuleForProject, createTaricMemoryProviderFactory } from "./provider-factory"
export {
    TARIC_LOCAL_GATEWAY_DEFAULT_PORT,
    TARIC_LOCAL_GATEWAY_HOST_TOKEN_ENV,
    TARIC_LOCAL_GATEWAY_MODEL_TOKEN_ENV,
    TARIC_LOCAL_GATEWAY_OPERATOR_TOKEN_ENV,
    TARIC_LOCAL_GATEWAY_SERVER_NAME,
    createLocalTaricEngagement,
    ensureDefaultLocalTaricGateway,
    ensureLocalTaricGateway,
    getLocalTaricGatewayRuntime,
    localGatewayStateDir,
    parseEngagementId,
    pickFreeLoopbackPort,
    resolveTaricCliPath,
    LocalTaricGatewayUnavailableError,
} from "./local-gateway"
export type { EnsureLocalTaricGatewayOptions, LocalEngagementResult, LocalTaricGatewayRuntime } from "./local-gateway"
export type { EmbeddedTaricAdapterOptions } from "./embedded-adapter"
export type { NetworkTaricAdapterOptions, TaricNetworkTransport } from "./network-adapter"
export type { TaricMemoryProviderFactory } from "./provider-factory"
export type {
    TaricAdapterProfile,
    TaricCompatibility,
    TaricHealth,
    TaricHealthStatus,
    TaricHostBinding,
    TaricHostModuleOptions,
    TaricHostObservationInput,
    TaricObservationDto,
    TaricArtifactReferenceDto,
    TaricMemoryMode,
    TaricProposalInput,
    TaricCheckpointProposalInput,
    TaricQueryInput,
    TaricServiceAdapter,
} from "./types"
export { TaricOperationError, TaricUnavailableError } from "./types"
export { EncryptedTaricOutbox, TaricOutbox, TaricOutboxError } from "./outbox"
export { TaricSubscriptionRecovery } from "./outbox"
export { AuthorizedPentestGovernance, GovernanceError, evaluateEgress, validateAuthorizedProjectSetup } from "./governance"
export type {
    ArtifactMetadata,
    AuthorizedPentestGovernanceOptions,
    AuthorizedProjectSetup,
    CheckpointState,
    CloseRequest,
    CoverageCell,
    CoverageGate,
    CoverageStatus,
    EgressRequest,
    GovernanceDiagnostics,
    GovernanceOutcome,
    HostObservationInput,
    ManifestItem,
    PolicyDecision,
    RecoveredWorkRun,
    ReportSnapshot,
    ReviewDecision,
    ReviewVerdict,
    ScopePolicy,
    ScopeTarget,
    TestWindow,
    WorkRun,
    WorkRecoveryLocator,
} from "./governance"
export { buildTaricDiagnostics } from "./diagnostics"
export { buildAuthorizedGovernanceReadiness } from "./governance-readiness"
export type { AuthorizedGovernanceReadiness, GovernanceCapabilityReadiness, GovernanceReadinessStatus } from "./governance-readiness"
export { assertTaricVerificationReport, getTaricArtifactDigests, validateTaricVerificationReport, TARIC_VERIFICATION_CHECKS } from "./verification"
export type { TaricDeploymentProfile, TaricVerificationArtifact, TaricVerificationReport } from "./verification"
export type {
    TaricOutboxEvent,
    TaricOutboxEventStatus,
    TaricOutboxOptions,
    TaricOutboxReplayOptions,
    TaricOutboxReplayResponse,
    TaricOutboxReplayResult,
    TaricOutboxReplaySummary,
    TaricSubscriptionRefresh,
    TaricSubscriptionRefreshReason,
    TaricSubscriptionRefreshResponse,
    TaricSubscriptionRecoveryOptions,
    TaricSubscriptionRecoverySnapshot,
    TaricSubscriptionRecoveryState,
} from "./outbox"
export type { TaricDiagnostic, TaricDiagnosticCode, TaricDiagnosticReport, TaricDiagnosticSeverity, TaricDiagnosticsInput, TaricOutboxDiagnosticInput, TaricSelectedProfile } from "./diagnostics"
export { buildTaricEvaluationReport, validateTaricBenchmarkManifest } from "./evaluation"
export type { EvaluationMode, TaricBenchmarkManifest, TaricEvaluationMetrics, TaricEvaluationReport, TaricRunControls } from "./evaluation"
