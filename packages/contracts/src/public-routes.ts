import * as v from "valibot"

import {
  githubOwnerSchema,
  githubRepoNameSchema,
  nonAllStringSchema,
  nonEmptyStringSchema,
  positiveIntegerSchema,
  scenarioSlugSchema,
} from "./shared.js"

const publicRepositoryRouteParamEntries = {
  owner: githubOwnerSchema,
  repo: githubRepoNameSchema,
} as const

export const publicRepositoryRouteParamsSchema = v.strictObject(publicRepositoryRouteParamEntries)

export const publicScenarioRouteParamsSchema = v.strictObject({
  ...publicRepositoryRouteParamEntries,
  scenario: scenarioSlugSchema,
})

export const repositoryOverviewSearchParamsSchema = v.strictObject({
  branch: v.optional(nonEmptyStringSchema),
  lens: nonEmptyStringSchema,
  metric: v.optional(nonEmptyStringSchema),
})

export const repositoryHistorySearchParamsSchema = v.strictObject({
  branch: nonEmptyStringSchema,
  scenario: v.optional(scenarioSlugSchema),
  env: v.optional(nonEmptyStringSchema),
  entrypoint: v.optional(nonEmptyStringSchema),
  lens: nonEmptyStringSchema,
  metric: v.optional(nonEmptyStringSchema),
})

export const scenarioPageSearchParamsSchema = v.strictObject({
  branch: nonEmptyStringSchema,
  env: nonEmptyStringSchema,
  entrypoint: nonEmptyStringSchema,
  lens: nonEmptyStringSchema,
  tab: v.optional(nonEmptyStringSchema),
  metric: v.optional(nonEmptyStringSchema),
})

export const comparePageSearchParamsSchema = v.strictObject({
  base: nonEmptyStringSchema,
  head: nonEmptyStringSchema,
  pr: v.optional(positiveIntegerSchema),
  scenario: v.optional(scenarioSlugSchema),
  env: v.optional(nonAllStringSchema),
  entrypoint: v.optional(nonAllStringSchema),
  lens: v.optional(nonEmptyStringSchema),
  tab: v.optional(nonEmptyStringSchema),
  metric: v.optional(nonEmptyStringSchema),
})

export type PublicRepositoryRouteParams = v.InferOutput<typeof publicRepositoryRouteParamsSchema>
export type PublicScenarioRouteParams = v.InferOutput<typeof publicScenarioRouteParamsSchema>
export type RepositoryOverviewSearchParams = v.InferOutput<
  typeof repositoryOverviewSearchParamsSchema
>
export type RepositoryHistorySearchParams = v.InferOutput<
  typeof repositoryHistorySearchParamsSchema
>
export type ScenarioPageSearchParams = v.InferOutput<typeof scenarioPageSearchParamsSchema>
export type ComparePageSearchParams = v.InferOutput<typeof comparePageSearchParamsSchema>
