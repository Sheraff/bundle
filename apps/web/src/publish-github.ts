import {
  SCHEMA_VERSION_V1,
  prReviewSummaryV1Schema,
  publishGithubQueueMessageSchema,
  type PrReviewSummaryV1,
  type PublishGithubQueueMessage,
  type ReviewedComparisonItemSummaryV1,
  type ReviewedComparisonSeriesSummaryV1,
  type ReviewedScenarioSummaryV1,
} from '@workspace/contracts'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import * as v from 'valibot'

import { getDb, schema } from './db/index.js'
import type { AppBindings } from './env.js'
import * as githubApi from './github-api.js'
import { getAppLogger, type AppLogger } from './logger.js'

type QueueMessageLike<TBody> = Pick<Message<TBody>, 'ack' | 'retry' | 'body' | 'id' | 'attempts'>
type GithubPublicationRow = typeof schema.githubPublications.$inferSelect

interface CurrentPrReviewSummaryRow {
  commitGroupId: string
  summaryJson: string
}

interface CommentPublicationPayload {
  body: string
  marker: string
  payloadHash: string
}

interface CheckRunPublicationPayload {
  conclusion?: 'failure' | 'success'
  detailsUrl: string
  externalId: string
  headSha: string
  name: string
  output: githubApi.GithubCheckRunOutput
  payloadHash: string
  status: 'completed' | 'in_progress'
}

const PR_COMMENT_SURFACE = 'pr-comment'
const PR_CHECK_SURFACE = 'pr-check'
const PR_CHECK_NAME = 'Bundle Review'

export async function handlePublishGithubMessage(
  message: QueueMessageLike<unknown>,
  env: AppBindings,
  logger: AppLogger = getAppLogger(),
) {
  const messageResult = v.safeParse(publishGithubQueueMessageSchema, message.body)

  if (!messageResult.success) {
    logger.error('Dropping invalid publish-github message', formatIssues(messageResult.issues))
    message.ack()
    return
  }

  try {
    await publishGithubForPullRequest(env, messageResult.output)
    message.ack()
  } catch (error) {
    if (error instanceof TerminalPublishGithubError) {
      logger.warn(error.message)
      message.ack()
      return
    }

    logger.error('Retrying publish-github message after transient failure', error)
    message.retry()
  }
}

export async function enqueuePublishGithub(
  env: AppBindings,
  repositoryId: string,
  pullRequestId: string,
  reasonKey: string,
) {
  const messageResult = v.safeParse(publishGithubQueueMessageSchema, {
    schemaVersion: SCHEMA_VERSION_V1,
    kind: 'publish-github',
    repositoryId,
    pullRequestId,
    dedupeKey: `publish-github:${pullRequestId}:${reasonKey}:v1`,
  })

  if (!messageResult.success) {
    throw new Error(
      `Generated publish-github message is invalid: ${formatIssues(messageResult.issues)}`,
    )
  }

  await env.PUBLISH_GITHUB_QUEUE.send(messageResult.output, {
    contentType: 'json',
  })
}

async function publishGithubForPullRequest(env: AppBindings, message: PublishGithubQueueMessage) {
  const db = getDb(env)
  const pullRequest = await selectOne(
    db.select().from(schema.pullRequests).where(eq(schema.pullRequests.id, message.pullRequestId)).limit(1),
  )

  if (!pullRequest) {
    throw new TerminalPublishGithubError(
      `Pull request ${message.pullRequestId} no longer exists.`,
    )
  }

  if (pullRequest.repositoryId !== message.repositoryId) {
    throw new TerminalPublishGithubError(
      `Pull request ${pullRequest.id} does not belong to repository ${message.repositoryId}.`,
    )
  }

  const [repository, summaryRow] = await Promise.all([
    selectOne(
      db
        .select()
        .from(schema.repositories)
        .where(eq(schema.repositories.id, pullRequest.repositoryId))
        .limit(1),
    ),
    selectOne(
      db
        .select({
          commitGroupId: schema.prReviewSummaries.commitGroupId,
          summaryJson: schema.prReviewSummaries.summaryJson,
        })
        .from(schema.prReviewSummaries)
        .where(
          and(
            eq(schema.prReviewSummaries.pullRequestId, pullRequest.id),
            eq(schema.prReviewSummaries.commitSha, pullRequest.headSha),
          ),
        )
        .limit(1),
    ),
  ])

  if (!repository) {
    throw new TerminalPublishGithubError(
      `Repository ${pullRequest.repositoryId} no longer exists.`,
    )
  }

  if (!summaryRow) {
    throw new Error(
      `PR review summary for pull request ${pullRequest.id} at head ${pullRequest.headSha} is not ready.`,
    )
  }

  const summaryResult = v.safeParse(prReviewSummaryV1Schema, safeParseJson(summaryRow.summaryJson))

  if (!summaryResult.success) {
    throw new TerminalPublishGithubError(
      `Stored PR review summary for pull request ${pullRequest.id} is invalid: ${formatIssues(summaryResult.issues)}`,
    )
  }

  const prSummary = summaryResult.output
  const [commentPublication, checkPublication] = await Promise.all([
    selectCommentPublication(db, pullRequest.id),
    selectCheckPublication(db, summaryRow.commitGroupId),
  ])
  const commentPayload = await buildCommentPublicationPayload(
    env,
    repository.owner,
    repository.name,
    pullRequest.prNumber,
    pullRequest.id,
    prSummary,
  )
  const checkPayload = await buildCheckRunPublicationPayload(
    env,
    repository.owner,
    repository.name,
    pullRequest.prNumber,
    pullRequest.id,
    prSummary,
  )

  const shouldPublishComment = shouldPublishSurface(commentPublication, commentPayload.payloadHash, pullRequest.headSha)
  const shouldPublishCheck = shouldPublishSurface(checkPublication, checkPayload.payloadHash, pullRequest.headSha)

  if (!shouldPublishComment && !shouldPublishCheck) {
    return
  }

  const accessToken = await githubApi.createGithubInstallationAccessToken(env, repository.installationId)

  if (shouldPublishComment) {
    try {
      const publishedComment = await githubApi.upsertGithubPullRequestComment({
        accessToken,
        body: commentPayload.body,
        marker: commentPayload.marker,
        owner: repository.owner,
        publicationId: commentPublication?.externalPublicationId ?? null,
        pullRequestNumber: pullRequest.prNumber,
        repository: repository.name,
      })

      await upsertPublicationSuccess(db, {
        commitGroupId: summaryRow.commitGroupId,
        externalPublicationId: publishedComment.id,
        externalPublicationNodeId: publishedComment.nodeId,
        externalUrl: publishedComment.url,
        existingPublication: commentPublication,
        payloadHash: commentPayload.payloadHash,
        publishedHeadSha: pullRequest.headSha,
        pullRequestId: pullRequest.id,
        repositoryId: repository.id,
        surface: PR_COMMENT_SURFACE,
      })
    } catch (error) {
      await upsertPublicationFailure(db, {
        commitGroupId: summaryRow.commitGroupId,
        error,
        existingPublication: commentPublication,
        payloadHash: commentPayload.payloadHash,
        publishedHeadSha: pullRequest.headSha,
        pullRequestId: pullRequest.id,
        repositoryId: repository.id,
        surface: PR_COMMENT_SURFACE,
      })
      throw classifyPublishError(error)
    }
  }

  if (!shouldPublishCheck) {
    return
  }

  try {
    const publishedCheckRun = await githubApi.upsertGithubCheckRun({
      accessToken,
      conclusion: checkPayload.conclusion,
      detailsUrl: checkPayload.detailsUrl,
      externalId: checkPayload.externalId,
      headSha: checkPayload.headSha,
      name: checkPayload.name,
      output: checkPayload.output,
      owner: repository.owner,
      publicationId: checkPublication?.externalPublicationId ?? null,
      repository: repository.name,
      status: checkPayload.status,
    })

    await upsertPublicationSuccess(db, {
      commitGroupId: summaryRow.commitGroupId,
      externalPublicationId: publishedCheckRun.id,
      externalPublicationNodeId: publishedCheckRun.nodeId,
      externalUrl: publishedCheckRun.url,
      existingPublication: checkPublication,
      payloadHash: checkPayload.payloadHash,
      publishedHeadSha: pullRequest.headSha,
      pullRequestId: pullRequest.id,
      repositoryId: repository.id,
      surface: PR_CHECK_SURFACE,
    })
  } catch (error) {
    await upsertPublicationFailure(db, {
      commitGroupId: summaryRow.commitGroupId,
      error,
      existingPublication: checkPublication,
      payloadHash: checkPayload.payloadHash,
      publishedHeadSha: pullRequest.headSha,
      pullRequestId: pullRequest.id,
      repositoryId: repository.id,
      surface: PR_CHECK_SURFACE,
    })
    throw classifyPublishError(error)
  }
}

async function buildCommentPublicationPayload(
  env: AppBindings,
  owner: string,
  repository: string,
  pullRequestNumber: number,
  pullRequestId: string,
  summary: PrReviewSummaryV1,
): Promise<CommentPublicationPayload> {
  const marker = `<!-- bundle-review:pr:${pullRequestId} -->`
  const openPrDiffUrl = buildPrCompareUrl(env.PUBLIC_APP_ORIGIN, owner, repository, pullRequestNumber, {
    base: summary.baseSha,
    head: summary.headSha,
    pr: String(pullRequestNumber),
  })
  const visibleScenarioGroups = summary.scenarioGroups.filter(
    (scenarioGroup) => scenarioGroup.reviewState !== 'neutral',
  )
  const headerCounts = [
    summary.counts.blockingRegressionCount > 0
      ? formatCount(summary.counts.blockingRegressionCount, 'blocking regression')
      : null,
    summary.counts.regressionCount > 0
      ? formatCount(summary.counts.regressionCount, 'regression')
      : null,
    summary.counts.acknowledgedRegressionCount > 0
      ? formatCount(summary.counts.acknowledgedRegressionCount, 'acknowledged regression')
      : null,
    summary.counts.improvementCount > 0 ? formatCount(summary.counts.improvementCount, 'improvement') : null,
    summary.counts.pendingScenarioCount > 0
      ? formatCount(summary.counts.pendingScenarioCount, 'pending scenario')
      : null,
    summary.counts.inheritedScenarioCount > 0
      ? formatCount(summary.counts.inheritedScenarioCount, 'inherited scenario')
      : null,
    summary.counts.missingScenarioCount > 0
      ? formatCount(summary.counts.missingScenarioCount, 'missing scenario')
      : null,
    summary.counts.failedScenarioCount > 0
      ? formatCount(summary.counts.failedScenarioCount, 'failed scenario')
      : null,
  ].filter((value): value is string => value !== null)
  const lines = [
    `Bundle review: ${summary.overallState}`,
    headerCounts.join('  ') || 'No changes detected',
    `[Open PR diff](${openPrDiffUrl})`,
  ]

  for (const scenarioGroup of visibleScenarioGroups) {
    lines.push('', ...renderCommentScenarioGroup(env, owner, repository, pullRequestNumber, summary, scenarioGroup))
  }

  if (summary.counts.unchangedScenarioCount > 0) {
    lines.push('', `${summary.counts.unchangedScenarioCount} unchanged scenarios omitted`)
  }

  lines.push('', marker)

  const body = `${lines.join('\n')}\n`
  return {
    body,
    marker,
    payloadHash: await sha256Hex(body),
  }
}

function renderCommentScenarioGroup(
  env: AppBindings,
  owner: string,
  repository: string,
  pullRequestNumber: number,
  summary: PrReviewSummaryV1,
  scenarioGroup: ReviewedScenarioSummaryV1,
) {
  const visibleSeries = selectVisibleSeries(scenarioGroup)
  const badges = [formatScenarioBadge(scenarioGroup.reviewState)]

  if (scenarioGroup.additionalChangedSeriesCount > 0) {
    badges.push(`+${scenarioGroup.additionalChangedSeriesCount} more changed series`)
  }

  if (scenarioGroup.acknowledgedItemCount > 0 && scenarioGroup.reviewState !== 'acknowledged') {
    badges.push(`${scenarioGroup.acknowledgedItemCount} acknowledged`)
  }

  const lines = [
    `${scenarioGroup.scenarioSlug}${badges.length > 0 ? `  ${badges.map((badge) => `[${badge}]`).join(' ')}` : ''}`,
  ]

  if (!visibleSeries) {
    if (scenarioGroup.hasNewerFailedRun) {
      lines.push(
        `Latest rerun failed${scenarioGroup.latestFailureMessage ? `: ${scenarioGroup.latestFailureMessage}` : '.'}`,
      )
    }

    return lines
  }

  lines.push(`${visibleSeries.environment} / ${visibleSeries.entrypoint} / ${visibleSeries.lens}`)
  const primaryItem = selectPrimaryItem(visibleSeries)

  if (primaryItem) {
    lines.push(
      `${formatBytes(primaryItem.currentValue)} vs ${formatBytes(primaryItem.baselineValue)}  (${formatSignedBytes(primaryItem.deltaValue)}, ${formatSignedPercentage(primaryItem.percentageDelta)})${primaryItem.acknowledged ? '  [Acknowledged]' : ''}`,
    )
  } else if (visibleSeries.status === 'no-baseline') {
    lines.push('No baseline available for this series yet.')
  } else if (visibleSeries.status === 'failed') {
    lines.push(`Comparison failed: ${visibleSeries.failureMessage}`)
  }

  if (scenarioGroup.hasNewerFailedRun) {
    lines.push(
      `Latest rerun failed${scenarioGroup.latestFailureMessage ? `: ${scenarioGroup.latestFailureMessage}` : '.'}`,
    )
  }

  if (primaryItem?.note && primaryItem.note.length <= 140) {
    lines.push(`Note: ${primaryItem.note}`)
  }

  lines.push(
    `[View diff](${buildPrCompareUrl(env.PUBLIC_APP_ORIGIN, owner, repository, pullRequestNumber, {
      base: summary.baseSha,
      head: summary.headSha,
      pr: String(pullRequestNumber),
      scenario: scenarioGroup.scenarioSlug,
      env: visibleSeries.environment,
      entrypoint: visibleSeries.entrypoint,
      lens: visibleSeries.lens,
    })})`,
  )

  return lines
}

async function buildCheckRunPublicationPayload(
  env: AppBindings,
  owner: string,
  repository: string,
  pullRequestNumber: number,
  pullRequestId: string,
  summary: PrReviewSummaryV1,
): Promise<CheckRunPublicationPayload> {
  const detailsUrl = buildPrCompareUrl(env.PUBLIC_APP_ORIGIN, owner, repository, pullRequestNumber, {
    base: summary.baseSha,
    head: summary.headSha,
    pr: String(pullRequestNumber),
  })
  const status = summary.status === 'pending' ? 'in_progress' : 'completed'
  const conclusion = status === 'completed'
    ? summary.counts.blockingRegressionCount > 0
      ? 'failure'
      : 'success'
    : undefined
  const summaryCounts = [
    summary.counts.blockingRegressionCount > 0
      ? formatCount(summary.counts.blockingRegressionCount, 'blocking regression')
      : null,
    summary.counts.regressionCount > 0
      ? formatCount(summary.counts.regressionCount, 'regression')
      : null,
    summary.counts.acknowledgedRegressionCount > 0
      ? formatCount(summary.counts.acknowledgedRegressionCount, 'acknowledged regression')
      : null,
    summary.counts.pendingScenarioCount > 0
      ? formatCount(summary.counts.pendingScenarioCount, 'pending scenario')
      : null,
    summary.counts.inheritedScenarioCount > 0
      ? formatCount(summary.counts.inheritedScenarioCount, 'inherited scenario')
      : null,
    summary.counts.missingScenarioCount > 0
      ? formatCount(summary.counts.missingScenarioCount, 'missing scenario')
      : null,
  ].filter((value): value is string => value !== null)
  const output = {
    title: `Bundle review: ${summary.overallState}`,
    summary: `${summaryCounts.join(', ') || 'No blocking regressions detected.'}\n\n[Open PR diff](${detailsUrl})`,
    text: buildCheckDetails(summary),
  }

  return {
    ...(conclusion ? { conclusion } : {}),
    detailsUrl,
    externalId: pullRequestId,
    headSha: summary.headSha,
    name: PR_CHECK_NAME,
    output,
    payloadHash: await sha256Hex(JSON.stringify({ detailsUrl, output, status, conclusion, headSha: summary.headSha })),
    status,
  }
}

function buildCheckDetails(summary: PrReviewSummaryV1) {
  const blockingLines = collectScenarioHighlights(summary.scenarioGroups, 'blocking')
  const regressionLines = collectScenarioHighlights(summary.scenarioGroups, 'regression')
  const acknowledgedLines = collectScenarioHighlights(summary.scenarioGroups, 'acknowledged')
  const warningLines = buildWarningLines(summary)
  const lines: string[] = []

  if (blockingLines.length > 0) {
    lines.push('### Blocking regressions', ...blockingLines.map((line) => `- ${line}`))
  }

  if (regressionLines.length > 0) {
    if (lines.length > 0) {
      lines.push('')
    }

    lines.push('### Regressions', ...regressionLines.map((line) => `- ${line}`))
  }

  if (acknowledgedLines.length > 0) {
    if (lines.length > 0) {
      lines.push('')
    }

    lines.push('### Acknowledged regressions', ...acknowledgedLines.map((line) => `- ${line}`))
  }

  if (warningLines.length > 0) {
    if (lines.length > 0) {
      lines.push('')
    }

    lines.push('### Warnings', ...warningLines.map((line) => `- ${line}`))
  }

  return lines.join('\n')
}

function collectScenarioHighlights(
  scenarioGroups: readonly ReviewedScenarioSummaryV1[],
  reviewState: ReviewedScenarioSummaryV1['reviewState'],
) {
  return scenarioGroups
    .filter((scenarioGroup) => scenarioGroup.reviewState === reviewState)
    .slice(0, 10)
    .map((scenarioGroup) => describeScenarioHighlight(scenarioGroup))
}

function buildWarningLines(summary: PrReviewSummaryV1) {
  const warningLines = [
    summary.counts.pendingScenarioCount > 0 ? `${summary.counts.pendingScenarioCount} scenarios are still pending.` : null,
    summary.counts.inheritedScenarioCount > 0 ? `${summary.counts.inheritedScenarioCount} scenarios were inherited.` : null,
    summary.counts.missingScenarioCount > 0 ? `${summary.counts.missingScenarioCount} scenarios are missing.` : null,
    summary.counts.failedScenarioCount > 0 ? `${summary.counts.failedScenarioCount} scenarios have failed runs.` : null,
    summary.counts.degradedComparisonCount > 0
      ? `${summary.counts.degradedComparisonCount} comparisons have degraded identity.`
      : null,
  ].filter((value): value is string => value !== null)
  const warningScenarios = summary.scenarioGroups
    .filter((scenarioGroup) => scenarioGroup.reviewState === 'warning')
    .slice(0, 5)
    .map((scenarioGroup) => describeScenarioHighlight(scenarioGroup))

  return [...warningLines, ...warningScenarios]
}

function describeScenarioHighlight(scenarioGroup: ReviewedScenarioSummaryV1) {
  const visibleSeries = selectVisibleSeries(scenarioGroup)

  if (!visibleSeries) {
    return `${scenarioGroup.scenarioSlug}: latest rerun failed${scenarioGroup.latestFailureMessage ? ` (${scenarioGroup.latestFailureMessage})` : ''}`
  }

  const subject = `${scenarioGroup.scenarioSlug}: ${visibleSeries.environment} / ${visibleSeries.entrypoint} / ${visibleSeries.lens}`
  const primaryItem = selectPrimaryItem(visibleSeries)

  if (primaryItem) {
    return `${subject} [${primaryItem.metricKey}] ${formatSignedBytes(primaryItem.deltaValue)} (${formatSignedPercentage(primaryItem.percentageDelta)})`
  }

  if (visibleSeries.status === 'no-baseline') {
    return `${subject} (no baseline)`
  }

  return `${subject} (comparison failed)`
}

function selectVisibleSeries(scenarioGroup: ReviewedScenarioSummaryV1) {
  return (
    scenarioGroup.series.find((seriesSummary) => seriesSummary.seriesId === scenarioGroup.visibleSeriesId) ??
    scenarioGroup.series.find((seriesSummary) => seriesSummary.reviewState !== 'neutral') ??
    null
  )
}

function selectPrimaryItem(seriesSummary: ReviewedComparisonSeriesSummaryV1) {
  if (seriesSummary.status !== 'materialized') {
    return null
  }

  return (
    seriesSummary.items.find((item) => item.itemKey === seriesSummary.primaryItemKey) ??
    seriesSummary.items[0] ??
    null
  )
}

function formatScenarioBadge(reviewState: ReviewedScenarioSummaryV1['reviewState']) {
  switch (reviewState) {
    case 'blocking':
      return 'blocking'
    case 'acknowledged':
      return 'acknowledged'
    case 'improvement':
      return 'improved'
    case 'warning':
      return 'warning'
    case 'regression':
      return 'regression'
    default:
      return 'neutral'
  }
}

function shouldPublishSurface(
  publication: GithubPublicationRow | null,
  payloadHash: string,
  publishedHeadSha: string,
) {
  return !(
    publication &&
    publication.status === 'published' &&
    publication.externalPublicationId &&
    publication.payloadHash === payloadHash &&
    publication.publishedHeadSha === publishedHeadSha
  )
}

async function selectCommentPublication(db: ReturnType<typeof getDb>, pullRequestId: string) {
  return selectOne(
    db
      .select()
      .from(schema.githubPublications)
      .where(
        and(
          eq(schema.githubPublications.pullRequestId, pullRequestId),
          eq(schema.githubPublications.surface, PR_COMMENT_SURFACE),
        ),
      )
      .limit(1),
  )
}

async function selectCheckPublication(db: ReturnType<typeof getDb>, commitGroupId: string) {
  return selectOne(
    db
      .select()
      .from(schema.githubPublications)
      .where(
        and(
          eq(schema.githubPublications.commitGroupId, commitGroupId),
          eq(schema.githubPublications.surface, PR_CHECK_SURFACE),
        ),
      )
      .limit(1),
  )
}

async function upsertPublicationSuccess(
  db: ReturnType<typeof getDb>,
  options: {
    commitGroupId: string
    existingPublication: GithubPublicationRow | null
    externalPublicationId: string
    externalPublicationNodeId: string
    externalUrl: string
    payloadHash: string
    publishedHeadSha: string
    pullRequestId: string
    repositoryId: string
    surface: string
  },
) {
  const timestamp = new Date().toISOString()
  await upsertPublicationRow(db, options.existingPublication, {
    commitGroupId: options.commitGroupId,
    externalPublicationId: options.externalPublicationId,
    externalPublicationNodeId: options.externalPublicationNodeId,
    externalUrl: options.externalUrl,
    lastAttemptedAt: timestamp,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastPublishedAt: timestamp,
    payloadHash: options.payloadHash,
    publishedHeadSha: options.publishedHeadSha,
    pullRequestId: options.pullRequestId,
    repositoryId: options.repositoryId,
    status: 'published',
    surface: options.surface,
    updatedAt: timestamp,
  })
}

async function upsertPublicationFailure(
  db: ReturnType<typeof getDb>,
  options: {
    commitGroupId: string
    error: unknown
    existingPublication: GithubPublicationRow | null
    payloadHash: string
    publishedHeadSha: string
    pullRequestId: string
    repositoryId: string
    surface: string
  },
) {
  const timestamp = new Date().toISOString()
  const existingPublication = options.existingPublication
  const errorCode = options.error instanceof githubApi.GithubApiError
    ? options.error.code
    : 'github_publish_failed'
  const errorMessage = options.error instanceof Error ? options.error.message : 'GitHub publication failed.'

  await upsertPublicationRow(db, existingPublication, {
    commitGroupId: options.commitGroupId,
    externalPublicationId: existingPublication?.externalPublicationId ?? null,
    externalPublicationNodeId: existingPublication?.externalPublicationNodeId ?? null,
    externalUrl: existingPublication?.externalUrl ?? null,
    lastAttemptedAt: timestamp,
    lastErrorCode: errorCode,
    lastErrorMessage: errorMessage,
    lastPublishedAt: existingPublication?.lastPublishedAt ?? null,
    payloadHash: options.payloadHash,
    publishedHeadSha: options.publishedHeadSha,
    pullRequestId: options.pullRequestId,
    repositoryId: options.repositoryId,
    status: 'failed',
    surface: options.surface,
    updatedAt: timestamp,
  })
}

async function upsertPublicationRow(
  db: ReturnType<typeof getDb>,
  existingPublication: GithubPublicationRow | null,
  values: Omit<typeof schema.githubPublications.$inferInsert, 'createdAt' | 'id'> & { updatedAt: string },
) {
  if (existingPublication) {
    await db
      .update(schema.githubPublications)
      .set(values)
      .where(eq(schema.githubPublications.id, existingPublication.id))

    return existingPublication.id
  }

  const createdPublicationId = ulid()
  await db.insert(schema.githubPublications).values({
    id: createdPublicationId,
    ...values,
    createdAt: values.updatedAt,
  })
  return createdPublicationId
}

function classifyPublishError(error: unknown) {
  if (error instanceof githubApi.GithubApiError && !error.retryable) {
    return new TerminalPublishGithubError(error.message)
  }

  return error instanceof Error ? error : new Error('GitHub publication failed.')
}

function buildPrCompareUrl(
  origin: string,
  owner: string,
  repository: string,
  pullRequestNumber: number,
  searchParams: Record<string, string>,
) {
  const url = new URL(
    `/r/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/compare`,
    origin,
  )

  url.searchParams.set('pr', String(pullRequestNumber))

  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value)
  }

  return url.toString()
}

function formatBytes(value: number) {
  return formatMagnitude(value)
}

function formatSignedBytes(value: number) {
  return `${value >= 0 ? '+' : '-'}${formatMagnitude(Math.abs(value))}`
}

function formatMagnitude(value: number) {
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`
  }

  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} kB`
  }

  return `${value} B`
}

function formatSignedPercentage(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

function formatCount(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function selectOne<T>(query: Promise<T[]>) {
  const [row] = await query
  return row ?? null
}

function safeParseJson(text: string) {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function formatIssues(issues: readonly { message: string }[]) {
  return issues.map((issue) => issue.message).join('; ')
}

class TerminalPublishGithubError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TerminalPublishGithubError'
  }
}
