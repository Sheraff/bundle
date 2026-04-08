import * as v from "valibot"

import {
  WORKFLOW_KINDS,
  nonEmptyStringSchema,
  schemaVersionV1Schema,
  ulidSchema,
} from "./shared.js"

function createWorkflowInputSchema<
  TKind extends (typeof WORKFLOW_KINDS)[number],
  const TEntries extends v.ObjectEntries,
>(kind: TKind, entries: TEntries) {
  return v.strictObject({
    schemaVersion: schemaVersionV1Schema,
    kind: v.literal(kind),
    repositoryId: ulidSchema,
    orchestrationKey: nonEmptyStringSchema,
    ...entries,
  })
}

export const commitGroupSettlementWorkflowInputSchema = createWorkflowInputSchema(
  "CommitGroupSettlementWorkflow",
  {
    commitGroupId: ulidSchema,
  },
)

export const prPublishDebounceWorkflowInputSchema = createWorkflowInputSchema(
  "PrPublishDebounceWorkflow",
  {
    pullRequestId: ulidSchema,
  },
)

export const repositoryBackfillWorkflowInputSchema = createWorkflowInputSchema(
  "RepositoryBackfillWorkflow",
  {
    backfillScope: nonEmptyStringSchema,
  },
)

export const workflowInputSchema = v.variant("kind", [
  commitGroupSettlementWorkflowInputSchema,
  prPublishDebounceWorkflowInputSchema,
  repositoryBackfillWorkflowInputSchema,
])

export type CommitGroupSettlementWorkflowInput = v.InferOutput<
  typeof commitGroupSettlementWorkflowInputSchema
>
export type PrPublishDebounceWorkflowInput = v.InferOutput<
  typeof prPublishDebounceWorkflowInputSchema
>
export type RepositoryBackfillWorkflowInput = v.InferOutput<
  typeof repositoryBackfillWorkflowInputSchema
>
export type WorkflowInput = v.InferOutput<typeof workflowInputSchema>
