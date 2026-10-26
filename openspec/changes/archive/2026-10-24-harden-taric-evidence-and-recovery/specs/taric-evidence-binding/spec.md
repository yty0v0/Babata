## ADDED Requirements

### Requirement: Committed artifacts become Taric observations

The host SHALL record a Taric `observation` for each admitted checkpoint that has at least one committed artifact, and SHALL bind the resulting observation id into the checkpoint commit as `observation_refs` and `evidence_refs`.

#### Scenario: Checkpoint with committed artifacts is admitted
- **WHEN** a checkpoint with committed artifacts is admitted
- **THEN** the host creates an observation referencing the target resource and those artifact hashes, and the committed checkpoint contains the observation id in both `observation_refs` and `evidence_refs`

#### Scenario: Same checkpoint is retried
- **WHEN** the evidence binding runs again for the same checkpoint and artifact hashes
- **THEN** the host reuses the same idempotency key and does not create a duplicate observation

### Requirement: Observations reference a real target resource

The host SHALL ensure the observation's `resource_ref` names an existing Taric record of an accepted kind, creating a host-owned resource for the target asset when none exists.

#### Scenario: Target resource is missing
- **WHEN** no resource record exists for the checkpoint's target asset
- **THEN** the host creates one with a host-derived idempotency key before creating the observation

#### Scenario: Resource cannot be created
- **WHEN** resource creation fails
- **THEN** the host skips observation creation and records an explicit evidence gap instead of inventing a reference

### Requirement: Evidence binding never fabricates identifiers

The host MUST NOT write a `evidence_refs` or `observation_refs` entry that does not correspond to a Taric record it just created or resolved.

#### Scenario: Evidence recording is unavailable
- **WHEN** Taric rejects or times out the observation call
- **THEN** the checkpoint is still committed with `artifact_refs` only, and the WorkRun records an evidence gap

#### Scenario: Model supplies evidence identifiers
- **WHEN** a model proposal contains `evidence_refs` or `observation_refs`
- **THEN** the host ignores those values and uses only host-derived identifiers

### Requirement: Observation content is bounded and non-secret

The host SHALL build observation statements from bounded checkpoint steps and artifact summaries, and MUST NOT include raw artifact bytes or credential material.

#### Scenario: Large artifact is bound
- **WHEN** a committed artifact exceeds the inline budget
- **THEN** the observation contains only a bounded summary and the artifact hash

#### Scenario: Statement is generated
- **WHEN** the observation statement is built
- **THEN** it contains only derived text, the target reference, and artifact hashes
