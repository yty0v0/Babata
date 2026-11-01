# observer-board-curation Specification

## Purpose
TBD - created by archiving change align-observer-taric-review. Update Purpose after archive.
## Requirements
### Requirement: Observer curates evidence-grounded board proposals
The observer SHALL maintain compact memory and ideas using solver evidence, prioritize existing-hypothesis closure, prefer NO_CHANGE without durable new information, and reserve reminders for persistent material drift.

#### Scenario: Solver produces a scoped negative result
- **WHEN** a single payload fails
- **THEN** the observer proposes only the evidenced scope and SHALL NOT declare the entire route failed

### Requirement: Taric owns all curation persistence
Observer curation SHALL use host-validated Taric candidate proposals and SHALL NOT write solver-local board files or mutate canonical records.

#### Scenario: Observer revises an idea
- **WHEN** the observer supplies a real target UUID and evidence UUIDs
- **THEN** the host queues a fresh candidate naming the target and requested resolution, without marking the original idea verified or updated

#### Scenario: Submission is unavailable
- **WHEN** Taric submission is disabled, unbound or fails
- **THEN** the tool reports unavailable and SHALL NOT fall back to local persistence or claim success

### Requirement: Host binds project and validates evidence
The host SHALL derive project identity from challenge state and validate all curation enums, nonempty content and UUID references before enqueueing.

#### Scenario: Model supplies an untrusted project identity
- **WHEN** curation includes model-selected project or authority fields
- **THEN** validation rejects them and no candidate is enqueued

### Requirement: Solver remains a board reader
Only the observer sidecar SHALL expose board curation proposal tools. Solver tools SHALL remain read-only and board rendering SHALL distinguish candidates from admitted records.

#### Scenario: Reminder has no delivery callback
- **WHEN** a reminder is requested without a callback
- **THEN** delivery is reported as suppressed

