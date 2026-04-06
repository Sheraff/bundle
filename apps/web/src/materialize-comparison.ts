import {
  materializeComparisonQueueMessageSchema,
  normalizedSnapshotV1Schema,
  type NormalizedEnvironmentSnapshotV1,
} from '@workspace/contracts'
import { eq } from 'drizzle-orm'
import * as v from 'valibot'

import { getDb, schema } from './db/index.js'
import type { AppBindings } from './env.js'
import { getAppLogger, type AppLogger } from './logger.js'
import { enqueueRefreshSummaries } from './refresh-summaries.js'
import {
  matchEnvironmentPair,
  type AmbiguousRelation,
  type RelationConfidence,
  type SameRelation,
  type StableIdentityEnvironment,
  type StableIdentityMatchResult,
} from './stable-identity.js'

type QueueMessageLike<TBody> = Pick<Message<TBody>, 'ack' | 'retry' | 'body' | 'id' | 'attempts'>

interface SelectedEntrypointRelationSummary {
  confidence: RelationConfidence | null
  evidence: string[]
  relation: 'added' | 'removed' | 'same'
}

interface BudgetEvaluationResult {
  budgetState: 'not-configured'
}

export async function handleMaterializeComparisonQueue(
  batch: MessageBatch<unknown>,
  env: AppBindings,
  _ctx?: ExecutionContext,
  logger: AppLogger = getAppLogger(),
) {
  for (const message of batch.messages) {
    await handleMaterializeComparisonMessage(message, env, logger)
  }
}

export async function handleMaterializeComparisonMessage(
  message: QueueMessageLike<unknown>,
  env: AppBindings,
  logger: AppLogger = getAppLogger(),
) {
  const messageResult = v.safeParse(materializeComparisonQueueMessageSchema, message.body)

  if (!messageResult.success) {
    logger.error('Dropping invalid materialize-comparison message', formatIssues(messageResult.issues))
    message.ack()
    return
  }

  try {
    await materializeComparison(env, messageResult.output)
    message.ack()
  } catch (error) {
    if (error instanceof TerminalMaterializeError) {
      if (error.persistFailure) {
        await markComparisonFailed(env, messageResult.output.comparisonId, error.code, error.message)
      }

      message.ack()
      return
    }

    logger.error('Retrying materialize-comparison message after transient failure', error)
    message.retry()
  }
}

async function materializeComparison(
  env: AppBindings,
  message: v.InferOutput<typeof materializeComparisonQueueMessageSchema>,
) {
  const db = getDb(env)
  const comparison = await selectOne(
    db
      .select()
      .from(schema.comparisons)
      .where(eq(schema.comparisons.id, message.comparisonId))
      .limit(1),
  )

  if (!comparison) {
    throw new TerminalMaterializeError(
      'comparison_not_found',
      `Comparison ${message.comparisonId} no longer exists.`,
      false,
    )
  }

  if (comparison.repositoryId !== message.repositoryId) {
    throw new TerminalMaterializeError(
      'repository_mismatch',
      `Comparison ${comparison.id} does not belong to repository ${message.repositoryId}.`,
    )
  }

  if (comparison.status === 'materialized') {
    return
  }

  if (!comparison.baseScenarioRunId || comparison.status === 'no-baseline') {
    return
  }

  const seriesRow = await selectOne(
    db.select().from(schema.series).where(eq(schema.series.id, comparison.seriesId)).limit(1),
  )

  if (!seriesRow) {
    throw new TerminalMaterializeError(
      'series_not_found',
      `Comparison ${comparison.id} references series ${comparison.seriesId}, which no longer exists.`,
    )
  }

  const headRun = await selectOne(
    db
      .select()
      .from(schema.scenarioRuns)
      .where(eq(schema.scenarioRuns.id, comparison.headScenarioRunId))
      .limit(1),
  )
  const baseRun = await selectOne(
    db
      .select()
      .from(schema.scenarioRuns)
      .where(eq(schema.scenarioRuns.id, comparison.baseScenarioRunId))
      .limit(1),
  )

  if (!headRun || !baseRun) {
    throw new TerminalMaterializeError(
      'scenario_run_missing',
      `Comparison ${comparison.id} could not load both scenario runs for materialization.`,
    )
  }

  if (!headRun.normalizedSnapshotR2Key || !baseRun.normalizedSnapshotR2Key) {
    throw new TerminalMaterializeError(
      'normalized_snapshot_missing',
      `Comparison ${comparison.id} is missing a normalized snapshot key on one of its scenario runs.`,
    )
  }

  const [headSnapshot, baseSnapshot] = await Promise.all([
    readStoredJson(
      env.CACHE_BUCKET,
      headRun.normalizedSnapshotR2Key,
      normalizedSnapshotV1Schema,
      'normalized_snapshot_missing',
      'invalid_normalized_snapshot',
    ),
    readStoredJson(
      env.CACHE_BUCKET,
      baseRun.normalizedSnapshotR2Key,
      normalizedSnapshotV1Schema,
      'normalized_snapshot_missing',
      'invalid_normalized_snapshot',
    ),
  ])

  const headEnvironment = headSnapshot.environments.find(
    (environment) => environment.name === seriesRow.environment,
  )
  const baseEnvironment = baseSnapshot.environments.find(
    (environment) => environment.name === seriesRow.environment,
  )

  if (!headEnvironment || !baseEnvironment) {
    throw new TerminalMaterializeError(
      'environment_missing',
      `Comparison ${comparison.id} could not find environment ${seriesRow.environment} in both snapshots.`,
    )
  }

  const matchResult = matchEnvironmentPair(
    toStableIdentityEnvironment(baseEnvironment),
    toStableIdentityEnvironment(headEnvironment),
  )
  const selectedEntrypoint = summarizeSelectedEntrypointRelation(
    seriesRow.entrypointKind,
    seriesRow.entrypointKey,
    baseEnvironment,
    headEnvironment,
    matchResult,
  )
  const stableIdentitySummary = buildStableIdentitySummary(matchResult, selectedEntrypoint)
  const budgetEvaluation = evaluateBudgetResults()
  const timestamp = new Date().toISOString()

  await db.delete(schema.budgetResults).where(eq(schema.budgetResults.comparisonId, comparison.id))
  await db
    .update(schema.comparisons)
    .set({
      status: 'materialized',
      selectedEntrypointRelation: selectedEntrypoint?.relation ?? null,
      selectedEntrypointConfidence: selectedEntrypoint?.confidence ?? null,
      selectedEntrypointEvidenceJson: selectedEntrypoint
        ? JSON.stringify(selectedEntrypoint.evidence)
        : null,
      stableIdentitySummaryJson: JSON.stringify(stableIdentitySummary),
      hasDegradedStableIdentity: stableIdentitySummary.degraded.totalCount > 0 ? 1 : 0,
      budgetState: budgetEvaluation.budgetState,
      failureCode: null,
      failureMessage: null,
      updatedAt: timestamp,
    })
    .where(eq(schema.comparisons.id, comparison.id))

  await enqueueRefreshSummaries(
    env,
    comparison.repositoryId,
    comparison.headCommitGroupId,
    'comparison-materialized',
  )
}

function toStableIdentityEnvironment(
  environment: NormalizedEnvironmentSnapshotV1,
): StableIdentityEnvironment {
  return {
    chunks: environment.chunks.map((chunk) => ({
      fileName: chunk.fileName,
      fileLabel: chunk.fileLabel,
      isEntry: chunk.isEntry,
      isDynamicEntry: chunk.isDynamicEntry,
      facadeModule: chunk.facadeModule,
      manifestSourceKeys: chunk.manifestSourceKeys,
      ownerRoots: chunk.ownerRoots,
      imports: chunk.imports,
      dynamicImports: chunk.dynamicImports,
      moduleIds: chunk.moduleIds,
      totalRenderedLength: chunk.totalRenderedLength,
      modules: chunk.modules.map((moduleEntry) => ({
        stableId: moduleEntry.stableId,
        renderedLength: moduleEntry.renderedLength,
      })),
      sizes: chunk.sizes,
    })),
    assets: environment.assets.map((asset) => ({
      fileName: asset.fileName,
      fileLabel: asset.fileLabel,
      kind: asset.kind,
      sourceKeys: asset.sourceKeys,
      importerKeys: asset.importerKeys,
      importerFiles: asset.importerFiles,
      ownerRoots: asset.ownerRoots,
      sizes: asset.sizes,
    })),
  }
}

function summarizeSelectedEntrypointRelation(
  entrypointKind: string,
  entrypointKey: string,
  baseEnvironment: NormalizedEnvironmentSnapshotV1,
  headEnvironment: NormalizedEnvironmentSnapshotV1,
  matchResult: StableIdentityMatchResult,
): SelectedEntrypointRelationSummary | null {
  const baseEntrypoint = baseEnvironment.entrypoints.find(
    (entrypoint) => entrypoint.kind === entrypointKind && entrypoint.key === entrypointKey,
  )
  const headEntrypoint = headEnvironment.entrypoints.find(
    (entrypoint) => entrypoint.kind === entrypointKind && entrypoint.key === entrypointKey,
  )
  const collection = entrypointKind === 'dynamic-entry' ? matchResult.dynamicEntries : matchResult.entries

  if (baseEntrypoint && headEntrypoint) {
    const sameRelation = collection.same.find(
      (relation) =>
        relation.from === baseEntrypoint.chunkFileName && relation.to === headEntrypoint.chunkFileName,
    )

    if (sameRelation) {
      return {
        relation: 'same',
        confidence: sameRelation.confidence,
        evidence: sameRelation.evidence,
      }
    }

    const baseChunkExists = baseEnvironment.chunks.some(
      (chunk) => chunk.fileName === baseEntrypoint.chunkFileName,
    )
    const headChunkExists = headEnvironment.chunks.some(
      (chunk) => chunk.fileName === headEntrypoint.chunkFileName,
    )

    if (!baseChunkExists && !headChunkExists) {
      const sharedManifestSourceKey = baseEntrypoint.manifestSourceKeys.find((sourceKey) =>
        headEntrypoint.manifestSourceKeys.includes(sourceKey),
      )

      return {
        relation: 'same',
        confidence: 'exact',
        evidence: [sharedManifestSourceKey ? `identity:${sharedManifestSourceKey}` : `identity:${entrypointKey}`],
      }
    }
  }

  if (!baseEntrypoint && headEntrypoint) {
    return {
      relation: 'added',
      confidence: null,
      evidence: [],
    }
  }

  if (baseEntrypoint && !headEntrypoint) {
    return {
      relation: 'removed',
      confidence: null,
      evidence: [],
    }
  }

  return null
}

function buildStableIdentitySummary(
  matchResult: StableIdentityMatchResult,
  selectedEntrypoint: SelectedEntrypointRelationSummary | null,
) {
  const lowConfidenceShared = matchResult.sharedChunks.same.filter(
    (relation) => relation.confidence === 'low',
  )
  const lowConfidenceCss = matchResult.css.same.filter((relation) => relation.confidence === 'low')
  const lowConfidenceAssets = matchResult.assets.same.filter(
    (relation) => relation.confidence === 'low',
  )
  const degradedExamples = {
    ambiguousSharedChunks: takeFirst(matchResult.sharedChunks.ambiguous, 5),
    lowConfidenceSharedChunks: takeFirst(lowConfidenceShared, 5),
    lowConfidenceCss: takeFirst(lowConfidenceCss, 5),
    lowConfidenceAssets: takeFirst(lowConfidenceAssets, 5),
  }

  return {
    selectedEntrypoint,
    entries: summarizeRootMatches(matchResult.entries),
    dynamicEntries: summarizeRootMatches(matchResult.dynamicEntries),
    sharedChunks: {
      sameCount: matchResult.sharedChunks.same.length,
      splitCount: matchResult.sharedChunks.split.length,
      mergeCount: matchResult.sharedChunks.merge.length,
      ambiguousCount: matchResult.sharedChunks.ambiguous.length,
      addedCount: matchResult.sharedChunks.added.length,
      removedCount: matchResult.sharedChunks.removed.length,
      lowConfidenceSameCount: lowConfidenceShared.length,
    },
    css: summarizeAssetMatches(matchResult.css),
    assets: summarizeAssetMatches(matchResult.assets),
    modules: matchResult.modules,
    summary: matchResult.summary,
    degraded: {
      totalCount:
        matchResult.sharedChunks.ambiguous.length +
        lowConfidenceShared.length +
        lowConfidenceCss.length +
        lowConfidenceAssets.length,
      ...degradedExamples,
    },
  }
}

function summarizeRootMatches(matches: StableIdentityMatchResult['entries']) {
  return {
    sameCount: matches.same.length,
    addedCount: matches.added.length,
    removedCount: matches.removed.length,
  }
}

function summarizeAssetMatches(matches: StableIdentityMatchResult['css']) {
  return {
    sameCount: matches.same.length,
    splitCount: matches.split.length,
    mergeCount: matches.merge.length,
    addedCount: matches.added.length,
    removedCount: matches.removed.length,
    lowConfidenceSameCount: matches.same.filter((relation) => relation.confidence === 'low').length,
  }
}

function takeFirst<T extends SameRelation | AmbiguousRelation>(values: T[], limit: number) {
  return values.slice(0, limit)
}

function evaluateBudgetResults(): BudgetEvaluationResult {
  return {
    budgetState: 'not-configured',
  }
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
    throw new TerminalMaterializeError(missingCode, `Could not load ${key} from object storage.`)
  }

  const storedText = await storedObject.text()
  let parsedValue: unknown

  try {
    parsedValue = JSON.parse(storedText)
  } catch {
    throw new TerminalMaterializeError(invalidCode, `${key} did not contain valid JSON.`)
  }

  const result = v.safeParse(dataSchema, parsedValue)
  if (!result.success) {
    throw new TerminalMaterializeError(
      invalidCode,
      `${key} failed schema validation: ${formatIssues(result.issues)}`,
    )
  }

  return result.output
}

async function markComparisonFailed(
  env: AppBindings,
  comparisonId: string,
  failureCode: string,
  failureMessage: string,
) {
  const timestamp = new Date().toISOString()
  const comparison = await selectOne(
    getDb(env)
      .select({
        repositoryId: schema.comparisons.repositoryId,
        headCommitGroupId: schema.comparisons.headCommitGroupId,
      })
      .from(schema.comparisons)
      .where(eq(schema.comparisons.id, comparisonId))
      .limit(1),
  )

  await getDb(env)
    .update(schema.comparisons)
    .set({
      status: 'failed',
      failureCode,
      failureMessage,
      updatedAt: timestamp,
    })
    .where(eq(schema.comparisons.id, comparisonId))

  if (comparison) {
    await enqueueRefreshSummaries(
      env,
      comparison.repositoryId,
      comparison.headCommitGroupId,
      'comparison-failed',
    )
  }
}

async function selectOne<T>(query: Promise<T[]>) {
  const [row] = await query
  return row ?? null
}

function formatIssues(issues: readonly { message: string }[]) {
  return issues.map((issue) => issue.message).join('; ')
}

class TerminalMaterializeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly persistFailure = true,
  ) {
    super(message)
    this.name = 'TerminalMaterializeError'
  }
}
