import {
  DEFAULT_LENS_SLUG,
  SCHEMA_VERSION_V1,
  deriveRunQueueMessageSchema,
  normalizedSnapshotV1Schema,
  scheduleComparisonsQueueMessageSchema,
  type DeriveRunQueueMessage,
  type NormalizedAssetV1,
  type NormalizedChunkV1,
  type NormalizedEntrypointV1,
  type NormalizedSnapshotV1,
  type ScheduleComparisonsQueueMessage,
} from '@workspace/contracts'
import { and, eq } from 'drizzle-orm'
import * as v from 'valibot'
import { ulid } from 'ulid'

import { getDb, schema } from './db/index.js'
import { selectOne } from './db/select-one.js'
import type { AppBindings } from './env.js'
import { getAppLogger, type AppLogger } from './logger.js'
import { enqueueRefreshSummaries } from './refresh-summaries.js'
import { formatIssues } from './shared/format-issues.js'

type ScenarioRunRow = typeof schema.scenarioRuns.$inferSelect

interface SizeBreakdown {
  raw: number
  gzip: number
  brotli: number
}

interface DerivedMeasurement {
  environment: string
  entrypointKey: string
  entrypointKind: NormalizedEntrypointV1['kind']
  lens: typeof DEFAULT_LENS_SLUG
  entryJs: SizeBreakdown
  directCss: SizeBreakdown
  total: SizeBreakdown
}

type QueueMessageLike<TBody> = Pick<Message<TBody>, 'ack' | 'retry' | 'body' | 'id' | 'attempts'>

export async function handleDeriveRunQueue(
  batch: MessageBatch<unknown>,
  env: AppBindings,
  _ctx?: ExecutionContext,
  logger: AppLogger = getAppLogger(),
) {
  for (const message of batch.messages) {
    await handleDeriveRunMessage(message, env, logger)
  }
}

export async function handleDeriveRunMessage(
  message: QueueMessageLike<unknown>,
  env: AppBindings,
  logger: AppLogger = getAppLogger(),
) {
  const messageResult = v.safeParse(deriveRunQueueMessageSchema, message.body)

  if (!messageResult.success) {
    logger.error('Dropping invalid derive-run message', formatIssues(messageResult.issues))
    message.ack()
    return
  }

  const deriveRunMessage = messageResult.output

  try {
    await deriveScenarioRun(env, deriveRunMessage)
    message.ack()
  } catch (error) {
    if (error instanceof TerminalDeriveError) {
      if (error.persistFailure) {
        await markScenarioRunFailed(env, deriveRunMessage.scenarioRunId, error.code, error.message)
      }

      message.ack()
      return
    }

    logger.error('Retrying derive-run message after transient failure', error)
    message.retry()
  }
}

async function deriveScenarioRun(env: AppBindings, message: DeriveRunQueueMessage) {
  const db = getDb(env)
  const scenarioRun = await selectOne(
    db
      .select()
      .from(schema.scenarioRuns)
      .where(eq(schema.scenarioRuns.id, message.scenarioRunId))
      .limit(1),
  )

  if (!scenarioRun) {
    throw new TerminalDeriveError(
      'scenario_run_not_found',
      `Scenario run ${message.scenarioRunId} no longer exists.`,
      false,
    )
  }

  if (scenarioRun.repositoryId !== message.repositoryId) {
    throw new TerminalDeriveError(
      'repository_mismatch',
      `Scenario run ${message.scenarioRunId} does not belong to repository ${message.repositoryId}.`,
    )
  }

  if (scenarioRun.status === 'processed') {
    await enqueueScheduleComparisons(env, scenarioRun.repositoryId, scenarioRun.id)
    await enqueueRefreshSummaries(
      env,
      scenarioRun.repositoryId,
      scenarioRun.commitGroupId,
      'derive-replay',
    )
    return
  }

  if (!scenarioRun.normalizedSnapshotR2Key) {
    throw new TerminalDeriveError(
      'normalized_snapshot_missing',
      `Scenario run ${scenarioRun.id} does not have a normalized snapshot key.`,
    )
  }

  const snapshot = await readStoredJson(
    env.CACHE_BUCKET,
    scenarioRun.normalizedSnapshotR2Key,
    normalizedSnapshotV1Schema,
    'normalized_snapshot_missing',
    'invalid_normalized_snapshot',
  )

  if (snapshot.scenarioRunId !== scenarioRun.id || snapshot.repositoryId !== scenarioRun.repositoryId) {
    throw new TerminalDeriveError(
      'normalized_snapshot_mismatch',
      `Normalized snapshot ${scenarioRun.normalizedSnapshotR2Key} does not match scenario run ${scenarioRun.id}.`,
    )
  }

  const measurements = buildSeriesMeasurements(snapshot)
  const timestamp = new Date().toISOString()

  for (const measurement of measurements) {
    const seriesId = await upsertSeries(db, scenarioRun, measurement, timestamp)
    await upsertSeriesPoint(db, scenarioRun, seriesId, measurement, snapshot.build.generatedAt, timestamp)
  }

  await db
    .update(schema.scenarioRuns)
    .set({
      status: 'processed',
      failureCode: null,
      failureMessage: null,
      updatedAt: timestamp,
    })
    .where(eq(schema.scenarioRuns.id, scenarioRun.id))

  await enqueueScheduleComparisons(env, scenarioRun.repositoryId, scenarioRun.id)
  await enqueueRefreshSummaries(env, scenarioRun.repositoryId, scenarioRun.commitGroupId, 'derived')
}

function buildSeriesMeasurements(snapshot: NormalizedSnapshotV1): DerivedMeasurement[] {
  return snapshot.environments.flatMap((environment) => {
    const chunkByFile = new Map(environment.chunks.map((chunk) => [chunk.fileName, chunk] as const))
    const assetByFile = new Map(environment.assets.map((asset) => [asset.fileName, asset] as const))

    return environment.entrypoints.map((entrypoint) => {
      const entryJs = sumChunkSizes(getEntrypointJavaScriptFiles(entrypoint, chunkByFile), chunkByFile)
      const directCss = sumAssetSizes(entrypoint.importedCss, assetByFile, 'css')

      return {
        environment: environment.name,
        entrypointKey: entrypoint.key,
        entrypointKind: entrypoint.kind,
        lens: DEFAULT_LENS_SLUG,
        entryJs,
        directCss,
        total: combineSizes(entryJs, directCss),
      }
    })
  })
}

function getEntrypointJavaScriptFiles(
  entrypoint: NormalizedEntrypointV1,
  chunkByFile: Map<string, NormalizedChunkV1>,
) {
  const directChunk = chunkByFile.get(entrypoint.chunkFileName)

  if (directChunk && isJavaScriptFile(directChunk.fileName)) {
    return [directChunk.fileName]
  }

  // Manifest-only HTML entrypoints point at the page file while their direct entry JS lives one edge away.
  return sortUnique(
    entrypoint.staticImportedChunkFileNames.filter((fileName) => {
      const chunk = chunkByFile.get(fileName)
      return Boolean(chunk && isJavaScriptFile(chunk.fileName))
    }),
  )
}

function sumChunkSizes(fileNames: string[], chunkByFile: Map<string, NormalizedChunkV1>) {
  return sortUnique(fileNames).reduce<SizeBreakdown>((total, fileName) => {
    const chunk = chunkByFile.get(fileName)

    if (!chunk) {
      return total
    }

    return combineSizes(total, chunk.sizes)
  }, emptySizeBreakdown())
}

function sumAssetSizes(
  fileNames: string[],
  assetByFile: Map<string, NormalizedAssetV1>,
  kind?: string,
) {
  return sortUnique(fileNames).reduce<SizeBreakdown>((total, fileName) => {
    const asset = assetByFile.get(fileName)

    if (!asset || (kind && asset.kind !== kind)) {
      return total
    }

    return combineSizes(total, asset.sizes)
  }, emptySizeBreakdown())
}

function combineSizes(left: SizeBreakdown, right: SizeBreakdown): SizeBreakdown {
  return {
    raw: left.raw + right.raw,
    gzip: left.gzip + right.gzip,
    brotli: left.brotli + right.brotli,
  }
}

function emptySizeBreakdown(): SizeBreakdown {
  return {
    raw: 0,
    gzip: 0,
    brotli: 0,
  }
}

function isJavaScriptFile(fileName: string) {
  return ['.js', '.mjs', '.cjs'].some((extension) => fileName.endsWith(extension))
}

async function upsertSeries(
  db: ReturnType<typeof getDb>,
  scenarioRun: ScenarioRunRow,
  measurement: DerivedMeasurement,
  timestamp: string,
) {
  const existingSeries = await selectOne(
    db
      .select({ id: schema.series.id })
      .from(schema.series)
      .where(
        and(
          eq(schema.series.repositoryId, scenarioRun.repositoryId),
          eq(schema.series.scenarioId, scenarioRun.scenarioId),
          eq(schema.series.environment, measurement.environment),
          eq(schema.series.entrypointKey, measurement.entrypointKey),
          eq(schema.series.lens, measurement.lens),
        ),
      )
      .limit(1),
  )

  if (existingSeries) {
    await db
      .update(schema.series)
      .set({
        entrypointKind: measurement.entrypointKind,
        updatedAt: timestamp,
      })
      .where(eq(schema.series.id, existingSeries.id))

    return existingSeries.id
  }

  const createdSeriesId = ulid()

  try {
    await db.insert(schema.series).values({
      id: createdSeriesId,
      repositoryId: scenarioRun.repositoryId,
      scenarioId: scenarioRun.scenarioId,
      environment: measurement.environment,
      entrypointKey: measurement.entrypointKey,
      entrypointKind: measurement.entrypointKind,
      lens: measurement.lens,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  } catch {
    const concurrentSeries = await selectOne(
      db
        .select({ id: schema.series.id })
        .from(schema.series)
        .where(
          and(
            eq(schema.series.repositoryId, scenarioRun.repositoryId),
            eq(schema.series.scenarioId, scenarioRun.scenarioId),
            eq(schema.series.environment, measurement.environment),
            eq(schema.series.entrypointKey, measurement.entrypointKey),
            eq(schema.series.lens, measurement.lens),
          ),
        )
        .limit(1),
    )

    if (concurrentSeries) {
      return concurrentSeries.id
    }

    throw new Error('Could not create the series row for this scenario run.')
  }

  return createdSeriesId
}

async function upsertSeriesPoint(
  db: ReturnType<typeof getDb>,
  scenarioRun: ScenarioRunRow,
  seriesId: string,
  measurement: DerivedMeasurement,
  measuredAt: string,
  timestamp: string,
) {
  const existingSeriesPoint = await selectOne(
    db
      .select({ id: schema.seriesPoints.id })
      .from(schema.seriesPoints)
      .where(
        and(
          eq(schema.seriesPoints.seriesId, seriesId),
          eq(schema.seriesPoints.scenarioRunId, scenarioRun.id),
        ),
      )
      .limit(1),
  )

  const values = {
    repositoryId: scenarioRun.repositoryId,
    seriesId,
    scenarioRunId: scenarioRun.id,
    commitGroupId: scenarioRun.commitGroupId,
    pullRequestId: scenarioRun.pullRequestId,
    commitSha: scenarioRun.commitSha,
    branch: scenarioRun.branch,
    measuredAt,
    entryJsRawBytes: measurement.entryJs.raw,
    entryJsGzipBytes: measurement.entryJs.gzip,
    entryJsBrotliBytes: measurement.entryJs.brotli,
    directCssRawBytes: measurement.directCss.raw,
    directCssGzipBytes: measurement.directCss.gzip,
    directCssBrotliBytes: measurement.directCss.brotli,
    totalRawBytes: measurement.total.raw,
    totalGzipBytes: measurement.total.gzip,
    totalBrotliBytes: measurement.total.brotli,
    updatedAt: timestamp,
  }

  if (existingSeriesPoint) {
    await db
      .update(schema.seriesPoints)
      .set(values)
      .where(eq(schema.seriesPoints.id, existingSeriesPoint.id))

    return existingSeriesPoint.id
  }

  const createdSeriesPointId = ulid()

  try {
    await db.insert(schema.seriesPoints).values({
      id: createdSeriesPointId,
      ...values,
      createdAt: timestamp,
    })
  } catch {
    const concurrentSeriesPoint = await selectOne(
      db
        .select({ id: schema.seriesPoints.id })
        .from(schema.seriesPoints)
        .where(
          and(
            eq(schema.seriesPoints.seriesId, seriesId),
            eq(schema.seriesPoints.scenarioRunId, scenarioRun.id),
          ),
        )
        .limit(1),
    )

    if (concurrentSeriesPoint) {
      await db
        .update(schema.seriesPoints)
        .set(values)
        .where(eq(schema.seriesPoints.id, concurrentSeriesPoint.id))

      return concurrentSeriesPoint.id
    }

    throw new Error('Could not create the series point row for this scenario run.')
  }

  return createdSeriesPointId
}

async function readStoredJson<TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  bucket: R2Bucket,
  key: string,
  dataSchema: TSchema,
  missingCode: string,
  invalidCode: string,
): Promise<v.InferOutput<TSchema>> {
  const storedObject = await bucket.get(key)

  if (!storedObject) {
    throw new TerminalDeriveError(missingCode, `Could not load ${key} from object storage.`)
  }

  const storedText = await storedObject.text()
  let parsedValue: unknown

  try {
    parsedValue = JSON.parse(storedText)
  } catch {
    throw new TerminalDeriveError(invalidCode, `${key} did not contain valid JSON.`)
  }

  const result = v.safeParse(dataSchema, parsedValue)
  if (!result.success) {
    throw new TerminalDeriveError(
      invalidCode,
      `${key} failed schema validation: ${formatIssues(result.issues)}`,
    )
  }

  return result.output
}

async function markScenarioRunFailed(
  env: AppBindings,
  scenarioRunId: string,
  failureCode: string,
  failureMessage: string,
) {
  const timestamp = new Date().toISOString()
  const failedScenarioRun = await selectOne(
    getDb(env)
      .select({
        repositoryId: schema.scenarioRuns.repositoryId,
        commitGroupId: schema.scenarioRuns.commitGroupId,
      })
      .from(schema.scenarioRuns)
      .where(eq(schema.scenarioRuns.id, scenarioRunId))
      .limit(1),
  )

  await getDb(env)
    .update(schema.scenarioRuns)
    .set({
      status: 'failed',
      failureCode,
      failureMessage,
      updatedAt: timestamp,
    })
    .where(eq(schema.scenarioRuns.id, scenarioRunId))

  if (failedScenarioRun) {
    await enqueueRefreshSummaries(
      env,
      failedScenarioRun.repositoryId,
      failedScenarioRun.commitGroupId,
      'derive-failed',
    )
  }
}

async function enqueueScheduleComparisons(
  env: AppBindings,
  repositoryId: string,
  scenarioRunId: string,
) {
  const messageResult = v.safeParse(scheduleComparisonsQueueMessageSchema, {
    schemaVersion: SCHEMA_VERSION_V1,
    kind: 'schedule-comparisons',
    repositoryId,
    scenarioRunId,
    dedupeKey: `schedule-comparisons:${scenarioRunId}:v1`,
  })

  if (!messageResult.success) {
    throw new Error(
      `Generated schedule-comparisons message is invalid: ${formatIssues(messageResult.issues)}`,
    )
  }

  const scheduleComparisonsMessage = messageResult.output as ScheduleComparisonsQueueMessage

  await env.SCHEDULE_COMPARISONS_QUEUE.send(scheduleComparisonsMessage, {
    contentType: 'json',
  })
}

function sortUnique<T>(values: Iterable<T>) {
  return [...new Set(values)].sort((left, right) => String(left).localeCompare(String(right)))
}

class TerminalDeriveError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly persistFailure = true,
  ) {
    super(message)
    this.name = 'TerminalDeriveError'
  }
}
