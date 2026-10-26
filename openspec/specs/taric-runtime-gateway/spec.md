# taric-runtime-gateway Specification

## Purpose
TBD - created by archiving change integrate-taric-board. Update Purpose after archive.
## Requirements
### Requirement: Taric runs only in a Linux container
The system SHALL run Taric authority and content services inside a Linux container using Node 22, and MUST NOT run the Taric authority directly on Windows or mount its authority/content directories from NTFS.

#### Scenario: Environment gate succeeds
- **WHEN** the Taric container is built and started with a named volume
- **THEN** `engagement.init`, `context.build`, and `audit.doctor` complete successfully and the authority reports no permission or drift errors

#### Scenario: Windows direct execution is rejected
- **WHEN** Taric authority startup is configured to use a Windows filesystem path
- **THEN** the deployment gate fails before any BreachWeave integration is enabled

### Requirement: Taric data survives container restart
The system SHALL persist Taric authority and content data in a Docker named volume or equivalent Linux filesystem volume, and SHALL preserve engagement state and read sequence across container restarts.

#### Scenario: Restart preserves authority state
- **WHEN** the Taric container is restarted after `engagement.init` and `context.build`
- **THEN** the same engagement can be queried and its read sequence and records remain available

### Requirement: Taric can be disabled and rolled back
The system SHALL provide a `tch.taric.enabled` setting that disables Taric startup, tool registration, and sidecar access without changing existing JSON challenge storage.

#### Scenario: Taric is disabled
- **WHEN** `tch.taric.enabled` is `false`
- **THEN** BreachWeave starts with the existing JSON-only workflow and no Taric tool is exposed to models

### Requirement: Taric image and configuration are pinned
The system SHALL pin the Taric source commit or image digest and SHALL reject startup when the configured image does not match the pinned deployment identity.

#### Scenario: Version drift is detected
- **WHEN** the configured Taric image digest differs from the pinned digest
- **THEN** startup fails with a configuration error and no authority operations are exposed

