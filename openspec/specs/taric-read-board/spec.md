# taric-read-board Specification

## Purpose
TBD - created by archiving change integrate-taric-board. Update Purpose after archive.
## Requirements
### Requirement: Models can query only scoped board data
The system SHALL expose read-only Taric board tools that return only data authorized for the caller’s engagement and role, and MUST NOT expose authority writes, admission, work, host-state, or artifact management operations to model principals.

#### Scenario: Planner reads scoped context
- **WHEN** a planner requests a board query for its bound challenge
- **THEN** the system returns a Context Pack containing only allowed resources, claims, evidence references, and constraints for that engagement

#### Scenario: Model requests a forbidden operation
- **WHEN** a model calls a tool that maps to `capture`, `admission`, `work`, or artifact management
- **THEN** the request is rejected with `authorization_error` and no authority state changes

### Requirement: Read tools return governed visibility
The system SHALL exclude unadmitted L0 candidates from ordinary authoritative recall and SHALL mark admitted candidates with their trust level and provenance rather than presenting them as verified findings.

#### Scenario: Ordinary recall excludes pending proposal
- **WHEN** a query returns authoritative shared memory
- **THEN** pending L0 proposals are not included as authoritative facts

#### Scenario: Admitted candidate is labeled
- **WHEN** an admitted L1 claim is returned
- **THEN** the result includes its trust level and evidence references and does not claim L2 verification status

#### Scenario: Admitted checkpoint is visible by default
- **WHEN** a solver runs an ordinary board query without visibility flags
- **THEN** admitted L1 checkpoints and claims from its engagement are included, while unadmitted L0 candidates remain hidden

### Requirement: Evidence queries return references only
The system SHALL return evidence metadata, hashes, references, and bounded summaries to models, and MUST NOT include opaque artifact bytes or unredacted raw tool output in model views.

#### Scenario: Evidence is queried
- **WHEN** a model requests evidence details
- **THEN** the response contains an evidence reference and bounded metadata without raw payload bytes

### Requirement: Read failures degrade without breaking existing work
The system SHALL return an explicit degraded marker when Taric is unavailable, disabled, or not yet bound to a challenge, and SHALL allow existing BreachWeave challenge workflows to continue without throwing unhandled server errors.

#### Scenario: Taric is stopped
- **WHEN** a model invokes a read-board tool while the Taric container is stopped
- **THEN** the tool returns a bounded degraded response and the existing challenge workflow remains usable

#### Scenario: Engagement binding is absent
- **WHEN** a challenge has no active Taric engagement
- **THEN** read tools return a configuration or binding marker instead of data from another challenge

### Requirement: Read-board pagination is bounded
The system SHALL enforce host-configured pagination limits for Taric read-board requests, including maximum pages, records, aggregate response bytes, cursor length, and request/deadline duration. Effective limits MUST remain within implementation-defined hard bounds, and model-supplied request fields MUST NOT increase them.

#### Scenario: Read completes within configured limits
- **WHEN** all requested read-board pages complete within the effective limits
- **THEN** the response returns the collected records and identifies the result as complete

#### Scenario: A pagination budget is reached
- **WHEN** the next page would exceed a configured or hard limit
- **THEN** the reader stops issuing requests and returns a bounded partial or degraded result with a stable diagnostic identifying the exhausted limit

### Requirement: Paginated reads preserve a consistent read sequence
The system SHALL require all pages in one logical snapshot read to carry the same `read_seq` when the upstream contract provides that field, and SHALL NOT describe records from different read sequences as a complete snapshot.

#### Scenario: Read sequence remains stable
- **WHEN** every page has the same valid `read_seq`
- **THEN** the result may be marked complete if all other checks pass

#### Scenario: Read sequence changes between pages
- **WHEN** a subsequent page has a different or invalid `read_seq`
- **THEN** pagination stops and the result is marked partial/degraded with a read-sequence diagnostic

### Requirement: Pagination cursors must make bounded progress
The system SHALL validate cursor type and length, detect repeated cursors and non-progressing empty pages, and SHALL terminate rather than loop indefinitely.

#### Scenario: Cursor advances to completion
- **WHEN** each nonterminal page returns a valid advancing cursor and the final page terminates pagination
- **THEN** the reader returns the bounded result

#### Scenario: Cursor repeats or does not progress
- **WHEN** a cursor repeats, exceeds its limit, or an empty page cannot advance the cursor
- **THEN** the reader stops and returns a protocol diagnostic without issuing an unbounded number of requests

### Requirement: Read completeness and diagnostics are explicit
The system SHALL distinguish complete, partial, and degraded read outcomes (or equivalent typed states) and SHALL provide bounded diagnostics and read counters sufficient for callers to avoid treating incomplete authoritative context as complete.

#### Scenario: A caller receives partial results
- **WHEN** some pages were read but an upstream, protocol, consistency, or budget error prevents completion
- **THEN** the response marks the result partial/degraded and identifies the reason using stable diagnostic codes

#### Scenario: A read is unavailable
- **WHEN** Taric is disabled, unavailable, or the caller has no valid engagement binding
- **THEN** the response remains bounded and explicitly degraded/configuration-marked without reading another challenge's data

### Requirement: Reads distinguish projection freshness from empty data
When Taric is enabled, the host SHALL require the reconciliation capability and reconcile pending projection work for the bound engagement before returning a model-visible board read. If the capability is unavailable, the host SHALL return an explicit bounded freshness-unknown degraded result without issuing the read. If committed and projected watermarks remain unequal, pending work remains, or freshness cannot be established after reconciliation, the host SHALL return an explicit bounded degraded result identifying stale/unknown projection state rather than presenting the board response as a successful empty result. The result MUST NOT contain unbounded diagnostics or cross-engagement data.

#### Scenario: Pending projection work is replayed before a read
- **WHEN** a board query is made and Taric reports committed operations ahead of its projection with replayable outbox entries
- **THEN** the host reconciles the bound engagement and performs the read only after the projection is current

#### Scenario: Projection remains behind
- **WHEN** reconciliation completes but the projected watermark remains below the committed watermark or pending work remains
- **THEN** the model receives a degraded `taric_projection_stale` result with bounded watermarks and no successful empty-data interpretation

#### Scenario: Freshness cannot be checked
- **WHEN** Taric is enabled but reconciliation is unavailable, or the Taric contract does not provide watermarks
- **THEN** the host returns `taric_projection_freshness_unknown` and does not issue a board read
