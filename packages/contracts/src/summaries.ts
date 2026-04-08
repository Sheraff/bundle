import * as v from "valibot"

import {
  gitShaSchema,
  isoTimestampSchema,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  noteSchema,
  scenarioSlugSchema,
  schemaVersionV1Schema,
  ulidSchema,
} from "./shared.js"

const integerSchema = v.pipe(v.number(), v.integer())

export const summaryComparisonKinds = ["branch-previous", "pr-base"] as const
export const summaryStatuses = ["pending", "settled"] as const
export const comparisonMetricKeys = [
  "total-raw-bytes",
  "total-gzip-bytes",
  "total-brotli-bytes",
] as const
export const reviewItemStates = ["blocking", "regression", "acknowledged", "improvement"] as const
export const reviewSeriesStates = [
  "blocking",
  "regression",
  "acknowledged",
  "improvement",
  "warning",
  "neutral",
] as const

const summaryComparisonKindSchema = v.union(summaryComparisonKinds.map((kind) => v.literal(kind)))
const summaryStatusSchema = v.union(summaryStatuses.map((status) => v.literal(status)))
const comparisonMetricKeySchema = v.union(
  comparisonMetricKeys.map((metricKey) => v.literal(metricKey)),
)
const reviewItemStateSchema = v.union(
  reviewItemStates.map((reviewItemState) => v.literal(reviewItemState)),
)
const reviewSeriesStateSchema = v.union(
  reviewSeriesStates.map((reviewSeriesState) => v.literal(reviewSeriesState)),
)
const totalSizeSummarySchema = v.strictObject({
  raw: nonNegativeIntegerSchema,
  gzip: nonNegativeIntegerSchema,
  brotli: nonNegativeIntegerSchema,
})
const deltaSizeSummarySchema = v.strictObject({
  raw: integerSchema,
  gzip: integerSchema,
  brotli: integerSchema,
})

export const neutralComparisonItemSummaryV1Schema = v.strictObject({
  itemKey: nonEmptyStringSchema,
  metricKey: comparisonMetricKeySchema,
  currentValue: nonNegativeIntegerSchema,
  baselineValue: nonNegativeIntegerSchema,
  deltaValue: integerSchema,
  percentageDelta: v.number(),
  direction: v.union([v.literal("regression"), v.literal("improvement")]),
})

const neutralComparisonSeriesBaseEntries = {
  comparisonId: ulidSchema,
  seriesId: ulidSchema,
  scenarioRunId: ulidSchema,
  environment: nonEmptyStringSchema,
  entrypoint: nonEmptyStringSchema,
  entrypointKind: nonEmptyStringSchema,
  lens: nonEmptyStringSchema,
  requestedBaseSha: v.nullable(gitShaSchema),
  selectedBaseCommitSha: v.nullable(gitShaSchema),
  selectedHeadCommitSha: gitShaSchema,
  currentTotals: totalSizeSummarySchema,
  baselineTotals: v.nullable(totalSizeSummarySchema),
  deltaTotals: v.nullable(deltaSizeSummarySchema),
  budgetState: nonEmptyStringSchema,
  hasDegradedStableIdentity: v.boolean(),
  selectedEntrypointRelation: v.nullable(nonEmptyStringSchema),
} as const

export const neutralComparisonSeriesSummaryV1Schema = v.variant("status", [
  v.strictObject({
    ...neutralComparisonSeriesBaseEntries,
    status: v.literal("materialized"),
    items: v.array(neutralComparisonItemSummaryV1Schema),
  }),
  v.strictObject({
    ...neutralComparisonSeriesBaseEntries,
    status: v.literal("no-baseline"),
    items: v.array(neutralComparisonItemSummaryV1Schema),
  }),
  v.strictObject({
    ...neutralComparisonSeriesBaseEntries,
    status: v.literal("failed"),
    items: v.array(neutralComparisonItemSummaryV1Schema),
    failureCode: nonEmptyStringSchema,
    failureMessage: nonEmptyStringSchema,
  }),
])

export const freshCommitGroupScenarioSummaryV1Schema = v.strictObject({
  scenarioId: ulidSchema,
  scenarioSlug: scenarioSlugSchema,
  sourceKind: nonEmptyStringSchema,
  activeScenarioRunId: ulidSchema,
  activeCommitSha: gitShaSchema,
  activeUploadedAt: isoTimestampSchema,
  totalRunCount: nonNegativeIntegerSchema,
  processedRunCount: nonNegativeIntegerSchema,
  failedRunCount: nonNegativeIntegerSchema,
  hasMultipleProcessedRuns: v.boolean(),
  hasNewerFailedRun: v.boolean(),
  latestFailedScenarioRunId: v.nullable(ulidSchema),
  latestFailedAt: v.nullable(isoTimestampSchema),
  latestFailureCode: v.nullable(nonEmptyStringSchema),
  latestFailureMessage: v.nullable(nonEmptyStringSchema),
  series: v.array(neutralComparisonSeriesSummaryV1Schema),
})

export const commitGroupStatusScenarioSummaryV1Schema = v.variant("state", [
  v.strictObject({
    state: v.literal("inherited"),
    scenarioId: ulidSchema,
    scenarioSlug: scenarioSlugSchema,
    sourceKind: nonEmptyStringSchema,
    sourceScenarioRunId: ulidSchema,
    sourceCommitGroupId: ulidSchema,
    sourceCommitSha: gitShaSchema,
    sourceBranch: nonEmptyStringSchema,
    sourceUploadedAt: isoTimestampSchema,
  }),
  v.strictObject({
    state: v.literal("missing"),
    scenarioId: ulidSchema,
    scenarioSlug: scenarioSlugSchema,
    sourceKind: nonEmptyStringSchema,
    reason: nonEmptyStringSchema,
  }),
  v.strictObject({
    state: v.literal("failed"),
    scenarioId: ulidSchema,
    scenarioSlug: scenarioSlugSchema,
    sourceKind: nonEmptyStringSchema,
    latestFailedScenarioRunId: ulidSchema,
    latestFailedAt: isoTimestampSchema,
    failureCode: v.nullable(nonEmptyStringSchema),
    failureMessage: v.nullable(nonEmptyStringSchema),
  }),
])

export const commitGroupSummaryCountsV1Schema = v.strictObject({
  expectedScenarioCount: nonNegativeIntegerSchema,
  freshScenarioCount: nonNegativeIntegerSchema,
  pendingScenarioCount: nonNegativeIntegerSchema,
  inheritedScenarioCount: nonNegativeIntegerSchema,
  missingScenarioCount: nonNegativeIntegerSchema,
  failedScenarioCount: nonNegativeIntegerSchema,
  impactedScenarioCount: nonNegativeIntegerSchema,
  unchangedScenarioCount: nonNegativeIntegerSchema,
  comparisonCount: nonNegativeIntegerSchema,
  changedMetricCount: nonNegativeIntegerSchema,
  noBaselineSeriesCount: nonNegativeIntegerSchema,
  failedComparisonCount: nonNegativeIntegerSchema,
  degradedComparisonCount: nonNegativeIntegerSchema,
})

export const commitGroupSummaryV1Schema = v.strictObject({
  schemaVersion: schemaVersionV1Schema,
  repositoryId: ulidSchema,
  commitGroupId: ulidSchema,
  pullRequestId: v.nullable(ulidSchema),
  comparisonKind: summaryComparisonKindSchema,
  commitSha: gitShaSchema,
  branch: nonEmptyStringSchema,
  status: summaryStatusSchema,
  quietWindowDeadline: isoTimestampSchema,
  settledAt: v.nullable(isoTimestampSchema),
  counts: commitGroupSummaryCountsV1Schema,
  freshScenarioGroups: v.array(freshCommitGroupScenarioSummaryV1Schema),
  statusScenarios: v.array(commitGroupStatusScenarioSummaryV1Schema),
})

export const reviewedComparisonItemSummaryV1Schema = v.strictObject({
  itemKey: nonEmptyStringSchema,
  metricKey: comparisonMetricKeySchema,
  currentValue: nonNegativeIntegerSchema,
  baselineValue: nonNegativeIntegerSchema,
  deltaValue: integerSchema,
  percentageDelta: v.number(),
  reviewState: reviewItemStateSchema,
  acknowledged: v.boolean(),
  acknowledgementId: v.nullable(ulidSchema),
  note: v.nullable(noteSchema),
})

const reviewedComparisonSeriesBaseEntries = {
  comparisonId: ulidSchema,
  seriesId: ulidSchema,
  scenarioRunId: ulidSchema,
  environment: nonEmptyStringSchema,
  entrypoint: nonEmptyStringSchema,
  entrypointKind: nonEmptyStringSchema,
  lens: nonEmptyStringSchema,
  requestedBaseSha: v.nullable(gitShaSchema),
  selectedBaseCommitSha: v.nullable(gitShaSchema),
  selectedHeadCommitSha: gitShaSchema,
  currentTotals: totalSizeSummarySchema,
  baselineTotals: v.nullable(totalSizeSummarySchema),
  deltaTotals: v.nullable(deltaSizeSummarySchema),
  budgetState: nonEmptyStringSchema,
  hasDegradedStableIdentity: v.boolean(),
  selectedEntrypointRelation: v.nullable(nonEmptyStringSchema),
  reviewState: reviewSeriesStateSchema,
} as const

export const reviewedComparisonSeriesSummaryV1Schema = v.variant("status", [
  v.strictObject({
    ...reviewedComparisonSeriesBaseEntries,
    status: v.literal("materialized"),
    items: v.array(reviewedComparisonItemSummaryV1Schema),
    primaryItemKey: v.nullable(nonEmptyStringSchema),
  }),
  v.strictObject({
    ...reviewedComparisonSeriesBaseEntries,
    status: v.literal("no-baseline"),
    items: v.array(reviewedComparisonItemSummaryV1Schema),
    primaryItemKey: v.nullable(nonEmptyStringSchema),
  }),
  v.strictObject({
    ...reviewedComparisonSeriesBaseEntries,
    status: v.literal("failed"),
    items: v.array(reviewedComparisonItemSummaryV1Schema),
    primaryItemKey: v.nullable(nonEmptyStringSchema),
    failureCode: nonEmptyStringSchema,
    failureMessage: nonEmptyStringSchema,
  }),
])

export const reviewedScenarioSummaryV1Schema = v.strictObject({
  scenarioId: ulidSchema,
  scenarioSlug: scenarioSlugSchema,
  sourceKind: nonEmptyStringSchema,
  reviewState: reviewSeriesStateSchema,
  hasNewerFailedRun: v.boolean(),
  latestFailedScenarioRunId: v.nullable(ulidSchema),
  latestFailedAt: v.nullable(isoTimestampSchema),
  latestFailureCode: v.nullable(nonEmptyStringSchema),
  latestFailureMessage: v.nullable(nonEmptyStringSchema),
  visibleSeriesId: v.nullable(ulidSchema),
  additionalChangedSeriesCount: nonNegativeIntegerSchema,
  acknowledgedItemCount: nonNegativeIntegerSchema,
  series: v.array(reviewedComparisonSeriesSummaryV1Schema),
})

export const prReviewSummaryCountsV1Schema = v.strictObject({
  blockingRegressionCount: nonNegativeIntegerSchema,
  regressionCount: nonNegativeIntegerSchema,
  acknowledgedRegressionCount: nonNegativeIntegerSchema,
  improvementCount: nonNegativeIntegerSchema,
  pendingScenarioCount: nonNegativeIntegerSchema,
  inheritedScenarioCount: nonNegativeIntegerSchema,
  missingScenarioCount: nonNegativeIntegerSchema,
  failedScenarioCount: nonNegativeIntegerSchema,
  impactedScenarioCount: nonNegativeIntegerSchema,
  unchangedScenarioCount: nonNegativeIntegerSchema,
  noBaselineSeriesCount: nonNegativeIntegerSchema,
  failedComparisonCount: nonNegativeIntegerSchema,
  degradedComparisonCount: nonNegativeIntegerSchema,
})

export const prReviewSummaryV1Schema = v.strictObject({
  schemaVersion: schemaVersionV1Schema,
  repositoryId: ulidSchema,
  pullRequestId: ulidSchema,
  commitGroupId: ulidSchema,
  commitSha: gitShaSchema,
  branch: nonEmptyStringSchema,
  baseSha: gitShaSchema,
  baseRef: nonEmptyStringSchema,
  headSha: gitShaSchema,
  headRef: nonEmptyStringSchema,
  status: summaryStatusSchema,
  overallState: v.union([v.literal("pending"), v.literal("failing"), v.literal("passing")]),
  settledAt: v.nullable(isoTimestampSchema),
  counts: prReviewSummaryCountsV1Schema,
  scenarioGroups: v.array(reviewedScenarioSummaryV1Schema),
  statusScenarios: v.array(commitGroupStatusScenarioSummaryV1Schema),
})

export type ComparisonMetricKey = (typeof comparisonMetricKeys)[number]
export type ReviewItemState = (typeof reviewItemStates)[number]
export type ReviewSeriesState = (typeof reviewSeriesStates)[number]
export type NeutralComparisonItemSummaryV1 = v.InferOutput<
  typeof neutralComparisonItemSummaryV1Schema
>
export type NeutralComparisonSeriesSummaryV1 = v.InferOutput<
  typeof neutralComparisonSeriesSummaryV1Schema
>
export type FreshCommitGroupScenarioSummaryV1 = v.InferOutput<
  typeof freshCommitGroupScenarioSummaryV1Schema
>
export type CommitGroupStatusScenarioSummaryV1 = v.InferOutput<
  typeof commitGroupStatusScenarioSummaryV1Schema
>
export type CommitGroupSummaryCountsV1 = v.InferOutput<typeof commitGroupSummaryCountsV1Schema>
export type CommitGroupSummaryV1 = v.InferOutput<typeof commitGroupSummaryV1Schema>
export type ReviewedComparisonItemSummaryV1 = v.InferOutput<
  typeof reviewedComparisonItemSummaryV1Schema
>
export type ReviewedComparisonSeriesSummaryV1 = v.InferOutput<
  typeof reviewedComparisonSeriesSummaryV1Schema
>
export type ReviewedScenarioSummaryV1 = v.InferOutput<typeof reviewedScenarioSummaryV1Schema>
export type PrReviewSummaryCountsV1 = v.InferOutput<typeof prReviewSummaryCountsV1Schema>
export type PrReviewSummaryV1 = v.InferOutput<typeof prReviewSummaryV1Schema>
