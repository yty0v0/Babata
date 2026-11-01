## ADDED Requirements

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
