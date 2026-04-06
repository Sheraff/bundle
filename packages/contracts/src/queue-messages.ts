import * as v from 'valibot'

import {
  DETAIL_KINDS,
  QUEUE_KINDS,
  nonEmptyStringSchema,
  schemaVersionV1Schema,
  ulidSchema,
} from './shared.js'

function createQueueMessageSchema<
  TKind extends (typeof QUEUE_KINDS)[number],
  const TEntries extends v.ObjectEntries,
>(kind: TKind, entries: TEntries) {
  return v.strictObject({
    schemaVersion: schemaVersionV1Schema,
    kind: v.literal(kind),
    repositoryId: ulidSchema,
    dedupeKey: nonEmptyStringSchema,
    ...entries,
  })
}

export const normalizeRunQueueMessageSchema = createQueueMessageSchema(
  'normalize-run',
  {
    scenarioRunId: ulidSchema,
  },
)

export const deriveRunQueueMessageSchema = createQueueMessageSchema('derive-run', {
  scenarioRunId: ulidSchema,
})

export const scheduleComparisonsQueueMessageSchema = createQueueMessageSchema(
  'schedule-comparisons',
  {
    scenarioRunId: ulidSchema,
  },
)

export const materializeComparisonQueueMessageSchema = createQueueMessageSchema(
  'materialize-comparison',
  {
    comparisonId: ulidSchema,
  },
)

export const refreshSummariesQueueMessageSchema = createQueueMessageSchema(
  'refresh-summaries',
  {
    commitGroupId: ulidSchema,
  },
)

export const publishGithubQueueMessageSchema = createQueueMessageSchema(
  'publish-github',
  {
    pullRequestId: ulidSchema,
  },
)

export const generateDetailQueueMessageSchema = createQueueMessageSchema(
  'generate-detail',
  {
    comparisonId: ulidSchema,
    detailKind: v.union(DETAIL_KINDS.map((kind) => v.literal(kind))),
  },
)

export const queueMessageSchema = v.variant('kind', [
  normalizeRunQueueMessageSchema,
  deriveRunQueueMessageSchema,
  scheduleComparisonsQueueMessageSchema,
  materializeComparisonQueueMessageSchema,
  refreshSummariesQueueMessageSchema,
  publishGithubQueueMessageSchema,
  generateDetailQueueMessageSchema,
])

export type NormalizeRunQueueMessage = v.InferOutput<
  typeof normalizeRunQueueMessageSchema
>
export type DeriveRunQueueMessage = v.InferOutput<
  typeof deriveRunQueueMessageSchema
>
export type ScheduleComparisonsQueueMessage = v.InferOutput<
  typeof scheduleComparisonsQueueMessageSchema
>
export type MaterializeComparisonQueueMessage = v.InferOutput<
  typeof materializeComparisonQueueMessageSchema
>
export type RefreshSummariesQueueMessage = v.InferOutput<
  typeof refreshSummariesQueueMessageSchema
>
export type PublishGithubQueueMessage = v.InferOutput<
  typeof publishGithubQueueMessageSchema
>
export type GenerateDetailQueueMessage = v.InferOutput<
  typeof generateDetailQueueMessageSchema
>
export type QueueMessage = v.InferOutput<typeof queueMessageSchema>
