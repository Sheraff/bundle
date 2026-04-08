import * as v from "valibot"

import { noteSchema, nonEmptyStringSchema, scenarioSlugSchema, ulidSchema } from "./shared.js"

export const acknowledgeComparisonItemInputSchema = v.strictObject({
  repositoryId: ulidSchema,
  pullRequestId: ulidSchema,
  comparisonId: ulidSchema,
  seriesId: ulidSchema,
  itemKey: nonEmptyStringSchema,
  note: v.optional(noteSchema),
})

export const createHostedSyntheticScenarioInputSchema = v.strictObject({
  repositoryId: ulidSchema,
  scenarioId: scenarioSlugSchema,
  displayName: v.optional(nonEmptyStringSchema),
  source: nonEmptyStringSchema,
})

export const updateHostedSyntheticScenarioInputSchema = v.strictObject({
  repositoryId: ulidSchema,
  scenarioId: scenarioSlugSchema,
  displayName: v.optional(nonEmptyStringSchema),
  source: nonEmptyStringSchema,
})

export const archiveHostedSyntheticScenarioInputSchema = v.strictObject({
  repositoryId: ulidSchema,
  scenarioId: scenarioSlugSchema,
})

export type AcknowledgeComparisonItemInput = v.InferOutput<
  typeof acknowledgeComparisonItemInputSchema
>
export type CreateHostedSyntheticScenarioInput = v.InferOutput<
  typeof createHostedSyntheticScenarioInputSchema
>
export type UpdateHostedSyntheticScenarioInput = v.InferOutput<
  typeof updateHostedSyntheticScenarioInputSchema
>
export type ArchiveHostedSyntheticScenarioInput = v.InferOutput<
  typeof archiveHostedSyntheticScenarioInputSchema
>
