import { describe, expect, test } from "bun:test"
import { assertEngagementBoundarySupported } from "./provider-factory"
import { TaricUnavailableError } from "./types"
import type { Project } from "../project/types"

const competitionProject: Project = {
    mode: "competition",
    provider: "local_practice",
    tenant_id: "tenant-a",
    platform_id: "platform-a",
    competition_id: "competition-a",
    team_id: "team-a",
    challenge_code: "challenge-a",
    memory_mode: "taric_best_effort",
    taric_engagement_id: "engagement-shared",
}

const authorizedProject: Project = {
    mode: "authorized_pentest",
    tenant_id: "tenant-a",
    engagement_id: "engagement-a",
    scope_revision: 1,
    coverage_manifest_id: "manifest-a",
    memory_mode: "taric_required",
    taric_engagement_id: "engagement-a",
}

describe("Taric Engagement boundary support", () => {
    test("keeps explicitly shared development projects available", () => {
        expect(() => assertEngagementBoundarySupported(competitionProject, "shared_development")).not.toThrow()
    })

    test("allows authorized projects to use the shared local development policy", () => {
        expect(() => assertEngagementBoundarySupported(authorizedProject, "shared_development")).not.toThrow()
    })

    test("fails closed when project-bound credentials are not provisioned", () => {
        for (const project of [competitionProject, authorizedProject]) {
            try {
                assertEngagementBoundarySupported(project, "project_bound")
                throw new Error("expected project-bound configuration to be rejected")
            } catch (error) {
                expect(error).toBeInstanceOf(TaricUnavailableError)
                expect(error).toMatchObject({ blocked: project.memory_mode === "taric_required" })
                expect((error as Error).message).toContain("project-specific Engagement provisioning")
            }
        }
    })
})
