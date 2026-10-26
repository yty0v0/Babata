## ADDED Requirements

### Requirement: Artifact originals are stored outside model context
The system SHALL store opaque tool output and evidence bytes in the configured Taric content root or host-managed external storage, and SHALL expose only references, hashes, bounded summaries, and metadata to model views.

#### Scenario: Tool output is captured
- **WHEN** a tool produces large or sensitive output during a governed work run
- **THEN** the original bytes are stored through the Artifact path and the model receives a reference and bounded summary rather than raw bytes

### Requirement: Artifact uploads are chunked and verified
The system SHALL upload artifacts using explicit begin/append/commit operations with expected size, content hash, ordinal ordering, and chunk verification.

#### Scenario: Chunk hash mismatches
- **WHEN** an artifact chunk hash does not match its bytes
- **THEN** the upload fails and no committed artifact reference is returned

#### Scenario: Artifact commit completes
- **WHEN** all declared chunks are received with valid hashes and total size
- **THEN** the system returns a durable content reference and records the artifact metadata

### Requirement: Artifact reads require explicit authorization
The system SHALL require a host or operator principal with explicit content-read authorization to read original artifact bytes, and MUST NOT grant model principals raw content access by default.

#### Scenario: Model requests raw artifact
- **WHEN** a model principal requests original artifact bytes
- **THEN** the request is rejected with `authorization_error`

#### Scenario: Authorized host reads artifact
- **WHEN** a host principal with content-read capability requests a bounded artifact range
- **THEN** the system returns the requested bytes and records the access

### Requirement: Artifact lifecycle policy is host-configured
The system SHALL expose host configuration for artifact retention, redaction, access control, and backup, and SHALL apply that policy without relying on Taric to delete or redact content automatically.

#### Scenario: Retention policy expires artifact
- **WHEN** an artifact exceeds its configured retention period
- **THEN** the host applies the configured disposal or archival policy and records the lifecycle outcome
