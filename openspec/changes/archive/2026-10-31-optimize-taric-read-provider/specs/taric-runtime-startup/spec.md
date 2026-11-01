## ADDED Requirements

### Requirement: Taric runtime is initialized automatically at application startup
The system SHALL initialize the Taric access runtime required by Taric-managed scopes during daemon startup without requiring a manual Taric launch command. Initialization MUST be idempotent and MUST preserve existing authority data and persistent volumes.

#### Scenario: First application startup
- **WHEN** the application starts with Taric-managed scopes configured and Docker Engine is available
- **THEN** it initializes the required sidecar/runtime, validates the persistent Taric volume, and proceeds to readiness verification

#### Scenario: Runtime is already available
- **WHEN** startup finds a valid existing Taric runtime
- **THEN** it safely adopts/reuses that runtime without creating a duplicate listener or resetting authority data

### Requirement: Taric readiness is verified before reporting healthy
The system SHALL verify Docker availability, configured image/digest policy, persistent volume usability, and host-controlled Taric health/readiness with bounded timeouts before reporting Taric as healthy.

#### Scenario: Readiness succeeds
- **WHEN** all required runtime and authority checks succeed
- **THEN** health reports Taric ready and Taric-managed operations may proceed

#### Scenario: Docker or Taric readiness fails
- **WHEN** Docker Engine, image, volume, sidecar, or Taric health check is unavailable or invalid
- **THEN** diagnostics identify the failed prerequisite and Taric-managed operations remain explicitly unavailable/degraded or blocked without local JSON fallback

### Requirement: Application does not manage privileged Docker Engine lifecycle
The application SHALL treat Docker Engine as an external prerequisite and MUST NOT silently install, start, or reconfigure privileged Docker services.

#### Scenario: Docker Engine is stopped
- **WHEN** application startup cannot connect to Docker Engine
- **THEN** it reports an actionable prerequisite diagnostic and does not launch a local persistence substitute
