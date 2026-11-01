## MODIFIED Requirements

### Requirement: Committed artifacts become Taric observations
The host SHALL record a Taric `observation` for each admitted checkpoint that has at least one committed artifact, and SHALL bind the resulting observation id into the checkpoint commit as `observation_refs` and `evidence_refs`. The system SHALL make those references visible to a subsequent Observer evidence query only after the observation/checkpoint lifecycle and Taric projection are current; until then it MUST signal pending, stale, or degraded visibility instead of implying there is no evidence.

#### Scenario: Checkpoint with committed artifacts is admitted
- **WHEN** a checkpoint with committed artifacts is admitted
- **THEN** the host creates an observation referencing the target resource and those artifact hashes, and the committed checkpoint contains the observation id in both `observation_refs` and `evidence_refs`

#### Scenario: Evidence binding is complete and projection is fresh
- **WHEN** the observation and checkpoint have been committed and Taric reports the read projection current
- **THEN** a scoped evidence query can return the real observation ID and bounded metadata

#### Scenario: Checkpoint or projection is not yet visible
- **WHEN** observation binding/checkpoint completion is pending or projection watermarks lag
- **THEN** the read path signals pending/stale/degraded visibility and does not imply that a valid empty evidence result proves no evidence exists

#### Scenario: Same checkpoint is retried
- **WHEN** the evidence binding runs again for the same checkpoint and artifact hashes
- **THEN** the host reuses the same idempotency key and does not create a duplicate observation
