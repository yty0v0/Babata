## Context

The DVWA replay showed two distinct timing/visibility failures. Tool output was durably captured as Taric artifacts, but real evidence UUIDs were only created when the host closed a checkpoint on report submission. Observer reviews could run earlier and repeatedly receive an empty `evidence.query`. Separately, Taric `audit.doctor` reported committed sequence 840 and projected sequence 834 while reads still returned empty results; the runtime health status reflected reachability/doctor readiness, not projection parity.

The design must preserve Taric as authority, host-owned scope and identity, bounded reads, and the existing rule that only actual admitted Taric observation IDs may be cited as evidence. Artifact identifiers are not evidence references. It must not turn a valid empty query into a fabricated finding or silently treat projection lag as no evidence.

## Goals / Non-Goals

**Goals:**
- Ensure an Observer review occurs after the report tool's host-side checkpoint/evidence-binding work has completed.
- Make an empty result distinguishable from a result that could be stale because committed data is not yet projected.
- Attempt bounded host-controlled reconciliation before model reads and expose residual lag explicitly.
- Show runtime readiness and projection freshness as separate status dimensions.
- Keep candidate evidence references tied to real Taric records.

**Non-Goals:**
- Changing DVWA or any target, executing additional target actions, or changing pentest scope.
- Treating an artifact UUID/hash as an evidence UUID.
- Making Taric projection state authoritative or weakening admission/governance.
- Restarting services or claiming an end-to-end live replay passed as part of this design artifact.

## Decisions

1. **Use report completion as an Observer review trigger.** The report host-bridge handler creates/binds the host checkpoint before the solver tool execution completes. Mark a review reason for successful `challenge_submit_report` completion, so normal tool-end processing can enqueue the Observer only after host work has returned. Keep existing periodic/agent-end reviews. This is preferred to manufacturing evidence during capture because evidence binding requires trusted target/resource context and the checkpoint lifecycle; it also avoids duplicate or uncheckpointed observations. Verify actual event ordering in tests.

2. **Treat projection lag as a first-class read result.** Inject the existing host `TaricMaintenance` capability into the read-board handler. Before a model-visible read, run bounded `reconcile(engagementId)`, then require explicit committed/projected watermarks, `projected_seq >= committed_seq`, and zero pending outbox. If reconciliation fails, reports pending work, or omits trustworthy watermarks, return a stable degraded result (`taric_projection_stale` or `taric_projection_freshness_unknown`) with bounded diagnostics; do not return an apparently successful empty board. This applies to evidence reads in particular, since an empty stale result is indistinguishable from no evidence. Do not silently fall back to the direct sidecar read when the freshness gate is unavailable.

   Alternative considered: always issue the read and annotate it afterward. Rejected because an empty stale read is easy for an Observer/model to misinterpret and pagination may already have produced misleading data.

3. **Defer runtime-wide freshness status.** The current status aggregator has no reliable active engagement identity from which to query watermarks without choosing an arbitrary tenant/engagement. Do not query an arbitrary engagement or report the latest read as global health. Keep read-time freshness authoritative and defer status fields until an engagement-scoped status contract exists.

4. **Defer rather than infer when Observer visibility is uncertain.** A successful report tool completion is a review trigger; the runtime awaits host-bridge handling (including checkpoint/evidence binding) before emitting `tool_execution_end`, so the Observer review is queued only afterward. The Observer contract must treat `degraded`/stale/unknown-freshness read responses as retry-after-ready, not as an empty evidence set and not as `NO_CHANGE`. If freshness remains degraded, the review reports deferred visibility and does not submit a candidate based on absence. Real evidence UUIDs remain required for proposals. No evidence records are created by the Observer itself.

## Risks / Trade-offs

- [A report tool may fail after partial checkpoint work] → Trigger a post-report review only on successful tool completion, and use host-side completion/read state to distinguish failure or pending evidence.
- [Reconciliation adds latency or fails repeatedly] → Keep it bounded to existing preview/replay semantics; fail closed for model-visible reads with a stable degraded code and preserve the current circuit-breaker behavior.
- [Global status cannot represent multiple engagement watermarks] → Label values as latest-known diagnostics and keep enforcement scoped to each read's bound engagement.
- [A Taric version may omit watermark fields] -> Fail the freshness gate as unknown/degraded for model-visible reads; never silently retain a successful empty read or label unknown as fresh. Keep runtime reachability separately observable.

## Migration Plan

No authority schema migration is expected. Deploy host changes with additive optional status fields and stable degraded read markers. Roll back by reverting the host changes; Taric authority records remain intact. Validate unit tests first, then perform an authorized DVWA replay after deployment without broadening the target scope.

## Open Questions

- Confirm the report tool's host handler has completed `ensureHostCheckpoint` before the extension's `tool_execution_end` callback in the actual pi runtime; encode this ordering in an integration test.
- Confirm all supported `audit.reconcile` responses expose a trustworthy pending count and committed/projected watermarks, including the zero-pending preview response.
- Design an engagement-scoped status query before adding freshness to runtime-wide status/UI.
