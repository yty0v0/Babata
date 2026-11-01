import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import { TARIC_BUN_DRIVER_INTEGRITY, TARIC_BUN_DRIVER_PACKAGE, TARIC_BUN_DRIVER_VERSION, TARIC_COMPATIBILITY_BASELINE, createTaricHostModule } from "./index"
import type { TaricCompatibility, TaricHostBinding, TaricServiceAdapter } from "./types"
import { AuthorizedPentestGovernance, GovernanceError, evaluateEgress, validateAuthorizedProjectSetup } from "./governance"
import type { AuthorizedProjectSetup } from "./governance"

const compatibility: TaricCompatibility = { ...TARIC_COMPATIBILITY_BASELINE, policyDigest: "sha256:policy", bunDriver: { packageName: TARIC_BUN_DRIVER_PACKAGE, version: TARIC_BUN_DRIVER_VERSION, integrity: TARIC_BUN_DRIVER_INTEGRITY } }
const binding: TaricHostBinding = { projectId: "project-authorized", tenantId: "tenant-a", engagementId: "engagement-a", hostPrincipalId: "host-a", modelPrincipalId: "model-a" }
const setup = {
    project: { mode: "authorized_pentest" as const, tenant_id: "tenant-a", engagement_id: "engagement-a", scope_revision: 1, coverage_manifest_id: "manifest-a", memory_mode: "taric_required" as const, taric_engagement_id: "engagement-a" },
    scope: { allowedTargets: [{ host: "10.5.207.26", protocols: ["http"], ports: [4280] }], deniedTargets: [{ cidr: "10.5.207.0/24" }], allowedProtocols: ["http"], allowedPorts: [4280] },
    testWindow: { startsAt: "2026-01-01T00:00:00.000Z", endsAt: "2030-01-01T00:00:00.000Z" },
    manifest: [{ resourceId: "00000000-0000-4000-8000-000000000001", revision: 1, testCategories: ["authentication"] }],
    secretReferences: ["secret:dvwa-admin"], retentionDays: 30, policyDigest: "sha256:policy",
}

function createAdapter(): TaricServiceAdapter {
    return {
        async getProfile() { return { status: "verified", compatibility } },
        async getBinding() { return binding },
        async invoke(operation, input) {
            if (operation === "work.claim") return { ok: true, data: { run_id: "00000000-0000-4000-8000-000000000010", attempt_ref: "00000000-0000-4000-8000-000000000011", generation: 1, owner: "host-a", lease_expires_at: "2030-01-01T00:00:00.000Z", read_seq: 1 } }
            if (operation === "coverage.gate") return { ok: true, data: { can_close: true, read_seq: 3 } }
            if (operation === "resource.revise") return { ok: true, data: { id: "00000000-0000-4000-8000-000000000001" } }
            return { ok: true, data: { operation, input, id: "00000000-0000-4000-8000-000000000099" } }
        },
        async close() {},
    }
}

async function createGovernance(governanceSetup: AuthorizedProjectSetup = setup, adapterAvailable = true) {
    const root = await mkdtemp(join(tmpdir(), "breachweave-governance-"))
    const host = createTaricHostModule({
        binding,
        expectedCompatibility: compatibility,
        mode: "taric_required",
        ...(adapterAvailable ? { adapter: createAdapter() } : {}),
    })
    return { root, governance: new AuthorizedPentestGovernance({ host, setup: governanceSetup, artifactRoot: root, artifactKey: new Uint8Array(32).fill(4) }) }
}

describe("authorized pentest governance", () => {
    test("rejects an authorized setup that cannot produce deterministic governed coverage", () => {
        expect(() => validateAuthorizedProjectSetup({ ...setup, scope: { allowedTargets: [] } })).toThrow("authorized scope")
        expect(() => validateAuthorizedProjectSetup({ ...setup, manifest: [{ ...setup.manifest[0]!, resourceId: "resource-1" }] })).toThrow("Resource UUID")
        expect(() => validateAuthorizedProjectSetup({ ...setup, manifest: [{ ...setup.manifest[0]!, testCategories: ["authentication", "authentication"] }] })).toThrow("unique")
        expect(() => validateAuthorizedProjectSetup({ ...setup, scope: { allowedTargets: [{ cidr: "10.0.0.0/33" }] } })).toThrow("cidr")
        expect(() => validateAuthorizedProjectSetup({ ...setup, secretReferences: ["secret:dvwa-admin", "secret:dvwa-admin"] })).toThrow("unique")
    })

    test("blocks denied address and redirect escapes", () => {
        const decision = evaluateEgress(setup.scope, setup.testWindow, { url: "http://10.5.207.26:4280/login.php", redirectChain: ["http://10.5.207.27:4280/"], resolvedAddresses: ["10.5.207.26"] })
        expect(decision.allowed).toBe(false)
        expect(decision.reason).toContain("denied")
        const mixedDns = evaluateEgress({ allowedTargets: [{ host: "dvwa.test" }, { cidr: "10.5.207.0/24" }] }, setup.testWindow, { url: "http://dvwa.test:4280/", resolvedAddresses: ["10.5.207.26", "10.5.208.26"] })
        expect(mixedDns.allowed).toBe(false)
        const missingDns = evaluateEgress({ allowedTargets: [{ host: "dvwa.test" }] }, setup.testWindow, { url: "http://dvwa.test/" })
        expect(missingDns.allowed).toBe(false)
    })

    test("checks host authority health before allowing an in-scope action", async () => {
        const actionSetup: AuthorizedProjectSetup = {
            ...setup,
            scope: {
                allowedTargets: [{ host: "dvwa.test" }, { cidr: "192.0.2.0/24" }],
                deniedTargets: [{ cidr: "192.0.2.0/30" }],
                allowedProtocols: ["http"],
                allowedPorts: [4280],
            },
        }
        const { root, governance } = await createGovernance(actionSetup)
        try {
            await expect(governance.assertActionAllowed({
                url: "http://dvwa.test:4280/login.php",
                resolvedAddresses: ["192.0.2.10"],
            })).resolves.toMatchObject({ allowed: true })

            await expect(governance.assertActionAllowed({
                url: "http://dvwa.test:4280/login.php",
                resolvedAddresses: ["192.0.2.1"],
            })).rejects.toMatchObject({ code: "egress_denied", outcome: "rejected_authorization" })

            await expect(governance.assertActionAllowed({
                url: "http://dvwa.test:4280/login.php",
                resolvedAddresses: ["192.0.2.10"],
                at: "2025-12-31T23:59:59.999Z",
            })).rejects.toMatchObject({ code: "egress_denied", outcome: "rejected_authorization" })
        } finally { await rm(root, { recursive: true, force: true }) }
    })

    test("fails action preflight closed when Taric authority is unavailable", async () => {
        const { root, governance } = await createGovernance(setup, false)
        try {
            await expect(governance.assertActionAllowed({
                url: "http://10.5.207.26:4280/",
                resolvedAddresses: ["10.5.207.26"],
            })).rejects.toMatchObject({ code: "taric_unavailable", outcome: "rejected_authorization" })
        } finally { await rm(root, { recursive: true, force: true }) }
    })

    test("requires every resolved address and handles IPv6 CIDR targets", () => {
        const policy = { allowedTargets: [{ cidr: "2001:db8::/32" }], allowedProtocols: ["https"], allowedPorts: [443] }
        expect(evaluateEgress(policy, setup.testWindow, { url: "https://[2001:db8::1]/", resolvedAddresses: ["2001:db8::1"] }).allowed).toBe(true)
        expect(evaluateEgress(policy, setup.testWindow, { url: "https://[2001:db8::1]/", resolvedAddresses: ["2001:db8::1", "2001:db9::1"] }).allowed).toBe(false)
    })

    test("recovers linked artifacts and closes against a pinned report snapshot", async () => {
        const { root, governance } = await createGovernance()
        try {
            const run = await governance.claimWork("work-1", "host-a", setup.manifest[0]!.resourceId)
            await expect(governance.claimWork("work-2", "host-a", setup.manifest[0]!.resourceId)).rejects.toMatchObject({ code: "resource_busy" })
            const artifact = await governance.commitArtifact({ bytes: new TextEncoder().encode("DVWA login returned 302"), mediaType: "text/plain", workRunId: run.runId, attemptId: run.attemptId, generation: run.generation })
            expect(artifact.sha256).toMatch(/^sha256:/)
            expect(artifact.manifestHash).toMatch(/^sha256:/)
            expect(artifact).toMatchObject({ workRunId: run.runId, attemptId: run.attemptId, generation: run.generation, resourceId: run.targetResourceId, resourceRevision: 1, scopeRevision: 1 })
            await expect(governance.readArtifact(artifact.contentRef, undefined)).rejects.toMatchObject({ code: "artifact_content_denied" })
            const bytes = await governance.readArtifact(artifact.contentRef, "content_read")
            expect(new TextDecoder().decode(bytes)).toContain("DVWA")

            const captured = await governance.captureObservation({
                resourceRef: run.targetResourceId,
                statement: "DVWA login response confirmed",
                artifactRefs: [{ content_ref: artifact.contentRef }],
                workRunId: run.runId,
                generation: run.generation,
            })
            expect(captured.outcome).toBe("accepted")
            expect(captured.result).toMatchObject({
                input: {
                    observation: {
                        artifact_refs: [{ content_ref: artifact.contentRef, artifact_id: artifact.artifactId, content_hash: artifact.sha256, manifest_hash: artifact.manifestHash, integrity_status: "verified" }],
                        limitations: [expect.stringContaining("Resource revision")],
                    },
                    work_run_id: run.runId,
                    generation: run.generation,
                },
            })
            const observationId = (captured.result as { id: string }).id
            const rejectedObservation = await governance.captureObservation({
                resourceRef: run.targetResourceId,
                statement: "Uncommitted artifact must be rejected",
                artifactRefs: [{ content_ref: "artifact:00000000-0000-4000-8000-000000000099" }],
                workRunId: run.runId,
                generation: run.generation,
            })
            expect(rejectedObservation).toMatchObject({ outcome: "rejected_validation", diagnostics: { code: "artifact_not_committed" } })

            const proposal = await governance.submitCandidateProposal({
                eventId: "candidate:artifact-linked",
                subjectType: "claim",
                expectedVersion: 0,
                content: { kind: "claim", proposition: "The login endpoint redirects after authentication", artifact_refs: [artifact.contentRef] },
            })
            expect(proposal).toMatchObject({
                input: {
                    content: {
                        artifact_refs: [{ content_ref: artifact.contentRef, artifact_id: artifact.artifactId, manifest_hash: artifact.manifestHash, provenance_ref: run.runId }],
                        limitations: [expect.stringContaining(`Resource revision ${run.targetResourceId}@1`)],
                    },
                },
            })
            await expect(governance.submitCandidateProposal({
                eventId: "candidate:unknown-artifact",
                subjectType: "claim",
                expectedVersion: 0,
                content: { kind: "claim", proposition: "No artifact exists", artifact_refs: ["artifact:00000000-0000-4000-8000-000000000099"] },
            })).rejects.toMatchObject({ code: "artifact_not_committed" })

            const cellId = `${setup.manifest[0]!.resourceId}:1:1:authentication`
            await expect(governance.recordCoverage(cellId, { expectedVersion: 0, status: "positive", evidenceRefs: [artifact.contentRef] })).rejects.toMatchObject({ code: "coverage_evidence_ref" })
            await governance.recordCoverage(cellId, { expectedVersion: 0, status: "positive", evidenceRefs: [observationId] })
            await governance.transitionWork(run.runId, "host-a", 1, "completed")
            const gate = await governance.coverageGate()
            expect(gate.canClose).toBe(true)
            const snapshot = await governance.createReportSnapshot()
            expect(snapshot).toMatchObject({ manifestDigest: expect.stringMatching(/^sha256:/), scopeRevision: 1, readSeq: gate.readSeq, gate: { canClose: true } })
            await expect(governance.getReportSnapshot(snapshot.reportDigest)).resolves.toEqual(snapshot)
            await expect(governance.close({ reportDigest: "sha256:report" })).rejects.toMatchObject({ code: "report_snapshot_stale" })
            await governance.recordCoverage(cellId, { expectedVersion: 1, status: "positive", evidenceRefs: [observationId] })
            const refreshedSnapshot = await governance.createReportSnapshot()
            expect(refreshedSnapshot.reportDigest).not.toBe(snapshot.reportDigest)
            await expect(governance.close({ reportDigest: snapshot.reportDigest })).rejects.toMatchObject({ code: "report_snapshot_stale" })
            await expect(governance.close({ reportDigest: refreshedSnapshot.reportDigest })).resolves.toMatchObject({ closed: true, reportDigest: refreshedSnapshot.reportDigest, readSeq: refreshedSnapshot.readSeq })

            const restartedHost = createTaricHostModule({ binding, expectedCompatibility: compatibility, mode: "taric_required", adapter: createAdapter() })
            const restarted = new AuthorizedPentestGovernance({ host: restartedHost, setup, artifactRoot: root, artifactKey: new Uint8Array(32).fill(4) })
            await expect(restarted.getArtifactMetadata(artifact.contentRef)).resolves.toMatchObject({ artifactId: artifact.artifactId, manifestHash: artifact.manifestHash, contentStatus: "available" })
            await expect(restarted.readArtifact(artifact.contentRef, "content_read")).resolves.toEqual(bytes)
        } finally { await rm(root, { recursive: true, force: true }) }
    })

    test("retention removes payload while keeping a recoverable artifact tombstone", async () => {
        const { root, governance } = await createGovernance()
        try {
            const artifact = await governance.commitArtifact({ bytes: new TextEncoder().encode("short lived evidence"), mediaType: "text/plain" })
            const deleted = await governance.purgeExpiredArtifacts(Date.parse(artifact.committedAt) + setup.retentionDays * 24 * 60 * 60 * 1000)
            expect(deleted).toBe(1)
            await expect(governance.readArtifact(artifact.contentRef, "content_read")).rejects.toMatchObject({ code: "artifact_deleted" })

            const restartedHost = createTaricHostModule({ binding, expectedCompatibility: compatibility, mode: "taric_required", adapter: createAdapter() })
            const restarted = new AuthorizedPentestGovernance({ host: restartedHost, setup, artifactRoot: root, artifactKey: new Uint8Array(32).fill(4) })
            await expect(restarted.getArtifactMetadata(artifact.contentRef)).resolves.toMatchObject({ contentStatus: "deleted", sha256: artifact.sha256 })
        } finally { await rm(root, { recursive: true, force: true }) }
    })

    test("rejects artifact metadata changed after commit", async () => {
        const { root, governance } = await createGovernance()
        try {
            const artifact = await governance.commitArtifact({ bytes: new TextEncoder().encode("integrity checked"), mediaType: "text/plain" })
            const metadataPath = join(artifact.path, "metadata.json")
            const manifest = await Bun.file(metadataPath).json() as Record<string, unknown>
            await Bun.write(metadataPath, JSON.stringify({ ...manifest, mediaType: "application/octet-stream" }))

            const restartedHost = createTaricHostModule({ binding, expectedCompatibility: compatibility, mode: "taric_required", adapter: createAdapter() })
            const restarted = new AuthorizedPentestGovernance({ host: restartedHost, setup, artifactRoot: root, artifactKey: new Uint8Array(32).fill(4) })
            await expect(restarted.getArtifactMetadata(artifact.contentRef)).rejects.toMatchObject({ code: "artifact_metadata_integrity" })
        } finally { await rm(root, { recursive: true, force: true }) }
    })

    test("rejects stale generation and secret-bearing checkpoint state", async () => {
        const { root, governance } = await createGovernance()
        try {
            const run = await governance.claimWork("work-1", "host-a", setup.manifest[0]!.resourceId)
            await expect(governance.commitCheckpoint({ workRunId: run.runId, attemptId: run.attemptId, generation: 2, completedSteps: [], nextSteps: [], observationRefs: [], evidenceRefs: [], unresolvedWork: [], sourceReadSeq: 1 }, "host-a")).rejects.toMatchObject({ code: "stale_generation" })
            await expect(governance.commitCheckpoint({ workRunId: run.runId, attemptId: run.attemptId, generation: 1, completedSteps: ["password=secret"], nextSteps: [], observationRefs: [], evidenceRefs: [], unresolvedWork: [], sourceReadSeq: 1 }, "host-a")).rejects.toBeInstanceOf(GovernanceError)
        } finally { await rm(root, { recursive: true, force: true }) }
    })
})
