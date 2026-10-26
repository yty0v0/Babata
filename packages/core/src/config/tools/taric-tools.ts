import { defineTool } from "@mariozechner/pi-coding-agent"
import type { Static } from "@sinclair/typebox"
import { Type } from "@sinclair/typebox"
import { requestHostBridge } from "../../challenge/host-bridge-client"

const TaricBoardQueryParams = Type.Object({
    operation: Type.Union([Type.Literal("context.query"), Type.Literal("resource.query"), Type.Literal("evidence.query")], {
        description: "Scoped Taric read operation. Write, admission, work, host-state, and artifact operations are not model-callable.",
    }),
    budget: Type.Optional(Type.Number({ minimum: 1, maximum: 4000 })),
    cursor: Type.Optional(Type.String({ maxLength: 256 })),
    read_seq: Type.Optional(Type.Number({ minimum: 0 })),
    filters: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    ordering: Type.Optional(Type.String({ maxLength: 128 })),
    work_item_id: Type.Optional(Type.String({ maxLength: 128 })),
    worker_role: Type.Optional(Type.String({ maxLength: 64 })),
    as_of: Type.Optional(Type.Number({ minimum: 0 })),
    page_size: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
    kind: Type.Optional(Type.String({ maxLength: 64 })),
    // Admitted checkpoints/claims are L1. Taric keeps L0 proposals hidden.
    include_candidates: Type.Optional(Type.Boolean({ description: "Include admitted L1 records such as checkpoints and claims. L0 candidates stay hidden." })),
})

type TaricBoardQueryInput = Static<typeof TaricBoardQueryParams>

export const taricBoardQueryTool = defineTool({
    name: "taric_board_query",
    label: "Taric Board Query",
    description: "Read the scoped Taric board. Only context, resource, and evidence queries are available.",
    promptSnippet: "taric_board_query: read scoped Taric context, resources, or evidence",
    parameters: TaricBoardQueryParams,
    async execute(_toolCallId, params: TaricBoardQueryInput) {
        const details = await requestHostBridge<unknown>("taric_board_query", params)
        return {
            content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
            details,
        }
    },
})



const TaricProposalSubmitParams = Type.Object({
    kind: Type.Union([Type.Literal("work_item"), Type.Literal("claim"), Type.Literal("checkpoint"), Type.Literal("correction")], {
        description: "Typed proposal kind. Arbitrary writes, admission, work, host-state, and artifact operations are rejected.",
    }),
    expected_version: Type.Number({ minimum: 0 }),
    target_id: Type.Optional(Type.String({ maxLength: 128 })),
    subject_ref: Type.Optional(Type.String({ maxLength: 128 })),
    content: Type.Record(Type.String(), Type.Unknown()),
})

type TaricProposalSubmitInput = Static<typeof TaricProposalSubmitParams>

export const taricProposalSubmitTool = defineTool({
    name: "taric_proposal_submit",
    label: "Taric Proposal Submit",
    description: "Submit a typed pending L0 proposal. Admission and trust levels are host-controlled.",
    promptSnippet: "taric_proposal_submit: submit typed work_item, claim, checkpoint, or correction proposals",
    parameters: TaricProposalSubmitParams,
    async execute(_toolCallId, params: TaricProposalSubmitInput) {
        const details = await requestHostBridge<unknown>("taric_proposal_submit", params)
        return {
            content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
            details,
        }
    },
})

export const taricTools = [taricBoardQueryTool, taricProposalSubmitTool]
export const taricToolNames = new Set(taricTools.map((tool) => tool.name))
