import type { AcknowledgeComparisonItemInput } from "@workspace/contracts"
import { and, eq } from "drizzle-orm"
import { ulid } from "ulid"

import { getDb, schema } from "./db/index.js"
import { selectOne } from "./db/select-one.js"
import type { AppBindings } from "./env.js"
import {
  OnboardingAuthorizationError,
  requireRepositoryWriteForUser,
  type CurrentUserRow,
} from "./github/onboarding.js"
import { enqueueRefreshSummaries } from "./summaries/refresh-queue.js"

type AcknowledgementUser = Pick<CurrentUserRow, "githubUserId" | "id" | "login">

const metricDeltaColumns = {
  "metric:total-raw-bytes": "deltaTotalRawBytes",
  "metric:total-gzip-bytes": "deltaTotalGzipBytes",
  "metric:total-brotli-bytes": "deltaTotalBrotliBytes",
} as const

export async function acknowledgeComparisonItemForUser(
  env: AppBindings,
  user: AcknowledgementUser,
  input: AcknowledgeComparisonItemInput,
) {
  const db = getDb(env)
  const repository = await selectOne(
    db
      .select({
        enabled: schema.repositories.enabled,
        id: schema.repositories.id,
        name: schema.repositories.name,
        owner: schema.repositories.owner,
      })
      .from(schema.repositories)
      .where(eq(schema.repositories.id, input.repositoryId))
      .limit(1),
  )

  if (!repository || repository.enabled !== 1) {
    throw new AcknowledgementNotFoundError("Repository was not found or is not enabled.")
  }

  await requireRepositoryWriteForUser(env, user, repository.owner, repository.name)

  const target = await selectOne(
    db
      .select({
        comparisonId: schema.comparisons.id,
        comparisonKind: schema.comparisons.kind,
        comparisonPullRequestId: schema.comparisons.pullRequestId,
        comparisonSeriesId: schema.comparisons.seriesId,
        comparisonStatus: schema.comparisons.status,
        deltaTotalBrotliBytes: schema.comparisons.deltaTotalBrotliBytes,
        deltaTotalGzipBytes: schema.comparisons.deltaTotalGzipBytes,
        deltaTotalRawBytes: schema.comparisons.deltaTotalRawBytes,
        headCommitGroupId: schema.comparisons.headCommitGroupId,
        pullRequestRepositoryId: schema.pullRequests.repositoryId,
        seriesRepositoryId: schema.series.repositoryId,
      })
      .from(schema.comparisons)
      .innerJoin(schema.pullRequests, eq(schema.pullRequests.id, schema.comparisons.pullRequestId))
      .innerJoin(schema.series, eq(schema.series.id, schema.comparisons.seriesId))
      .where(
        and(
          eq(schema.comparisons.id, input.comparisonId),
          eq(schema.comparisons.repositoryId, input.repositoryId),
          eq(schema.comparisons.pullRequestId, input.pullRequestId),
          eq(schema.comparisons.seriesId, input.seriesId),
        ),
      )
      .limit(1),
  )

  if (
    !target ||
    target.pullRequestRepositoryId !== input.repositoryId ||
    target.seriesRepositoryId !== input.repositoryId
  ) {
    throw new AcknowledgementNotFoundError("Comparison item was not found for this PR.")
  }

  if (target.comparisonKind !== "pr-base" || target.comparisonStatus !== "materialized") {
    throw new AcknowledgementValidationError(
      "Only materialized PR comparison items can be acknowledged.",
    )
  }

  const deltaColumn = metricDeltaColumns[input.itemKey as keyof typeof metricDeltaColumns]
  const deltaValue = deltaColumn ? target[deltaColumn] : null

  if (deltaValue === null || deltaValue <= 0) {
    throw new AcknowledgementValidationError("Only regression metric items can be acknowledged.")
  }

  const timestamp = new Date().toISOString()
  const note = input.note ?? null
  const existingAcknowledgement = await selectOne(
    db
      .select({ id: schema.acknowledgements.id })
      .from(schema.acknowledgements)
      .where(
        and(
          eq(schema.acknowledgements.pullRequestId, input.pullRequestId),
          eq(schema.acknowledgements.comparisonId, input.comparisonId),
          eq(schema.acknowledgements.itemKey, input.itemKey),
        ),
      )
      .limit(1),
  )
  const acknowledgementId = existingAcknowledgement?.id ?? ulid()

  if (existingAcknowledgement) {
    await db
      .update(schema.acknowledgements)
      .set({
        actorGithubUserId: user.githubUserId,
        actorLogin: user.login,
        note,
        seriesId: input.seriesId,
        updatedAt: timestamp,
      })
      .where(eq(schema.acknowledgements.id, acknowledgementId))
  } else {
    await db.insert(schema.acknowledgements).values({
      id: acknowledgementId,
      actorGithubUserId: user.githubUserId,
      actorLogin: user.login,
      comparisonId: input.comparisonId,
      createdAt: timestamp,
      itemKey: input.itemKey,
      note,
      pullRequestId: input.pullRequestId,
      repositoryId: input.repositoryId,
      seriesId: input.seriesId,
      updatedAt: timestamp,
    })
  }

  await enqueueRefreshSummaries(
    env,
    input.repositoryId,
    target.headCommitGroupId,
    `acknowledgement-${acknowledgementId}-${Date.now()}`,
  )

  return {
    acknowledgementId,
    commitGroupId: target.headCommitGroupId,
  }
}

export class AcknowledgementNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AcknowledgementNotFoundError"
  }
}

export class AcknowledgementValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AcknowledgementValidationError"
  }
}

export { OnboardingAuthorizationError as AcknowledgementAuthorizationError }
