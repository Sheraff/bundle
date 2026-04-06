import * as v from 'valibot'

import { pluginArtifactV1Schema } from './plugin-artifact.js'
import {
  SCENARIO_SOURCE_KINDS,
  gitShaSchema,
  githubOwnerSchema,
  githubRepoNameSchema,
  nonEmptyStringSchema,
  positiveIntegerSchema,
  schemaVersionV1Schema,
  ulidSchema,
} from './shared.js'

const repositoryContextSchema = v.strictObject({
  githubRepoId: positiveIntegerSchema,
  owner: githubOwnerSchema,
  name: githubRepoNameSchema,
  installationId: positiveIntegerSchema,
})

const gitContextSchema = v.strictObject({
  commitSha: gitShaSchema,
  branch: nonEmptyStringSchema,
})

const pullRequestContextSchema = v.strictObject({
  number: positiveIntegerSchema,
  baseSha: gitShaSchema,
  baseRef: nonEmptyStringSchema,
  headSha: gitShaSchema,
  headRef: nonEmptyStringSchema,
})

const fixtureScenarioSourceSchema = v.strictObject({
  kind: v.literal(SCENARIO_SOURCE_KINDS[0]),
})

const repoSyntheticScenarioSourceSchema = v.strictObject({
  kind: v.literal(SCENARIO_SOURCE_KINDS[1]),
})

const hostedSyntheticScenarioSourceSchema = v.strictObject({
  kind: v.literal(SCENARIO_SOURCE_KINDS[2]),
  hostedScenarioId: ulidSchema,
})

const syntheticDefinitionSchema = v.strictObject({
  displayName: v.optional(nonEmptyStringSchema),
  source: nonEmptyStringSchema,
})

const ciContextSchema = v.strictObject({
  provider: v.literal('github-actions'),
  workflowRunId: nonEmptyStringSchema,
  workflowRunAttempt: v.optional(positiveIntegerSchema),
  job: v.optional(nonEmptyStringSchema),
  actionVersion: v.optional(nonEmptyStringSchema),
})

const uploadEnvelopeBaseEntries = {
  schemaVersion: schemaVersionV1Schema,
  artifact: pluginArtifactV1Schema,
  repository: repositoryContextSchema,
  git: gitContextSchema,
  pullRequest: v.optional(pullRequestContextSchema),
  ci: ciContextSchema,
} as const

export const uploadScenarioRunEnvelopeV1Schema = v.union([
  v.strictObject({
    ...uploadEnvelopeBaseEntries,
    scenarioSource: fixtureScenarioSourceSchema,
  }),
  v.strictObject({
    ...uploadEnvelopeBaseEntries,
    scenarioSource: v.variant('kind', [
      repoSyntheticScenarioSourceSchema,
      hostedSyntheticScenarioSourceSchema,
    ]),
    syntheticDefinition: syntheticDefinitionSchema,
  }),
])

export const scenarioSourceSchema = v.variant('kind', [
  fixtureScenarioSourceSchema,
  repoSyntheticScenarioSourceSchema,
  hostedSyntheticScenarioSourceSchema,
])

export type UploadScenarioRunEnvelopeV1 = v.InferOutput<
  typeof uploadScenarioRunEnvelopeV1Schema
>
export type ScenarioSource = v.InferOutput<typeof scenarioSourceSchema>
export type SyntheticDefinition = v.InferOutput<typeof syntheticDefinitionSchema>
export type RepositoryContext = v.InferOutput<typeof repositoryContextSchema>
export type GitContext = v.InferOutput<typeof gitContextSchema>
export type PullRequestContext = v.InferOutput<typeof pullRequestContextSchema>
