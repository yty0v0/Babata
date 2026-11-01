## ADDED Requirements

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
