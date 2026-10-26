# http-replay-tool Specification

## Purpose
TBD - created by archiving change port-cyberstrike-native-tools. Update Purpose after archive.
## Requirements
### Requirement: Structured HTTP replay

The system SHALL provide a native `http_replay` tool that sends HTTP requests using typed parameters and captured request context instead of requiring the model to construct curl commands.

#### Scenario: Replay a captured request
- **WHEN** the model provides a captured request ID and mutation operations
- **THEN** the tool sends the request with the captured URL, method, headers, credentials, and cookies

#### Scenario: Construct an in-scope target request
- **WHEN** the model provides an explicit target on an already in-scope host
- **THEN** the tool constructs and sends that request with method, headers, and body fields

### Requirement: Request mutation and comparison

The `http_replay` tool SHALL support field-level mutation and baseline/exploit comparison in a single call.

#### Scenario: Compare baseline and exploit
- **WHEN** the model requests a comparison with baseline and exploit mutations
- **THEN** the tool returns both responses and a structured difference summary

#### Scenario: Mutation fails schema validation
- **WHEN** mutation parameters are invalid or target a non-mutatable field
- **THEN** the tool returns a validation error without sending an unsafe request

### Requirement: Raw request replay

The system SHALL provide `http_replay_raw` for byte-exact requests where header ordering, casing, malformed syntax, or request smuggling must be preserved.

#### Scenario: Byte-exact raw request
- **WHEN** the model supplies raw HTTP text for an in-scope host
- **THEN** the tool sends the text without normalization

### Requirement: CSRF token extraction

The system SHALL provide `csrf_extract` to fetch an authenticated page and extract a CSRF token for later replay.

#### Scenario: Token exists
- **WHEN** the target page contains a known CSRF token field
- **THEN** the tool returns the token and field name

#### Scenario: Token not found
- **WHEN** no CSRF token is found
- **THEN** the tool returns an explicit not-found result

