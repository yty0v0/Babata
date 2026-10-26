import { describe, expect, test } from "bun:test"
import { buildArtifactToolResultMessage, serializeArtifactToolContent } from "./taric-artifact-tool-result"

describe("Taric artifact tool result projection", () => {
    test("serializes tool content and hides raw bytes from the model message", () => {
        const text = serializeArtifactToolContent([
            { type: "text", text: "secret" },
            { type: "image", text: "" },
        ])
        expect(text).toContain("secret")

        const message = buildArtifactToolResultMessage({
            artifactId: "abc",
            contentRef: "taric-artifact:abc",
            hash: "sha256:deadbeef",
            summary: "bounded",
        })
        expect(message).toContain("artifact_id: abc")
        expect(message).toContain("content_ref: taric-artifact:abc")
        expect(message).toContain("hash: sha256:deadbeef")
        expect(message).not.toContain("secret")
    })
})
