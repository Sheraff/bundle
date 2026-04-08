import { and, asc, desc, eq, inArray, ne } from "drizzle-orm"

import { schema } from "../db/index.js"
import { selectOne } from "../db/select-one.js"

import type { DbClient, SummaryComparisonKind } from "./types.js"

export async function loadActiveSeriesComparisons(
  db: DbClient,
  scenarioRunIds: string[],
  comparisonKind: SummaryComparisonKind,
) {
  if (scenarioRunIds.length === 0) {
    return []
  }

  return db
    .select({
      scenarioRunId: schema.seriesPoints.scenarioRunId,
      seriesId: schema.seriesPoints.seriesId,
      environment: schema.series.environment,
      entrypoint: schema.series.entrypointKey,
      entrypointKind: schema.series.entrypointKind,
      lens: schema.series.lens,
      comparisonId: schema.comparisons.id,
      comparisonStatus: schema.comparisons.status,
      requestedBaseSha: schema.comparisons.requestedBaseSha,
      selectedBaseCommitSha: schema.comparisons.selectedBaseCommitSha,
      selectedHeadCommitSha: schema.comparisons.selectedHeadCommitSha,
      currentTotalRawBytes: schema.comparisons.currentTotalRawBytes,
      currentTotalGzipBytes: schema.comparisons.currentTotalGzipBytes,
      currentTotalBrotliBytes: schema.comparisons.currentTotalBrotliBytes,
      baselineTotalRawBytes: schema.comparisons.baselineTotalRawBytes,
      baselineTotalGzipBytes: schema.comparisons.baselineTotalGzipBytes,
      baselineTotalBrotliBytes: schema.comparisons.baselineTotalBrotliBytes,
      deltaTotalRawBytes: schema.comparisons.deltaTotalRawBytes,
      deltaTotalGzipBytes: schema.comparisons.deltaTotalGzipBytes,
      deltaTotalBrotliBytes: schema.comparisons.deltaTotalBrotliBytes,
      selectedEntrypointRelation: schema.comparisons.selectedEntrypointRelation,
      hasDegradedStableIdentity: schema.comparisons.hasDegradedStableIdentity,
      budgetState: schema.comparisons.budgetState,
      failureCode: schema.comparisons.failureCode,
      failureMessage: schema.comparisons.failureMessage,
    })
    .from(schema.seriesPoints)
    .innerJoin(schema.series, eq(schema.series.id, schema.seriesPoints.seriesId))
    .leftJoin(
      schema.comparisons,
      and(
        eq(schema.comparisons.seriesId, schema.seriesPoints.seriesId),
        eq(schema.comparisons.headScenarioRunId, schema.seriesPoints.scenarioRunId),
        eq(schema.comparisons.kind, comparisonKind),
      ),
    )
    .where(inArray(schema.seriesPoints.scenarioRunId, scenarioRunIds))
    .orderBy(
      asc(schema.series.environment),
      asc(schema.series.entrypointKey),
      asc(schema.series.lens),
    )
}

export async function findInheritedScenarioSource(
  db: DbClient,
  repositoryId: string,
  scenarioId: string,
  excludedCommitGroupId: string,
) {
  return selectOne(
    db
      .select({
        id: schema.scenarioRuns.id,
        commitGroupId: schema.scenarioRuns.commitGroupId,
        commitSha: schema.scenarioRuns.commitSha,
        branch: schema.scenarioRuns.branch,
        uploadedAt: schema.scenarioRuns.uploadedAt,
      })
      .from(schema.scenarioRuns)
      .where(
        and(
          eq(schema.scenarioRuns.repositoryId, repositoryId),
          eq(schema.scenarioRuns.scenarioId, scenarioId),
          eq(schema.scenarioRuns.status, "processed"),
          ne(schema.scenarioRuns.commitGroupId, excludedCommitGroupId),
        ),
      )
      .orderBy(desc(schema.scenarioRuns.uploadedAt), desc(schema.scenarioRuns.createdAt))
      .limit(1),
  )
}
