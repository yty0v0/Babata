import { describe, expect, test } from "bun:test"
import { normalizeTaricProposal } from "./taric-proposal-schema"

describe("Taric typed proposal schema", () => {
    test("normalizes a work item proposal and strips writer fields", () => {
        const proposal = normalizeTaricProposal({
            kind: "work_item",
            expected_version: 0,
            content: {
                title: "verify upload parser",
                acceptance_criteria: ["record evidence"],
                goal: "verify parser behavior",
                risk_class: "finding",
            },
            trust_level: "L2",
        })
        expect(proposal).toMatchObject({
            subject_type: "work_item",
            expected_version: 0,
            content: {
                title: "verify upload parser",
                status: "queued",
                acceptance_criteria: ["record evidence"],
            },
        })
        expect("trust_level" in proposal).toBe(false)
    })

    test("normalizes a claim proposal and requires evidence and limitations", () => {
        const proposal = normalizeTaricProposal({
            kind: "claim",
            expected_version: 0,
            content: {
                proposition: "/admin is reachable without authentication",
                evidence_refs: ["5eee9386-a285-70b9-8ce5-995fafcc348c"],
                limitations: ["single identity"],
            },
        })
        expect(proposal.content).toMatchObject({
            schema_version: "1.0.0",
            kind: "claim",
            proposition: "/admin is reachable without authentication",
            status: "proposed",
        })
        expect(() =>
            normalizeTaricProposal({
                kind: "claim",
                expected_version: 0,
                content: {
                    proposition: "x",
                    evidence_refs: [],
                    limitations: [],
                },
            }),
        ).toThrow()
    })

    test("normalizes checkpoint proposals from host-owned work run authority", () => {
        const checkpoint = normalizeTaricProposal(
            {
                kind: "checkpoint",
                expected_version: 0,
                content: {
                    owner: "model-supplied-owner",
                    work_run_ref: "4e8a43c3-76d2-7070-9185-7b83cae723cd",
                    completed_steps: ["step one"],
                    next_steps: ["step two"],
                    facts_used: ["admin endpoint reachable"],
                    open_questions: ["is CSRF required?"],
                    observation_refs: ["9e8a43c3-76d2-7070-9185-7b83cae723cf"],
                    evidence_refs: ["9e8a43c3-76d2-7070-9185-7b83cae723ce"],
                },
            },
            {
                work_item_ref: "3e8a43c3-76d2-7070-9185-7b83cae723cd",
                work_run_ref: "4e8a43c3-76d2-7070-9185-7b83cae723cd",
                attempt_ref: "5e8a43c3-76d2-7070-9185-7b83cae723cd",
                generation: 1,
                target_version: 1,
                work_item_version: 1,
                scope_version: 0,
                owner: { host_id: "breachweave-host", agent_id: "executor-solver-a" },
                lease_expires_at: "2026-10-23T00:00:00.000Z",
                source_read_seq: 3,
                scope_ref: "6e8a43c3-76d2-7070-9185-7b83cae723cd",
            },
        )
        expect(checkpoint.content).toMatchObject({
            generation: 1,
            work_item_version: 1,
            owner: { host_id: "breachweave-host", agent_id: "executor-solver-a" },
            next_steps: ["step two"],
            unresolved_work: ["is CSRF required?"],
            observation_refs: [],
            evidence_refs: [],
        })
        expect(checkpoint.target_id).toBeUndefined()
        expect(checkpoint.subject_ref).toBeUndefined()
        const manifest = checkpoint.content.context_manifest as Record<string, unknown>
        expect(manifest.read_seq).toBe(3)
        expect(manifest.sources).toEqual([{ kind: "fact", summary: "admin endpoint reachable" }])

        const retried = normalizeTaricProposal(
            {
                kind: "checkpoint",
                expected_version: 1,
                target_id: "7e8a43c3-76d2-7070-9185-7b83cae723cd",
                subject_ref: "7e8a43c3-76d2-7070-9185-7b83cae723ce",
                content: {
                    completed_steps: [],
                    next_steps: ["retry"],
                    facts_used: [],
                    open_questions: [],
                },
            },
            {
                work_item_ref: "3e8a43c3-76d2-7070-9185-7b83cae723cd",
                work_run_ref: "4e8a43c3-76d2-7070-9185-7b83cae723cd",
                attempt_ref: "5e8a43c3-76d2-7070-9185-7b83cae723cd",
                generation: 1,
                target_version: 1,
                work_item_version: 1,
                scope_version: 0,
                owner: { host_id: "breachweave-host", agent_id: "executor-solver-a" },
                lease_expires_at: "2026-10-23T00:00:00.000Z",
                source_read_seq: 3,
            },
        )
        expect(retried.target_id).toBeUndefined()
        expect(retried.subject_ref).toBeUndefined()
        expect(retried.expected_version).toBe(0)

        expect(() =>
            normalizeTaricProposal({
                kind: "checkpoint",
                expected_version: 0,
                content: {
                    work_item_ref: "3e8a43c3-76d2-7070-9185-7b83cae723cd",
                    work_run_ref: "4e8a43c3-76d2-7070-9185-7b83cae723cd",
                    attempt_ref: "5e8a43c3-76d2-7070-9185-7b83cae723cd",
                    generation: 1,
                    owner: "executor:solver-a",
                    lease_expires_at: "2026-10-23T00:00:00.000Z",
                    source_read_seq: 3,
                    next_steps: ["step two"],
                },
            }),
        ).toThrow("checkpoint requires an active Taric work run")

        const correction = normalizeTaricProposal({
            kind: "correction",
            expected_version: 1,
            content: {
                target_ref: "3e8a43c3-76d2-7070-9185-7b83cae723cd",
                reason: "premise changed",
                replacement_refs: ["5eee9386-a285-70b9-8ce5-995fafcc348c"],
            },
        })
        expect(correction).toMatchObject({
            subject_type: "action_recommendation",
            content: {
                schema_version: "1.0.0",
                kind: "action_intent",
                method: "correction",
                reason: "premise changed",
            },
        })
        expect(() => normalizeTaricProposal({ kind: "checkpoint", expected_version: 0, content: {} })).toThrow()
        expect(() => normalizeTaricProposal({ kind: "correction", expected_version: 0, content: {} })).toThrow()
    })

    test("rejects unsupported kinds and writer-controlled fields", () => {
        expect(() => normalizeTaricProposal({ kind: "finding", expected_version: 0, content: {} })).toThrow()
        expect(() =>
            normalizeTaricProposal({
                kind: "claim",
                expected_version: 0,
                content: {
                    proposition: "x",
                    evidence_refs: ["5eee9386-a285-70b9-8ce5-995fafcc348c"],
                    limitations: ["single identity"],
                    accept: true,
                },
            }),
        ).toThrow("proposal content must not contain writer field: accept")
    })
})
