import { describe, expect, test } from "bun:test"
import { buildAuthorizedGovernanceReadiness } from "./governance-readiness"

describe("authorized governance readiness", () => {
    test("reports project-bound provisioning as optional hardening", () => {
        const report = buildAuthorizedGovernanceReadiness({
            taric: {
                enabled: true,
                profile: "authenticated_proxy",
                engagementBoundary: "project_bound",
                gatewayHostTokenEnv: "HOST_TOKEN_ENV",
                gatewayModelTokenEnv: "MODEL_TOKEN_ENV",
            },
            now: new Date("2026-10-28T00:00:00.000Z"),
        })

        expect(report).toMatchObject({
            generatedAt: "2026-10-28T00:00:00.000Z",
            status: "blocked",
            deployment: {
                taricEnabled: true,
                profile: "authenticated_proxy",
                engagementBoundary: "project_bound",
                projectBoundAuthorityReady: false,
            },
        })
        expect(report.capabilities.find((item) => item.id === "project_engagement_isolation")).toMatchObject({
            status: "partial",
            tasks: [{ id: "3.3", status: "partial" }, { id: "3.4", status: "blocked" }],
        })
        expect(report.capabilities.find((item) => item.id === "project_engagement_isolation")?.summary).toContain("local development")
        expect(JSON.stringify(report)).not.toContain("HOST_TOKEN_ENV")
        expect(JSON.stringify(report)).not.toContain("MODEL_TOKEN_ENV")
    })

    test("makes the shared development boundary and missing Taric configuration visible", () => {
        const unconfigured = buildAuthorizedGovernanceReadiness({ now: new Date("2026-10-28T00:00:00.000Z") })
        expect(unconfigured.deployment).toEqual({
            taricEnabled: false,
            profile: "unconfigured",
            engagementBoundary: "shared_development",
            projectBoundAuthorityReady: false,
        })

        const shared = buildAuthorizedGovernanceReadiness({ taric: { enabled: true, engagementBoundary: "shared_development" } })
        expect(shared).toMatchObject({ status: "partial", deployment: { taricEnabled: true, engagementBoundary: "shared_development", projectBoundAuthorityReady: false } })
        const coverage = shared.capabilities.find((item) => item.id === "coverage_report")
        expect(coverage?.status).toBe("partial")
        expect(coverage?.tasks).toEqual([{ id: "5.5", status: "complete" }, { id: "5.6", status: "partial" }])
    })
})
