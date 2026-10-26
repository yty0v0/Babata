## ADDED Requirements

### Requirement: Tool results are captured by the host

The host SHALL capture bounded tool results into Taric artifacts and observations for Taric-enabled solver sessions.

#### Scenario: Tool produces a result
- **WHEN** an executor tool call returns in a Taric-enabled session
- **THEN** the host records an observation summarizing the result and links the original bytes to a Taric artifact

#### Scenario: Tool result is empty or transient
- **WHEN** a tool result contains no useful evidence
- **THEN** the host may skip artifact capture but records a bounded no-evidence observation

### Requirement: Captured artifacts stay outside model context

The host SHALL store original artifact bytes in the Taric spool and SHALL only expose a bounded summary or reference in model context.

#### Scenario: Large tool output is captured
- **WHEN** a tool result exceeds the inline budget
- **THEN** the model sees a summary and artifact reference, not the full raw bytes

#### Scenario: Raw bytes are requested for review
- **WHEN** an operator or reviewer explicitly requests the original artifact
- **THEN** the host returns it through a controlled content-read path

### Requirement: Evidence refs are derived from captured artifacts

The host SHALL bind checkpoint evidence refs only to Taric artifact records it created or resolved, and MUST NOT accept model-supplied evidence refs as authoritative.

#### Scenario: Checkpoint follows captured evidence
- **WHEN** a checkpoint is committed after tool-result capture
- **THEN** its evidence refs point to Taric artifact hashes produced during that work run

#### Scenario: Model supplies evidence refs
- **WHEN** a model proposal includes evidence refs
- **THEN** the host ignores those values and uses only host-derived refs
