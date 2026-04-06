import {
  SCHEMA_VERSION_V1,
  materializeComparisonQueueMessageSchema,
  scheduleComparisonsQueueMessageSchema,
  type MaterializeComparisonQueueMessage,
  type ScheduleComparisonsQueueMessage,
} from '@workspace/contracts'
import { and, desc, eq, lte, ne } from 'drizzle-orm'
import * as v from 'valibot'
import { ulid } from 'ulid'

import { getDb, schema } from './db/index.js'
import type { AppBindings } from './env.js'
import { getAppLogger, type AppLogger } from './logger.js'
import { enqueueRefreshSummaries } from './refresh-summaries.js'

type ScenarioRunRow = typeof schema.scenarioRuns.$inferSelect
type QueueMessageLike<TBody> = Pick<Message<TBody>, 'ack' | 'retry' | 'body' | 'id' | 'attempts'>
type ComparisonKind = 'branch-previous' | 'pr-base'

interface MeasuredSeriesPoint {
  commitGroupId: string
  commitSha: string
  scenarioRunId: string
  seriesId: string
  totalBrotliBytes: number
  totalGzipBytes: number
  totalRawBytes: number
  uploadedAt: string
}

const DEFAULT_BUDGET_STATE = 'not-configured' as const

export async function handleScheduleComparisonsQueue(
  batch: MessageBatch<unknown>,
  env: AppBindings,
  _ctx?: ExecutionContext,
  logger: AppLogger = getAppLogger(),
) {
  for (const message of batch.messages) {
    await handleScheduleComparisonsMessage(message, env, logger)
  }
}

export async function handleScheduleComparisonsMessage(
  message: QueueMessageLike<unknown>,
  env: AppBindings,
  logger: AppLogger = getAppLogger(),
) {
  const messageResult = v.safeParse(scheduleComparisonsQueueMessageSchema, message.body)

  if (!messageResult.success) {
    logger.error('Dropping invalid schedule-comparisons message', formatIssues(messageResult.issues))
    message.ack()
    return
  }

  try {
    await scheduleScenarioRunComparisons(env, messageResult.output)
    message.ack()
  } catch (error) {
    if (error instanceof TerminalScheduleError) {
      logger.warn(error.message)
      message.ack()
      return
    }

    logger.error('Retrying schedule-comparisons message after transient failure', error)
    message.retry()
  }
}

async function scheduleScenarioRunComparisons(
  env: AppBindings,
  message: ScheduleComparisonsQueueMessage,
) {
  const db = getDb(env)
  const scenarioRun = await selectOne(
    db
      .select()
      .from(schema.scenarioRuns)
      .where(eq(schema.scenarioRuns.id, message.scenarioRunId))
      .limit(1),
  )

  if (!scenarioRun) {
    throw new TerminalScheduleError(`Scenario run ${message.scenarioRunId} no longer exists.`)
  }

  if (scenarioRun.repositoryId !== message.repositoryId) {
    throw new TerminalScheduleError(
      `Scenario run ${message.scenarioRunId} does not belong to repository ${message.repositoryId}.`,
    )
  }

  if (scenarioRun.status !== 'processed') {
    throw new TerminalScheduleError(
      `Scenario run ${scenarioRun.id} is not ready for comparison scheduling.`,
    )
  }

  const pullRequest = scenarioRun.pullRequestId
    ? await selectOne(
        db
          .select()
          .from(schema.pullRequests)
          .where(eq(schema.pullRequests.id, scenarioRun.pullRequestId))
          .limit(1),
      )
    : null

  const headSeriesPoints = await db
    .select({
      scenarioRunId: schema.seriesPoints.scenarioRunId,
      seriesId: schema.seriesPoints.seriesId,
      commitGroupId: schema.seriesPoints.commitGroupId,
      commitSha: schema.seriesPoints.commitSha,
      totalRawBytes: schema.seriesPoints.totalRawBytes,
      totalGzipBytes: schema.seriesPoints.totalGzipBytes,
      totalBrotliBytes: schema.seriesPoints.totalBrotliBytes,
      uploadedAt: schema.scenarioRuns.uploadedAt,
    })
    .from(schema.seriesPoints)
    .innerJoin(schema.scenarioRuns, eq(schema.scenarioRuns.id, schema.seriesPoints.scenarioRunId))
    .where(eq(schema.seriesPoints.scenarioRunId, scenarioRun.id))

  for (const headPoint of headSeriesPoints) {
    await scheduleComparisonForKind(env, scenarioRun, headPoint, 'branch-previous', null)

    if (pullRequest) {
      await scheduleComparisonForKind(env, scenarioRun, headPoint, 'pr-base', pullRequest)
    }
  }

  await enqueueRefreshSummaries(
    env,
    scenarioRun.repositoryId,
    scenarioRun.commitGroupId,
    'comparisons-scheduled',
  )
}

async function scheduleComparisonForKind(
  env: AppBindings,
  scenarioRun: ScenarioRunRow,
  headPoint: MeasuredSeriesPoint,
  kind: ComparisonKind,
  pullRequest: typeof schema.pullRequests.$inferSelect | null,
) {
  const db = getDb(env)
  const baselinePoint =
    kind === 'pr-base'
      ? await findPrBaseBaseline(db, scenarioRun, headPoint, pullRequest)
      : await findPreviousBranchBaseline(db, scenarioRun, headPoint)
  const timestamp = new Date().toISOString()
  const comparisonId = await upsertComparison(db, {
    scenarioRun,
    headPoint,
    baselinePoint,
    pullRequest,
    kind,
    timestamp,
  })

  if (!baselinePoint) {
    return
  }

  await enqueueMaterializeComparison(env, scenarioRun.repositoryId, comparisonId)
}

async function findPrBaseBaseline(
  db: ReturnType<typeof getDb>,
  scenarioRun: ScenarioRunRow,
  headPoint: MeasuredSeriesPoint,
  pullRequest: typeof schema.pullRequests.$inferSelect | null,
) {
  if (!pullRequest) {
    return null
  }

  return selectOne(
    db
      .select({
        scenarioRunId: schema.seriesPoints.scenarioRunId,
        seriesId: schema.seriesPoints.seriesId,
        commitGroupId: schema.seriesPoints.commitGroupId,
        commitSha: schema.seriesPoints.commitSha,
        totalRawBytes: schema.seriesPoints.totalRawBytes,
        totalGzipBytes: schema.seriesPoints.totalGzipBytes,
        totalBrotliBytes: schema.seriesPoints.totalBrotliBytes,
        uploadedAt: schema.scenarioRuns.uploadedAt,
      })
      .from(schema.seriesPoints)
      .innerJoin(schema.scenarioRuns, eq(schema.scenarioRuns.id, schema.seriesPoints.scenarioRunId))
      .where(
        and(
          eq(schema.seriesPoints.seriesId, headPoint.seriesId),
          eq(schema.scenarioRuns.status, 'processed'),
          eq(schema.seriesPoints.branch, pullRequest.baseRef),
          lte(schema.scenarioRuns.uploadedAt, scenarioRun.uploadedAt),
          ne(schema.seriesPoints.scenarioRunId, scenarioRun.id),
        ),
      )
      .orderBy(desc(schema.scenarioRuns.uploadedAt), desc(schema.seriesPoints.measuredAt))
      .limit(1),
  )
}

async function findPreviousBranchBaseline(
  db: ReturnType<typeof getDb>,
  scenarioRun: ScenarioRunRow,
  headPoint: MeasuredSeriesPoint,
) {
  return selectOne(
    db
      .select({
        scenarioRunId: schema.seriesPoints.scenarioRunId,
        seriesId: schema.seriesPoints.seriesId,
        commitGroupId: schema.seriesPoints.commitGroupId,
        commitSha: schema.seriesPoints.commitSha,
        totalRawBytes: schema.seriesPoints.totalRawBytes,
        totalGzipBytes: schema.seriesPoints.totalGzipBytes,
        totalBrotliBytes: schema.seriesPoints.totalBrotliBytes,
        uploadedAt: schema.scenarioRuns.uploadedAt,
      })
      .from(schema.seriesPoints)
      .innerJoin(schema.scenarioRuns, eq(schema.scenarioRuns.id, schema.seriesPoints.scenarioRunId))
      .where(
        and(
          eq(schema.seriesPoints.seriesId, headPoint.seriesId),
          eq(schema.scenarioRuns.status, 'processed'),
          eq(schema.seriesPoints.branch, scenarioRun.branch),
          lte(schema.scenarioRuns.uploadedAt, scenarioRun.uploadedAt),
          ne(schema.seriesPoints.commitGroupId, scenarioRun.commitGroupId),
          ne(schema.seriesPoints.scenarioRunId, scenarioRun.id),
        ),
      )
      .orderBy(desc(schema.scenarioRuns.uploadedAt), desc(schema.seriesPoints.measuredAt))
      .limit(1),
  )
}

async function upsertComparison(
  db: ReturnType<typeof getDb>,
  {
    scenarioRun,
    headPoint,
    baselinePoint,
    pullRequest,
    kind,
    timestamp,
  }: {
    scenarioRun: ScenarioRunRow
    headPoint: MeasuredSeriesPoint
    baselinePoint: MeasuredSeriesPoint | null
    pullRequest: typeof schema.pullRequests.$inferSelect | null
    kind: ComparisonKind
    timestamp: string
  },
) {
  const existingComparison = await selectOne(
    db
      .select({ id: schema.comparisons.id })
      .from(schema.comparisons)
      .where(
        and(
          eq(schema.comparisons.kind, kind),
          eq(schema.comparisons.seriesId, headPoint.seriesId),
          eq(schema.comparisons.headScenarioRunId, scenarioRun.id),
        ),
      )
      .limit(1),
  )

  const values = {
    repositoryId: scenarioRun.repositoryId,
    seriesId: headPoint.seriesId,
    headScenarioRunId: scenarioRun.id,
    baseScenarioRunId: baselinePoint?.scenarioRunId ?? null,
    headCommitGroupId: scenarioRun.commitGroupId,
    baseCommitGroupId: baselinePoint?.commitGroupId ?? null,
    pullRequestId: scenarioRun.pullRequestId,
    kind,
    status: baselinePoint ? 'queued' : 'no-baseline',
    requestedBaseSha:
      kind === 'pr-base' ? pullRequest?.baseSha ?? null : baselinePoint?.commitSha ?? null,
    requestedHeadSha: kind === 'pr-base' ? pullRequest?.headSha ?? scenarioRun.commitSha : scenarioRun.commitSha,
    selectedBaseCommitSha: baselinePoint?.commitSha ?? null,
    selectedHeadCommitSha: scenarioRun.commitSha,
    currentTotalRawBytes: headPoint.totalRawBytes,
    currentTotalGzipBytes: headPoint.totalGzipBytes,
    currentTotalBrotliBytes: headPoint.totalBrotliBytes,
    baselineTotalRawBytes: baselinePoint?.totalRawBytes ?? null,
    baselineTotalGzipBytes: baselinePoint?.totalGzipBytes ?? null,
    baselineTotalBrotliBytes: baselinePoint?.totalBrotliBytes ?? null,
    deltaTotalRawBytes: baselinePoint ? headPoint.totalRawBytes - baselinePoint.totalRawBytes : null,
    deltaTotalGzipBytes: baselinePoint
      ? headPoint.totalGzipBytes - baselinePoint.totalGzipBytes
      : null,
    deltaTotalBrotliBytes: baselinePoint
      ? headPoint.totalBrotliBytes - baselinePoint.totalBrotliBytes
      : null,
    selectedEntrypointRelation: null,
    selectedEntrypointConfidence: null,
    selectedEntrypointEvidenceJson: null,
    stableIdentitySummaryJson: null,
    hasDegradedStableIdentity: 0,
    budgetState: DEFAULT_BUDGET_STATE,
    failureCode: null,
    failureMessage: null,
    updatedAt: timestamp,
  }

  if (existingComparison) {
    await db
      .update(schema.comparisons)
      .set(values)
      .where(eq(schema.comparisons.id, existingComparison.id))

    return existingComparison.id
  }

  const createdComparisonId = ulid()

  try {
    await db.insert(schema.comparisons).values({
      id: createdComparisonId,
      ...values,
      createdAt: timestamp,
    })
  } catch {
    const concurrentComparison = await selectOne(
      db
        .select({ id: schema.comparisons.id })
        .from(schema.comparisons)
        .where(
          and(
            eq(schema.comparisons.kind, kind),
            eq(schema.comparisons.seriesId, headPoint.seriesId),
            eq(schema.comparisons.headScenarioRunId, scenarioRun.id),
          ),
        )
        .limit(1),
    )

    if (concurrentComparison) {
      await db
        .update(schema.comparisons)
        .set(values)
        .where(eq(schema.comparisons.id, concurrentComparison.id))

      return concurrentComparison.id
    }

    throw new Error('Could not create the comparison row for this scenario run.')
  }

  return createdComparisonId
}

async function enqueueMaterializeComparison(
  env: AppBindings,
  repositoryId: string,
  comparisonId: string,
) {
  const messageResult = v.safeParse(materializeComparisonQueueMessageSchema, {
    schemaVersion: SCHEMA_VERSION_V1,
    kind: 'materialize-comparison',
    repositoryId,
    comparisonId,
    dedupeKey: `materialize-comparison:${comparisonId}:v1`,
  })

  if (!messageResult.success) {
    throw new Error(
      `Generated materialize-comparison message is invalid: ${formatIssues(messageResult.issues)}`,
    )
  }

  const materializeMessage = messageResult.output as MaterializeComparisonQueueMessage

  await env.MATERIALIZE_COMPARISON_QUEUE.send(materializeMessage, {
    contentType: 'json',
  })
}

async function selectOne<T>(query: Promise<T[]>) {
  const [row] = await query
  return row ?? null
}

function formatIssues(issues: readonly { message: string }[]) {
  return issues.map((issue) => issue.message).join('; ')
}

class TerminalScheduleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TerminalScheduleError'
  }
}
