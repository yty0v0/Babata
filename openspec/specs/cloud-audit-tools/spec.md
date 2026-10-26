# cloud-audit-tools Specification

## Purpose
TBD - created by archiving change port-cyberstrike-native-tools. Update Purpose after archive.
## Requirements
### Requirement: Native cloud audit tools

The system SHALL provide native TypeScript tools for AWS, Azure, GCP, Kubernetes, and CI/CD auditing.

#### Scenario: Provider CLI is available
- **WHEN** the required provider CLI and credentials are available
- **THEN** the audit tool returns structured findings

#### Scenario: Provider CLI is missing
- **WHEN** the required provider CLI is not installed
- **THEN** the tool returns a structured unavailable result

### Requirement: Cloud tools are read-only by default

Cloud audit tools SHALL use read-only list, describe, or get operations unless a separate host policy explicitly permits mutation.

#### Scenario: Read-only audit
- **WHEN** the model runs a cloud audit
- **THEN** the tool only issues read-only provider commands

### Requirement: Cloud findings are evidence-ready

Cloud audit results SHALL include provider, resource, check id, status, and evidence text suitable for Taric capture.

#### Scenario: Audit produces a finding
- **WHEN** a check fails
- **THEN** the result contains the resource and evidence required for structured reporting

