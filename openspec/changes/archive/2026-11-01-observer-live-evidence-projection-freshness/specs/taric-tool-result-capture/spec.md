## MODIFIED Requirements

### Requirement: Tool results are captured by the host
The host SHALL capture bounded tool results into Taric artifacts and observations for Taric-enabled solver sessions. Observer review of those results SHALL occur at a lifecycle point where any report-triggered host checkpoint and evidence binding have completed, or SHALL explicitly defer when the checkpoint/evidence visibility is still pending. Capturing an artifact alone MUST NOT be described as creating a queryable evidence record.

#### Scenario: Tool produces a result
- **WHEN** an executor tool call returns in a Taric-enabled session
- **THEN** the host records an observation summarizing the result and links the original bytes to a Taric artifact

#### Scenario: Tool result is empty or transient
- **WHEN** a tool result contains no useful evidence
- **THEN** the host may skip artifact capture but records a bounded no-evidence observation

#### Scenario: Report submission completes host checkpoint processing
- **WHEN** an executor successfully completes `challenge_submit_report` and the host has completed its checkpoint/evidence-binding handler
- **THEN** the Observer is scheduled for a review after that tool completion and can query the resulting governed evidence records

#### Scenario: Observer reads before evidence is visible
- **WHEN** Observer receives a stale, degraded, or pending-visibility read result
- **THEN** it defers a no-change conclusion and retries at an eligible later review point

#### Scenario: Captured artifact has not yet been bound
- **WHEN** a tool result has been stored as an artifact but no admitted Taric observation has been bound
- **THEN** the host/Observer distinguishes that artifact capture from queryable evidence and does not invent an evidence reference

### Requirement: Evidence refs are derived from captured artifacts
The host SHALL bind checkpoint evidence refs only to real Taric observation records that it created or resolved from captured artifact metadata, and MUST NOT accept model-supplied evidence refs as authoritative.

#### Scenario: Checkpoint follows captured evidence
- **WHEN** a checkpoint is committed after tool-result capture
- **THEN** its evidence refs identify the real admitted observation record created from artifacts produced during that work run

#### Scenario: Model supplies evidence refs
- **WHEN** a model proposal includes evidence refs
- **THEN** the host ignores those values and uses only host-derived refs
