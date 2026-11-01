## Why

The current application already has Taric read-board access, challenge bindings, authoritative projections, and a governed WorkRun/checkpoint/evidence/admission/report lifecycle. The reference BreachWeave project has a useful local-runtime pattern: initialize Taric during daemon startup, adopt an existing gateway or start one, wait for readiness, and preserve authority state in a stable data directory. It also has stronger bounded-read patterns: pagination limits, cursor progress validation, stable read-sequence checks, deduplication, response-size budgets, and explicit diagnostics.

The reference runtime is not a drop-in copy. It supervises a local Taric gateway process, whereas this project invokes Taric through Docker and a persistent named volume. Its fallback to `legacy_local` on gateway failure must not be copied for Taric-managed data: Taric remains the persistence authority, and runtime failure must never silently switch the same data to local JSON.

## What Changes

- Harden Taric read-board pagination, snapshot consistency, response budgets, and diagnostics.
- Add a typed read adapter/facade so consumers do not depend on Taric transport details. The adapter is not a storage-provider selector: Taric remains authoritative for Taric-managed challenge memory and ideas.
- Retain legacy-local behavior only for explicitly legacy projects/challenges during compatibility; it is not an outage fallback for Taric-managed scopes.
- Ensure Taric access components are initialized automatically during application startup, idempotently, and readiness is checked before Taric operations are exposed as healthy.
- Check Docker Engine, configured/pinned Taric image, persistent volume, and Taric health/readiness with actionable diagnostics. Do not silently create a second local authority or switch providers when Taric is unavailable.
- Preserve the current Taric governance and write lifecycle; the read adapter remains read-only.
- Defer project-bound isolation until trusted identity mapping and credential isolation are verified.

## Capabilities

### Modified Capabilities
- `taric-read-board`: bounded pagination, consistency, completeness, and diagnostics.
- `taric-authoritative-lifecycle`: Taric authority routing and automatic runtime readiness without local fallback.

### Added Capabilities
- `challenge-memory-provider`: typed Taric read adapter, provenance/completeness propagation, and explicit legacy compatibility boundary.
- `taric-runtime-startup`: idempotent application-start initialization and readiness diagnostics for the Taric Docker-backed runtime.

## Scope and Safety

Expected areas include `packages/core/src/challenge/taric-read-board.ts` and tests, Taric projection/adapter modules, ChallengeManager and daemon composition, runtime startup/readiness handling, shared types/exports, and API/UI adapters. Exact files are confirmed during implementation review. The existing authority/write paths remain unchanged. Startup must not delete, reset, or recreate an existing Taric data volume. Docker Engine itself is an external prerequisite; the application reports when it is unavailable rather than attempting privileged service management.