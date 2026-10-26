# attack-script-tool Specification

## Purpose
TBD - created by archiving change port-cyberstrike-native-tools. Update Purpose after archive.
## Requirements
### Requirement: Allowlisted attack scripts

The system SHALL provide an `attack_script` dispatcher that only accepts a fixed allowlist of specialized operations.

#### Scenario: Allowed script is requested
- **WHEN** the model requests a supported operation such as JWT tamper, race tester, multipart upload, SSRF listener, Wayback extraction, subdomain takeover, or cloud storage enumeration
- **THEN** the dispatcher executes the corresponding bundled or controlled script

#### Scenario: Unknown script is requested
- **WHEN** the model requests an operation not in the allowlist
- **THEN** the tool rejects the request with the supported operation list

### Requirement: Structured script parameters

Each attack script SHALL accept typed parameters and SHALL NOT accept arbitrary shell command text.

#### Scenario: JWT operation
- **WHEN** the model performs JWT tampering
- **THEN** it supplies token, algorithm, claim, or key parameters through typed fields

#### Scenario: SSRF listener
- **WHEN** the model starts an SSRF callback listener
- **THEN** it supplies port and output path parameters

### Requirement: Script output is evidence-ready

The dispatcher SHALL return structured output and SHALL support writing results to a bounded evidence file suitable for Taric capture.

#### Scenario: Script completes
- **WHEN** a supported script finishes
- **THEN** the tool returns structured output plus an evidence reference

#### Scenario: Script fails
- **WHEN** the script cannot complete
- **THEN** the tool returns a structured error without ambiguous shell text

