import {
  SCHEMA_VERSION_V1,
  commitGroupSettlementWorkflowInputSchema,
  commitGroupSummaryV1Schema,
  prReviewSummaryV1Schema,
  refreshSummariesQueueMessageSchema,
  type CommitGroupSummaryV1,
  type ComparisonMetricKey,
  type FreshCommitGroupScenarioSummaryV1,
  type NeutralComparisonItemSummaryV1,
  type NeutralComparisonSeriesSummaryV1,
  type PrReviewSummaryV1,
  type RefreshSummariesQueueMessage,
  type ReviewedComparisonItemSummaryV1,
  type ReviewedComparisonSeriesSummaryV1,
  type ReviewedScenarioSummaryV1,
  type ReviewItemState,
  type ReviewSeriesState,
} from '@workspace/contracts'
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm'
import * as v from 'valibot'
import { ulid } from 'ulid'

import { getDb, schema } from './db/index.js'
import type { AppBindings } from './env.js'

type QueueMessageLike<TBody> = Pick<Message<TBody>, 'ack' | 'retry' | 'body' | 'id' | 'attempts'>
type CommitGroupRow = typeof schema.commitGroups.$inferSelect
type PullRequestRow = typeof schema.pullRequests.$inferSelect
type SummaryComparisonKind = CommitGroupSummaryV1['comparisonKind']

interface QueueLogger {
  error: typeof console.error
  warn: typeof console.warn
}

interface ScenarioCatalogRow {
  id: string
  slug: string
  sourceKind: string
}

interface ScenarioRunSummaryRow {
  id: string
  scenarioId: string
  scenarioSlug: string
  sourceKind: string
  status: string
  commitGroupId: string
  commitSha: string
  branch: string
  uploadedAt: string
  createdAt: string
  failureCode: string | null
  failureMessage: string | null
}

interface ActiveSeriesComparisonRow {
  scenarioRunId: string
  seriesId: string
  environment: string
  entrypoint: string
  entrypointKind: string
  lens: string
  comparisonId: string | null
  comparisonStatus: string | null
  requestedBaseSha: string | null
  selectedBaseCommitSha: string | null
  selectedHeadCommitSha: string | null
  currentTotalRawBytes: number | null
  currentTotalGzipBytes: number | null
  currentTotalBrotliBytes: number | null
  baselineTotalRawBytes: number | null
  baselineTotalGzipBytes: number | null
  baselineTotalBrotliBytes: number | null
  deltaTotalRawBytes: number | null
  deltaTotalGzipBytes: number | null
  deltaTotalBrotliBytes: number | null
  selectedEntrypointRelation: string | null
  hasDegradedStableIdentity: number | null
  budgetState: string | null
  failureCode: string | null
  failureMessage: string | null
}

interface AcknowledgementOverlayRow {
  id: string
  comparisonId: string
  itemKey: string
  note: string | null
}

interface ExistingSummaryState {
  status: string
  settledAt: string | null
}

const METRIC_KEY_ORDER = [
  'total-raw-bytes',
  'total-gzip-bytes',
  'total-brotli-bytes',
] as const satisfies readonly ComparisonMetricKey[]
const SERIES_REVIEW_PRIORITY: Record<ReviewSeriesState, number> = {
  blocking: 0,
  regression: 1,
  acknowledged: 2,
  warning: 3,
  improvement: 4,
  neutral: 5,
}
const ITEM_REVIEW_PRIORITY: Record<ReviewItemState, number> = {
  blocking: 0,
  regression: 1,
  acknowledged: 2,
  improvement: 3,
}
const BLOCKING_BUDGET_STATES = new Set(['blocking', 'failing', 'failed'])

export const COMMIT_GROUP_SETTLEMENT_QUIET_WINDOW_MS = 30_000

export async function handleRefreshSummariesQueue(
  batch: MessageBatch<unknown>,
  env: AppBindings,
  _ctx?: ExecutionContext,
  logger: QueueLogger = console,
) {
  for (const message of batch.messages) {
    await handleRefreshSummariesMessage(message, env, logger)
  }
}

export async function handleRefreshSummariesMessage(
  message: QueueMessageLike<unknown>,
  env: AppBindings,
  logger: QueueLogger = console,
) {
  const messageResult = v.safeParse(refreshSummariesQueueMessageSchema, message.body)

  if (!messageResult.success) {
    logger.error('Dropping invalid refresh-summaries message', formatIssues(messageResult.issues))
    message.ack()
    return
  }

  try {
    await refreshSummariesForCommitGroup(env, messageResult.output)
    message.ack()
  } catch (error) {
    if (error instanceof TerminalRefreshSummariesError) {
      logger.warn(error.message)
      message.ack()
      return
    }

    logger.error('Retrying refresh-summaries message after transient failure', error)
    message.retry()
  }
}

export async function enqueueRefreshSummaries(
  env: AppBindings,
  repositoryId: string,
  commitGroupId: string,
  reasonKey: string,
) {
  const messageResult = v.safeParse(refreshSummariesQueueMessageSchema, {
    schemaVersion: SCHEMA_VERSION_V1,
    kind: 'refresh-summaries',
    repositoryId,
    commitGroupId,
    dedupeKey: `refresh-summaries:${commitGroupId}:${reasonKey}:v1`,
  })

  if (!messageResult.success) {
    throw new Error(
      `Generated refresh-summaries message is invalid: ${formatIssues(messageResult.issues)}`,
    )
  }

  await env.REFRESH_SUMMARIES_QUEUE.send(messageResult.output, {
    contentType: 'json',
  })
}

async function refreshSummariesForCommitGroup(
  env: AppBindings,
  message: RefreshSummariesQueueMessage,
) {
  const db = getDb(env)
  const commitGroup = await selectOne(
    db
      .select()
      .from(schema.commitGroups)
      .where(eq(schema.commitGroups.id, message.commitGroupId))
      .limit(1),
  )

  if (!commitGroup) {
    throw new TerminalRefreshSummariesError(
      `Commit group ${message.commitGroupId} no longer exists.`,
    )
  }

  if (commitGroup.repositoryId !== message.repositoryId) {
    throw new TerminalRefreshSummariesError(
      `Commit group ${commitGroup.id} does not belong to repository ${message.repositoryId}.`,
    )
  }

  const pullRequest = commitGroup.pullRequestId
    ? await selectOne(
        db
          .select()
          .from(schema.pullRequests)
          .where(eq(schema.pullRequests.id, commitGroup.pullRequestId))
          .limit(1),
      )
    : null

  const existingSummaryState = await selectOne(
    db
      .select({
        status: schema.commitGroupSummaries.status,
        settledAt: schema.commitGroupSummaries.settledAt,
      })
      .from(schema.commitGroupSummaries)
      .where(eq(schema.commitGroupSummaries.commitGroupId, commitGroup.id))
      .limit(1),
  )

  const { summary, shouldScheduleSettlement } = await buildCommitGroupSummary(
    env,
    commitGroup,
    existingSummaryState,
  )
  const timestamp = new Date().toISOString()

  await upsertCommitGroupSummary(db, commitGroup, summary, timestamp)
  await db
    .update(schema.commitGroups)
    .set({
      status: summary.status,
      updatedAt: timestamp,
    })
    .where(eq(schema.commitGroups.id, commitGroup.id))

  if (shouldScheduleSettlement) {
    await scheduleCommitGroupSettlementWorkflow(env, commitGroup)
  }

  if (!pullRequest) {
    await db
      .delete(schema.prReviewSummaries)
      .where(eq(schema.prReviewSummaries.commitGroupId, commitGroup.id))
    return
  }

  const prSummary = await buildPrReviewSummary(env, commitGroup, pullRequest, summary)
  await upsertPrReviewSummary(db, commitGroup, pullRequest, prSummary, timestamp)
}

async function buildCommitGroupSummary(
  env: AppBindings,
  commitGroup: CommitGroupRow,
  existingSummaryState: ExistingSummaryState | null,
) {
  const db = getDb(env)
  const [catalogScenarios, scenarioRuns] = await Promise.all([
    db
      .select({
        id: schema.scenarios.id,
        slug: schema.scenarios.slug,
        sourceKind: schema.scenarios.sourceKind,
      })
      .from(schema.scenarios)
      .where(eq(schema.scenarios.repositoryId, commitGroup.repositoryId))
      .orderBy(asc(schema.scenarios.slug)),
    db
      .select({
        id: schema.scenarioRuns.id,
        scenarioId: schema.scenarioRuns.scenarioId,
        scenarioSlug: schema.scenarios.slug,
        sourceKind: schema.scenarios.sourceKind,
        status: schema.scenarioRuns.status,
        commitGroupId: schema.scenarioRuns.commitGroupId,
        commitSha: schema.scenarioRuns.commitSha,
        branch: schema.scenarioRuns.branch,
        uploadedAt: schema.scenarioRuns.uploadedAt,
        createdAt: schema.scenarioRuns.createdAt,
        failureCode: schema.scenarioRuns.failureCode,
        failureMessage: schema.scenarioRuns.failureMessage,
      })
      .from(schema.scenarioRuns)
      .innerJoin(schema.scenarios, eq(schema.scenarios.id, schema.scenarioRuns.scenarioId))
      .where(eq(schema.scenarioRuns.commitGroupId, commitGroup.id))
      .orderBy(desc(schema.scenarioRuns.uploadedAt), desc(schema.scenarioRuns.createdAt)),
  ])

  const comparisonKind: SummaryComparisonKind = commitGroup.pullRequestId ? 'pr-base' : 'branch-previous'
  const runsByScenarioId = new Map<string, ScenarioRunSummaryRow[]>()

  for (const scenarioRun of scenarioRuns) {
    const currentRuns = runsByScenarioId.get(scenarioRun.scenarioId) ?? []
    currentRuns.push(scenarioRun)
    runsByScenarioId.set(scenarioRun.scenarioId, currentRuns)
  }

  const activeRunsByScenarioId = new Map<string, ScenarioRunSummaryRow>()

  for (const [scenarioId, runs] of runsByScenarioId.entries()) {
    const activeRun = runs.find((run) => run.status === 'processed')
    if (activeRun) {
      activeRunsByScenarioId.set(scenarioId, activeRun)
    }
  }

  const activeRunIds = [...activeRunsByScenarioId.values()].map((run) => run.id)
  const activeSeriesRows = await loadActiveSeriesComparisons(db, activeRunIds, comparisonKind)
  const seriesRowsByScenarioRunId = new Map<string, ActiveSeriesComparisonRow[]>()

  for (const activeSeriesRow of activeSeriesRows) {
    const currentSeriesRows = seriesRowsByScenarioRunId.get(activeSeriesRow.scenarioRunId) ?? []
    currentSeriesRows.push(activeSeriesRow)
    seriesRowsByScenarioRunId.set(activeSeriesRow.scenarioRunId, currentSeriesRows)
  }

  const quietWindowDeadline = new Date(
    Date.parse(commitGroup.latestUploadAt) + COMMIT_GROUP_SETTLEMENT_QUIET_WINDOW_MS,
  ).toISOString()
  const quietWindowElapsed = Date.now() >= Date.parse(quietWindowDeadline)
  const freshScenarioGroups: FreshCommitGroupScenarioSummaryV1[] = []
  const statusScenarios: CommitGroupSummaryV1['statusScenarios'] = []
  let pendingScenarioCount = 0
  let unresolvedAbsentScenarioCount = 0

  for (const catalogScenario of catalogScenarios) {
    const scenarioRunsForScenario = runsByScenarioId.get(catalogScenario.id) ?? []
    const activeRun = activeRunsByScenarioId.get(catalogScenario.id)
    const latestFailedRun = scenarioRunsForScenario.find((scenarioRun) => scenarioRun.status === 'failed') ?? null
    const hasInFlightRun = scenarioRunsForScenario.some(
      (scenarioRun) => scenarioRun.status === 'queued' || scenarioRun.status === 'processing',
    )

    if (activeRun) {
      freshScenarioGroups.push(
        buildFreshScenarioGroup(
          catalogScenario,
          activeRun,
          latestFailedRun,
          scenarioRunsForScenario,
          seriesRowsByScenarioRunId.get(activeRun.id) ?? [],
        ),
      )
    }

    if (hasInFlightRun) {
      pendingScenarioCount += 1
      continue
    }

    if (activeRun) {
      continue
    }

    if (latestFailedRun) {
      statusScenarios.push({
        state: 'failed',
        scenarioId: catalogScenario.id,
        scenarioSlug: catalogScenario.slug,
        sourceKind: catalogScenario.sourceKind,
        latestFailedScenarioRunId: latestFailedRun.id,
        latestFailedAt: latestFailedRun.uploadedAt,
        failureCode: latestFailedRun.failureCode,
        failureMessage: latestFailedRun.failureMessage,
      })
      continue
    }

    if (!quietWindowElapsed) {
      pendingScenarioCount += 1
      unresolvedAbsentScenarioCount += 1
      continue
    }

    const inheritedSource = await findInheritedScenarioSource(
      db,
      commitGroup.repositoryId,
      catalogScenario.id,
      commitGroup.id,
    )

    if (inheritedSource) {
      statusScenarios.push({
        state: 'inherited',
        scenarioId: catalogScenario.id,
        scenarioSlug: catalogScenario.slug,
        sourceKind: catalogScenario.sourceKind,
        sourceScenarioRunId: inheritedSource.id,
        sourceCommitGroupId: inheritedSource.commitGroupId,
        sourceCommitSha: inheritedSource.commitSha,
        sourceBranch: inheritedSource.branch,
        sourceUploadedAt: inheritedSource.uploadedAt,
      })
      continue
    }

    statusScenarios.push({
      state: 'missing',
      scenarioId: catalogScenario.id,
      scenarioSlug: catalogScenario.slug,
      sourceKind: catalogScenario.sourceKind,
      reason: 'No prior processed scenario run was available to inherit.',
    })
  }

  const comparisonCount = freshScenarioGroups.reduce(
    (total, freshScenarioGroup) => total + freshScenarioGroup.series.length,
    0,
  )
  const changedMetricCount = freshScenarioGroups.reduce(
    (total, freshScenarioGroup) =>
      total +
      freshScenarioGroup.series.reduce((groupTotal, seriesSummary) => groupTotal + seriesSummary.items.length, 0),
    0,
  )
  const noBaselineSeriesCount = freshScenarioGroups.reduce(
    (total, freshScenarioGroup) =>
      total + freshScenarioGroup.series.filter((seriesSummary) => seriesSummary.status === 'no-baseline').length,
    0,
  )
  const failedComparisonCount = freshScenarioGroups.reduce(
    (total, freshScenarioGroup) =>
      total + freshScenarioGroup.series.filter((seriesSummary) => seriesSummary.status === 'failed').length,
    0,
  )
  const degradedComparisonCount = freshScenarioGroups.reduce(
    (total, freshScenarioGroup) =>
      total +
      freshScenarioGroup.series.filter(
        (seriesSummary) =>
          seriesSummary.status === 'materialized' && seriesSummary.hasDegradedStableIdentity,
      ).length,
    0,
  )
  const impactedScenarioCount = freshScenarioGroups.filter(isFreshScenarioImpacted).length
  const unchangedScenarioCount = freshScenarioGroups.filter(isFreshScenarioUnchanged).length
  const summaryStatus: CommitGroupSummaryV1['status'] = pendingScenarioCount > 0 ? 'pending' : 'settled'
  const settledAt =
    summaryStatus === 'settled'
      ? existingSummaryState?.status === 'settled' && existingSummaryState.settledAt
        ? existingSummaryState.settledAt
        : new Date().toISOString()
      : null
  const summaryResult = v.safeParse(commitGroupSummaryV1Schema, {
    schemaVersion: SCHEMA_VERSION_V1,
    repositoryId: commitGroup.repositoryId,
    commitGroupId: commitGroup.id,
    pullRequestId: commitGroup.pullRequestId,
    comparisonKind,
    commitSha: commitGroup.commitSha,
    branch: commitGroup.branch,
    status: summaryStatus,
    quietWindowDeadline,
    settledAt,
    counts: {
      expectedScenarioCount: catalogScenarios.length,
      freshScenarioCount: activeRunsByScenarioId.size,
      pendingScenarioCount,
      inheritedScenarioCount: statusScenarios.filter((scenario) => scenario.state === 'inherited').length,
      missingScenarioCount: statusScenarios.filter((scenario) => scenario.state === 'missing').length,
      failedScenarioCount: statusScenarios.filter((scenario) => scenario.state === 'failed').length,
      impactedScenarioCount,
      unchangedScenarioCount,
      comparisonCount,
      changedMetricCount,
      noBaselineSeriesCount,
      failedComparisonCount,
      degradedComparisonCount,
    },
    freshScenarioGroups: sortFreshScenarioGroups(freshScenarioGroups),
    statusScenarios: sortStatusScenarios(statusScenarios),
  })

  if (!summaryResult.success) {
    throw new Error(
      `Generated commit-group summary is invalid: ${formatIssues(summaryResult.issues)}`,
    )
  }

  return {
    summary: summaryResult.output,
    shouldScheduleSettlement: unresolvedAbsentScenarioCount > 0,
  }
}

async function buildPrReviewSummary(
  env: AppBindings,
  commitGroup: CommitGroupRow,
  pullRequest: PullRequestRow,
  commitGroupSummary: CommitGroupSummaryV1,
) {
  const db = getDb(env)
  const materializedComparisonIds = commitGroupSummary.freshScenarioGroups.flatMap((scenarioGroup) =>
    scenarioGroup.series
      .filter((seriesSummary) => seriesSummary.status === 'materialized')
      .map((seriesSummary) => seriesSummary.comparisonId),
  )
  const acknowledgements = materializedComparisonIds.length
    ? await db
        .select({
          id: schema.acknowledgements.id,
          comparisonId: schema.acknowledgements.comparisonId,
          itemKey: schema.acknowledgements.itemKey,
          note: schema.acknowledgements.note,
        })
        .from(schema.acknowledgements)
        .where(
          and(
            eq(schema.acknowledgements.pullRequestId, pullRequest.id),
            inArray(schema.acknowledgements.comparisonId, materializedComparisonIds),
          ),
        )
    : []
  const acknowledgementsByKey = new Map<string, AcknowledgementOverlayRow>()

  for (const acknowledgement of acknowledgements) {
    acknowledgementsByKey.set(
      `${acknowledgement.comparisonId}:${acknowledgement.itemKey}`,
      acknowledgement,
    )
  }

  const scenarioGroups = commitGroupSummary.freshScenarioGroups.map((scenarioGroup) =>
    buildReviewedScenarioSummary(scenarioGroup, acknowledgementsByKey),
  )
  const blockingRegressionCount = scenarioGroups.reduce(
    (total, scenarioGroup) =>
      total +
      scenarioGroup.series.reduce(
        (groupTotal, seriesSummary) =>
          groupTotal +
          (seriesSummary.status === 'materialized'
            ? seriesSummary.items.filter((item) => item.reviewState === 'blocking').length
            : 0),
        0,
      ),
    0,
  )
  const regressionCount = scenarioGroups.reduce(
    (total, scenarioGroup) =>
      total +
      scenarioGroup.series.reduce(
        (groupTotal, seriesSummary) =>
          groupTotal +
          (seriesSummary.status === 'materialized'
            ? seriesSummary.items.filter((item) => item.reviewState === 'regression').length
            : 0),
        0,
      ),
    0,
  )
  const acknowledgedRegressionCount = scenarioGroups.reduce(
    (total, scenarioGroup) =>
      total +
      scenarioGroup.series.reduce(
        (groupTotal, seriesSummary) =>
          groupTotal +
          (seriesSummary.status === 'materialized'
            ? seriesSummary.items.filter((item) => item.reviewState === 'acknowledged').length
            : 0),
        0,
      ),
    0,
  )
  const improvementCount = scenarioGroups.reduce(
    (total, scenarioGroup) =>
      total +
      scenarioGroup.series.reduce(
        (groupTotal, seriesSummary) =>
          groupTotal +
          (seriesSummary.status === 'materialized'
            ? seriesSummary.items.filter((item) => item.reviewState === 'improvement').length
            : 0),
        0,
      ),
    0,
  )
  const impactedScenarioCount = scenarioGroups.filter(isReviewedScenarioImpacted).length
  const unchangedScenarioCount = scenarioGroups.filter(isReviewedScenarioUnchanged).length
  const summaryResult = v.safeParse(prReviewSummaryV1Schema, {
    schemaVersion: SCHEMA_VERSION_V1,
    repositoryId: commitGroup.repositoryId,
    pullRequestId: pullRequest.id,
    commitGroupId: commitGroup.id,
    commitSha: commitGroup.commitSha,
    branch: commitGroup.branch,
    baseSha: pullRequest.baseSha,
    baseRef: pullRequest.baseRef,
    headSha: pullRequest.headSha,
    headRef: pullRequest.headRef,
    status: commitGroupSummary.status,
    overallState:
      commitGroupSummary.status === 'pending'
        ? 'pending'
        : blockingRegressionCount > 0
          ? 'failing'
          : 'passing',
    settledAt: commitGroupSummary.settledAt,
    counts: {
      blockingRegressionCount,
      regressionCount,
      acknowledgedRegressionCount,
      improvementCount,
      pendingScenarioCount: commitGroupSummary.counts.pendingScenarioCount,
      inheritedScenarioCount: commitGroupSummary.counts.inheritedScenarioCount,
      missingScenarioCount: commitGroupSummary.counts.missingScenarioCount,
      failedScenarioCount: commitGroupSummary.counts.failedScenarioCount,
      impactedScenarioCount,
      unchangedScenarioCount,
      noBaselineSeriesCount: commitGroupSummary.counts.noBaselineSeriesCount,
      failedComparisonCount: commitGroupSummary.counts.failedComparisonCount,
      degradedComparisonCount: commitGroupSummary.counts.degradedComparisonCount,
    },
    scenarioGroups: sortReviewedScenarioGroups(scenarioGroups),
    statusScenarios: commitGroupSummary.statusScenarios,
  })

  if (!summaryResult.success) {
    throw new Error(`Generated PR review summary is invalid: ${formatIssues(summaryResult.issues)}`)
  }

  return summaryResult.output
}

function buildFreshScenarioGroup(
  catalogScenario: ScenarioCatalogRow,
  activeRun: ScenarioRunSummaryRow,
  latestFailedRun: ScenarioRunSummaryRow | null,
  scenarioRuns: ScenarioRunSummaryRow[],
  activeSeriesRows: ActiveSeriesComparisonRow[],
): FreshCommitGroupScenarioSummaryV1 {
  const hasNewerFailedRun = Boolean(
    latestFailedRun && isScenarioRunNewerThan(latestFailedRun, activeRun),
  )

  return {
    scenarioId: catalogScenario.id,
    scenarioSlug: catalogScenario.slug,
    sourceKind: catalogScenario.sourceKind,
    activeScenarioRunId: activeRun.id,
    activeCommitSha: activeRun.commitSha,
    activeUploadedAt: activeRun.uploadedAt,
    totalRunCount: scenarioRuns.length,
    processedRunCount: scenarioRuns.filter((scenarioRun) => scenarioRun.status === 'processed').length,
    failedRunCount: scenarioRuns.filter((scenarioRun) => scenarioRun.status === 'failed').length,
    hasMultipleProcessedRuns: scenarioRuns.filter((scenarioRun) => scenarioRun.status === 'processed').length > 1,
    hasNewerFailedRun,
    latestFailedScenarioRunId: hasNewerFailedRun ? latestFailedRun?.id ?? null : null,
    latestFailedAt: hasNewerFailedRun ? latestFailedRun?.uploadedAt ?? null : null,
    latestFailureCode: hasNewerFailedRun ? latestFailedRun?.failureCode ?? null : null,
    latestFailureMessage: hasNewerFailedRun ? latestFailedRun?.failureMessage ?? null : null,
    series: activeSeriesRows
      .map(buildNeutralSeriesSummary)
      .filter((seriesSummary): seriesSummary is NeutralComparisonSeriesSummaryV1 => seriesSummary !== null)
      .sort(compareSeriesSummaries),
  }
}

function buildNeutralSeriesSummary(
  activeSeriesRow: ActiveSeriesComparisonRow,
): NeutralComparisonSeriesSummaryV1 | null {
  if (!activeSeriesRow.comparisonId || !activeSeriesRow.comparisonStatus) {
    return null
  }

  const currentTotals = {
    raw: activeSeriesRow.currentTotalRawBytes ?? 0,
    gzip: activeSeriesRow.currentTotalGzipBytes ?? 0,
    brotli: activeSeriesRow.currentTotalBrotliBytes ?? 0,
  }
  const baselineTotals =
    activeSeriesRow.baselineTotalRawBytes === null ||
    activeSeriesRow.baselineTotalGzipBytes === null ||
    activeSeriesRow.baselineTotalBrotliBytes === null
      ? null
      : {
          raw: activeSeriesRow.baselineTotalRawBytes,
          gzip: activeSeriesRow.baselineTotalGzipBytes,
          brotli: activeSeriesRow.baselineTotalBrotliBytes,
        }
  const deltaTotals =
    activeSeriesRow.deltaTotalRawBytes === null ||
    activeSeriesRow.deltaTotalGzipBytes === null ||
    activeSeriesRow.deltaTotalBrotliBytes === null
      ? null
      : {
          raw: activeSeriesRow.deltaTotalRawBytes,
          gzip: activeSeriesRow.deltaTotalGzipBytes,
          brotli: activeSeriesRow.deltaTotalBrotliBytes,
        }
  const selectedHeadCommitSha = activeSeriesRow.selectedHeadCommitSha

  if (!selectedHeadCommitSha) {
    return null
  }

  const commonSummaryFields = {
    comparisonId: activeSeriesRow.comparisonId,
    seriesId: activeSeriesRow.seriesId,
    scenarioRunId: activeSeriesRow.scenarioRunId,
    environment: activeSeriesRow.environment,
    entrypoint: activeSeriesRow.entrypoint,
    entrypointKind: activeSeriesRow.entrypointKind,
    lens: activeSeriesRow.lens,
    requestedBaseSha: activeSeriesRow.requestedBaseSha,
    selectedBaseCommitSha: activeSeriesRow.selectedBaseCommitSha,
    selectedHeadCommitSha,
    currentTotals,
    baselineTotals,
    deltaTotals,
    budgetState: activeSeriesRow.budgetState ?? 'not-configured',
    hasDegradedStableIdentity: Boolean(activeSeriesRow.hasDegradedStableIdentity),
    selectedEntrypointRelation: activeSeriesRow.selectedEntrypointRelation,
  }

  if (activeSeriesRow.comparisonStatus === 'materialized') {
    return {
      ...commonSummaryFields,
      status: 'materialized',
      items: buildNeutralComparisonItems(activeSeriesRow),
    }
  }

  if (activeSeriesRow.comparisonStatus === 'no-baseline') {
    return {
      ...commonSummaryFields,
      status: 'no-baseline',
      items: [],
    }
  }

  if (activeSeriesRow.comparisonStatus === 'failed') {
    return {
      ...commonSummaryFields,
      status: 'failed',
      items: [],
      failureCode: activeSeriesRow.failureCode ?? 'comparison_failed',
      failureMessage: activeSeriesRow.failureMessage ?? 'Comparison materialization failed.',
    }
  }

  return null
}

function buildNeutralComparisonItems(
  activeSeriesRow: ActiveSeriesComparisonRow,
): NeutralComparisonItemSummaryV1[] {
  return METRIC_KEY_ORDER.flatMap((metricKey) => {
    const metricValues = getMetricValues(activeSeriesRow, metricKey)

    if (!metricValues || metricValues.deltaValue === 0) {
      return []
    }

    return [
      {
        itemKey: `metric:${metricKey}`,
        metricKey,
        currentValue: metricValues.currentValue,
        baselineValue: metricValues.baselineValue,
        deltaValue: metricValues.deltaValue,
        percentageDelta: percentageDelta(metricValues.currentValue, metricValues.baselineValue),
        direction: metricValues.deltaValue > 0 ? 'regression' : 'improvement',
      },
    ]
  })
}

function getMetricValues(activeSeriesRow: ActiveSeriesComparisonRow, metricKey: ComparisonMetricKey) {
  if (metricKey === 'total-raw-bytes') {
    return activeSeriesRow.baselineTotalRawBytes === null || activeSeriesRow.deltaTotalRawBytes === null
      ? null
      : {
          currentValue: activeSeriesRow.currentTotalRawBytes ?? 0,
          baselineValue: activeSeriesRow.baselineTotalRawBytes,
          deltaValue: activeSeriesRow.deltaTotalRawBytes,
        }
  }

  if (metricKey === 'total-gzip-bytes') {
    return activeSeriesRow.baselineTotalGzipBytes === null || activeSeriesRow.deltaTotalGzipBytes === null
      ? null
      : {
          currentValue: activeSeriesRow.currentTotalGzipBytes ?? 0,
          baselineValue: activeSeriesRow.baselineTotalGzipBytes,
          deltaValue: activeSeriesRow.deltaTotalGzipBytes,
        }
  }

  return activeSeriesRow.baselineTotalBrotliBytes === null ||
    activeSeriesRow.deltaTotalBrotliBytes === null
    ? null
    : {
        currentValue: activeSeriesRow.currentTotalBrotliBytes ?? 0,
        baselineValue: activeSeriesRow.baselineTotalBrotliBytes,
        deltaValue: activeSeriesRow.deltaTotalBrotliBytes,
      }
}

function buildReviewedScenarioSummary(
  freshScenarioGroup: FreshCommitGroupScenarioSummaryV1,
  acknowledgementsByKey: Map<string, AcknowledgementOverlayRow>,
): ReviewedScenarioSummaryV1 {
  const reviewedSeries = freshScenarioGroup.series.map((seriesSummary) =>
    buildReviewedSeriesSummary(seriesSummary, acknowledgementsByKey),
  )
  const visibleSeries = reviewedSeries
    .filter((seriesSummary) => seriesSummary.reviewState !== 'neutral')
    .sort(compareReviewedSeriesSummaries)[0]
  const changedSeriesCount = reviewedSeries.filter(
    (seriesSummary) => seriesSummary.reviewState !== 'neutral',
  ).length
  const acknowledgedItemCount = reviewedSeries.reduce(
    (total, seriesSummary) =>
      total +
      (seriesSummary.status === 'materialized'
        ? seriesSummary.items.filter((item) => item.acknowledged).length
        : 0),
    0,
  )

  return {
    scenarioId: freshScenarioGroup.scenarioId,
    scenarioSlug: freshScenarioGroup.scenarioSlug,
    sourceKind: freshScenarioGroup.sourceKind,
    reviewState: selectScenarioReviewState(reviewedSeries, freshScenarioGroup.hasNewerFailedRun),
    hasNewerFailedRun: freshScenarioGroup.hasNewerFailedRun,
    latestFailedScenarioRunId: freshScenarioGroup.latestFailedScenarioRunId,
    latestFailedAt: freshScenarioGroup.latestFailedAt,
    latestFailureCode: freshScenarioGroup.latestFailureCode,
    latestFailureMessage: freshScenarioGroup.latestFailureMessage,
    visibleSeriesId: visibleSeries?.seriesId ?? null,
    additionalChangedSeriesCount: Math.max(changedSeriesCount - (visibleSeries ? 1 : 0), 0),
    acknowledgedItemCount,
    series: reviewedSeries.sort(compareReviewedSeriesSummaries),
  }
}

function buildReviewedSeriesSummary(
  seriesSummary: NeutralComparisonSeriesSummaryV1,
  acknowledgementsByKey: Map<string, AcknowledgementOverlayRow>,
): ReviewedComparisonSeriesSummaryV1 {
  if (seriesSummary.status === 'materialized') {
    const reviewedItems = seriesSummary.items.map((item) =>
      buildReviewedItemSummary(seriesSummary.comparisonId, seriesSummary.budgetState, item, acknowledgementsByKey),
    )
    const primaryItem = selectPrimaryReviewedItem(reviewedItems)

    return {
      ...seriesSummary,
      reviewState: primaryItem?.reviewState ?? 'neutral',
      items: reviewedItems,
      primaryItemKey: primaryItem?.itemKey ?? null,
    }
  }

  if (seriesSummary.status === 'no-baseline') {
    return {
      ...seriesSummary,
      reviewState: 'warning',
      items: [],
      primaryItemKey: null,
    }
  }

  return {
    ...seriesSummary,
    reviewState: 'warning',
    items: [],
    primaryItemKey: null,
  }
}

function buildReviewedItemSummary(
  comparisonId: string,
  budgetState: string,
  item: NeutralComparisonItemSummaryV1,
  acknowledgementsByKey: Map<string, AcknowledgementOverlayRow>,
): ReviewedComparisonItemSummaryV1 {
  const acknowledgement = acknowledgementsByKey.get(`${comparisonId}:${item.itemKey}`) ?? null

  return {
    itemKey: item.itemKey,
    metricKey: item.metricKey,
    currentValue: item.currentValue,
    baselineValue: item.baselineValue,
    deltaValue: item.deltaValue,
    percentageDelta: item.percentageDelta,
    reviewState: selectReviewItemState(item, acknowledgement !== null, budgetState),
    acknowledged: acknowledgement !== null,
    acknowledgementId: acknowledgement?.id ?? null,
    note: acknowledgement?.note ?? null,
  }
}

function selectReviewItemState(
  item: NeutralComparisonItemSummaryV1,
  acknowledged: boolean,
  budgetState: string,
): ReviewItemState {
  if (item.direction === 'improvement') {
    return 'improvement'
  }

  if (acknowledged) {
    return 'acknowledged'
  }

  return BLOCKING_BUDGET_STATES.has(budgetState) ? 'blocking' : 'regression'
}

function selectPrimaryReviewedItem(items: ReviewedComparisonItemSummaryV1[]) {
  return [...items].sort(compareReviewedItems)[0] ?? null
}

function selectScenarioReviewState(
  seriesSummaries: ReviewedComparisonSeriesSummaryV1[],
  hasNewerFailedRun: boolean,
): ReviewSeriesState {
  const seriesReviewState = [...seriesSummaries].sort(compareReviewedSeriesSummaries).at(0)?.reviewState ?? 'neutral'

  if (!hasNewerFailedRun) {
    return seriesReviewState
  }

  return seriesReviewState === 'neutral' || seriesReviewState === 'improvement'
    ? 'warning'
    : seriesReviewState
}

async function loadActiveSeriesComparisons(
  db: ReturnType<typeof getDb>,
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

async function findInheritedScenarioSource(
  db: ReturnType<typeof getDb>,
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
          eq(schema.scenarioRuns.status, 'processed'),
          ne(schema.scenarioRuns.commitGroupId, excludedCommitGroupId),
        ),
      )
      .orderBy(desc(schema.scenarioRuns.uploadedAt), desc(schema.scenarioRuns.createdAt))
      .limit(1),
  )
}

async function upsertCommitGroupSummary(
  db: ReturnType<typeof getDb>,
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
    status: summary.status,
    latestUploadAt: commitGroup.latestUploadAt,
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

async function upsertPrReviewSummary(
  db: ReturnType<typeof getDb>,
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

async function scheduleCommitGroupSettlementWorkflow(
  env: AppBindings,
  commitGroup: CommitGroupRow,
) {
  if (
    !env.COMMIT_GROUP_SETTLEMENT_WORKFLOW ||
    typeof env.COMMIT_GROUP_SETTLEMENT_WORKFLOW.createBatch !== 'function'
  ) {
    return
  }

  const latestUploadTimestamp = Date.parse(commitGroup.latestUploadAt)
  if (Number.isNaN(latestUploadTimestamp)) {
    return
  }

  const workflowInputResult = v.safeParse(commitGroupSettlementWorkflowInputSchema, {
    schemaVersion: SCHEMA_VERSION_V1,
    kind: 'CommitGroupSettlementWorkflow',
    repositoryId: commitGroup.repositoryId,
    commitGroupId: commitGroup.id,
    orchestrationKey: `latest-upload-${latestUploadTimestamp}`,
  })

  if (!workflowInputResult.success) {
    throw new Error(
      `Generated commit-group settlement workflow input is invalid: ${formatIssues(workflowInputResult.issues)}`,
    )
  }

  await env.COMMIT_GROUP_SETTLEMENT_WORKFLOW.createBatch([
    {
      id: `commit-group-settlement-${commitGroup.id}-${latestUploadTimestamp}`,
      params: workflowInputResult.output,
    },
  ])
}

function isFreshScenarioImpacted(freshScenarioGroup: FreshCommitGroupScenarioSummaryV1) {
  if (freshScenarioGroup.hasNewerFailedRun) {
    return true
  }

  return freshScenarioGroup.series.some((seriesSummary) => {
    if (seriesSummary.status === 'materialized') {
      return seriesSummary.items.length > 0
    }

    return true
  })
}

function isFreshScenarioUnchanged(freshScenarioGroup: FreshCommitGroupScenarioSummaryV1) {
  return (
    !freshScenarioGroup.hasNewerFailedRun &&
    freshScenarioGroup.series.length > 0 &&
    freshScenarioGroup.series.every(
      (seriesSummary) => seriesSummary.status === 'materialized' && seriesSummary.items.length === 0,
    )
  )
}

function isReviewedScenarioImpacted(scenarioGroup: ReviewedScenarioSummaryV1) {
  return scenarioGroup.series.some((seriesSummary) => seriesSummary.reviewState !== 'neutral')
}

function isReviewedScenarioUnchanged(scenarioGroup: ReviewedScenarioSummaryV1) {
  return (
    !scenarioGroup.hasNewerFailedRun &&
    scenarioGroup.series.length > 0 &&
    scenarioGroup.series.every((seriesSummary) => seriesSummary.reviewState === 'neutral')
  )
}

function isScenarioRunNewerThan(left: ScenarioRunSummaryRow, right: ScenarioRunSummaryRow) {
  const leftUploadedAt = Date.parse(left.uploadedAt)
  const rightUploadedAt = Date.parse(right.uploadedAt)

  if (leftUploadedAt !== rightUploadedAt) {
    return leftUploadedAt > rightUploadedAt
  }

  return Date.parse(left.createdAt) > Date.parse(right.createdAt)
}

function compareSeriesSummaries(
  left: NeutralComparisonSeriesSummaryV1,
  right: NeutralComparisonSeriesSummaryV1,
) {
  return (
    left.environment.localeCompare(right.environment) ||
    left.entrypoint.localeCompare(right.entrypoint) ||
    left.lens.localeCompare(right.lens)
  )
}

function compareReviewedSeriesSummaries(
  left: ReviewedComparisonSeriesSummaryV1,
  right: ReviewedComparisonSeriesSummaryV1,
) {
  return (
    SERIES_REVIEW_PRIORITY[left.reviewState] - SERIES_REVIEW_PRIORITY[right.reviewState] ||
    seriesSummaryMagnitude(right) - seriesSummaryMagnitude(left) ||
    left.environment.localeCompare(right.environment) ||
    left.entrypoint.localeCompare(right.entrypoint) ||
    left.lens.localeCompare(right.lens)
  )
}

function compareReviewedItems(
  left: ReviewedComparisonItemSummaryV1,
  right: ReviewedComparisonItemSummaryV1,
) {
  return (
    ITEM_REVIEW_PRIORITY[left.reviewState] - ITEM_REVIEW_PRIORITY[right.reviewState] ||
    Math.abs(right.deltaValue) - Math.abs(left.deltaValue) ||
    left.metricKey.localeCompare(right.metricKey)
  )
}

function sortFreshScenarioGroups(freshScenarioGroups: FreshCommitGroupScenarioSummaryV1[]) {
  return [...freshScenarioGroups].sort((left, right) => left.scenarioSlug.localeCompare(right.scenarioSlug))
}

function sortStatusScenarios(statusScenarios: CommitGroupSummaryV1['statusScenarios']) {
  return [...statusScenarios].sort(
    (left, right) => left.scenarioSlug.localeCompare(right.scenarioSlug) || left.state.localeCompare(right.state),
  )
}

function sortReviewedScenarioGroups(scenarioGroups: ReviewedScenarioSummaryV1[]) {
  return [...scenarioGroups].sort(
    (left, right) =>
      SERIES_REVIEW_PRIORITY[left.reviewState] - SERIES_REVIEW_PRIORITY[right.reviewState] ||
      reviewedScenarioMagnitude(right) - reviewedScenarioMagnitude(left) ||
      left.scenarioSlug.localeCompare(right.scenarioSlug),
  )
}

function reviewedScenarioMagnitude(scenarioGroup: ReviewedScenarioSummaryV1) {
  const visibleSeries = scenarioGroup.series.find(
    (seriesSummary) => seriesSummary.seriesId === scenarioGroup.visibleSeriesId,
  )

  return visibleSeries ? seriesSummaryMagnitude(visibleSeries) : 0
}

function seriesSummaryMagnitude(seriesSummary: ReviewedComparisonSeriesSummaryV1) {
  if (seriesSummary.status !== 'materialized') {
    return Math.abs(seriesSummary.deltaTotals?.raw ?? 0)
  }

  const primaryItem = seriesSummary.primaryItemKey
    ? seriesSummary.items.find((item) => item.itemKey === seriesSummary.primaryItemKey)
    : null

  return Math.abs(primaryItem?.deltaValue ?? 0)
}

function percentageDelta(currentValue: number, baselineValue: number) {
  if (baselineValue === 0) {
    return currentValue === 0 ? 0 : 100
  }

  return (currentValue - baselineValue) / baselineValue * 100
}

async function selectOne<T>(query: Promise<T[]>) {
  const [row] = await query
  return row ?? null
}

function formatIssues(issues: readonly { message: string }[]) {
  return issues.map((issue) => issue.message).join('; ')
}

class TerminalRefreshSummariesError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TerminalRefreshSummariesError'
  }
}
