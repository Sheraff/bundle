import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'

import { schema } from '../db/index.js'
import { selectOne } from '../db/select-one.js'

import type { CommitGroupSummaryV1, PrReviewSummaryV1 } from '@workspace/contracts'

import type { CommitGroupRow, DbClient, PullRequestRow } from './types.js'

export async function upsertCommitGroupSummary(
  db: DbClient,
  commitGroup: CommitGroupRow,
  summary: CommitGroupSummaryV1,
  timestamp: string,
) {
  const existingSummary = await selectOne(
    db
      .select({ id: schema.commitGroupSummaries.id })
      .from(schema.commitGroupSummaries)
      .where(eq(schema.commitGroupSummaries.commitGroupId, commitGroup.id))
      .limit(1),
  )

  const values = {
    repositoryId: commitGroup.repositoryId,
    commitGroupId: commitGroup.id,
    pullRequestId: commitGroup.pullRequestId,
    commitSha: commitGroup.commitSha,
    branch: commitGroup.branch,
    latestUploadAt: commitGroup.latestUploadAt,
    ...buildCommitGroupSummaryProjection(summary),
    updatedAt: timestamp,
  }

  if (existingSummary) {
    await db
      .update(schema.commitGroupSummaries)
      .set(values)
      .where(eq(schema.commitGroupSummaries.id, existingSummary.id))

    return existingSummary.id
  }

  const createdSummaryId = ulid()
  await db.insert(schema.commitGroupSummaries).values({
    id: createdSummaryId,
    ...values,
    createdAt: timestamp,
  })
  return createdSummaryId
}

export async function upsertPrReviewSummary(
  db: DbClient,
  commitGroup: CommitGroupRow,
  pullRequest: PullRequestRow,
  summary: PrReviewSummaryV1,
  timestamp: string,
) {
  const existingSummary = await selectOne(
    db
      .select({ id: schema.prReviewSummaries.id })
      .from(schema.prReviewSummaries)
      .where(eq(schema.prReviewSummaries.commitGroupId, commitGroup.id))
      .limit(1),
  )

  const values = {
    repositoryId: commitGroup.repositoryId,
    pullRequestId: pullRequest.id,
    commitGroupId: commitGroup.id,
    commitSha: commitGroup.commitSha,
    branch: commitGroup.branch,
    latestUploadAt: commitGroup.latestUploadAt,
    ...buildPrReviewSummaryProjection(summary),
    updatedAt: timestamp,
  }

  if (existingSummary) {
    await db
      .update(schema.prReviewSummaries)
      .set(values)
      .where(eq(schema.prReviewSummaries.id, existingSummary.id))

    return existingSummary.id
  }

  const createdSummaryId = ulid()
  await db.insert(schema.prReviewSummaries).values({
    id: createdSummaryId,
    ...values,
    createdAt: timestamp,
  })
  return createdSummaryId
}

function buildCommitGroupSummaryProjection(summary: CommitGroupSummaryV1) {
  return {
    status: summary.status,
    quietWindowDeadline: summary.quietWindowDeadline,
    settledAt: summary.settledAt,
    expectedScenarioCount: summary.counts.expectedScenarioCount,
    freshScenarioCount: summary.counts.freshScenarioCount,
    pendingScenarioCount: summary.counts.pendingScenarioCount,
    inheritedScenarioCount: summary.counts.inheritedScenarioCount,
    missingScenarioCount: summary.counts.missingScenarioCount,
    failedScenarioCount: summary.counts.failedScenarioCount,
    impactedScenarioCount: summary.counts.impactedScenarioCount,
    unchangedScenarioCount: summary.counts.unchangedScenarioCount,
    comparisonCount: summary.counts.comparisonCount,
    changedMetricCount: summary.counts.changedMetricCount,
    noBaselineSeriesCount: summary.counts.noBaselineSeriesCount,
    failedComparisonCount: summary.counts.failedComparisonCount,
    degradedComparisonCount: summary.counts.degradedComparisonCount,
    summaryJson: JSON.stringify(summary),
  }
}

function buildPrReviewSummaryProjection(summary: PrReviewSummaryV1) {
  return {
    settledAt: summary.settledAt,
    status: summary.status,
    overallState: summary.overallState,
    blockingRegressionCount: summary.counts.blockingRegressionCount,
    regressionCount: summary.counts.regressionCount,
    acknowledgedRegressionCount: summary.counts.acknowledgedRegressionCount,
    improvementCount: summary.counts.improvementCount,
    pendingScenarioCount: summary.counts.pendingScenarioCount,
    inheritedScenarioCount: summary.counts.inheritedScenarioCount,
    missingScenarioCount: summary.counts.missingScenarioCount,
    failedScenarioCount: summary.counts.failedScenarioCount,
    impactedScenarioCount: summary.counts.impactedScenarioCount,
    unchangedScenarioCount: summary.counts.unchangedScenarioCount,
    noBaselineSeriesCount: summary.counts.noBaselineSeriesCount,
    failedComparisonCount: summary.counts.failedComparisonCount,
    degradedComparisonCount: summary.counts.degradedComparisonCount,
    summaryJson: JSON.stringify(summary),
  }
}
