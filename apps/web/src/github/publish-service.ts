import { prReviewSummaryV1Schema, type PublishGithubQueueMessage } from "@workspace/contracts"
import { and, eq } from "drizzle-orm"
import * as v from "valibot"

import { getDb, schema } from "../db/index.js"
import { selectOne } from "../db/select-one.js"
import type { AppBindings } from "../env.js"
import * as githubApi from "../github-api.js"
import { formatIssues } from "../shared/format-issues.js"

import {
  classifyPublishError,
  safeParseJson,
  TerminalPublishGithubError,
} from "./publish-errors.js"
import {
  selectCheckPublication,
  selectCommentPublication,
  shouldPublishSurface,
  upsertPublicationFailure,
  upsertPublicationSuccess,
} from "./persist-publication.js"
import { buildCheckRunPublicationPayload } from "./render-check-run.js"
import { buildCommentPublicationPayload } from "./render-comment.js"
import { PR_CHECK_SURFACE, PR_COMMENT_SURFACE } from "./types.js"

export async function publishGithubForPullRequest(
  env: AppBindings,
  message: PublishGithubQueueMessage,
) {
  const db = getDb(env)
  const pullRequest = await selectOne(
    db
      .select()
      .from(schema.pullRequests)
      .where(eq(schema.pullRequests.id, message.pullRequestId))
      .limit(1),
  )

  if (!pullRequest) {
    throw new TerminalPublishGithubError(`Pull request ${message.pullRequestId} no longer exists.`)
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
    throw new TerminalPublishGithubError(`Repository ${pullRequest.repositoryId} no longer exists.`)
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

  const shouldPublishComment = shouldPublishSurface(
    commentPublication,
    commentPayload.payloadHash,
    pullRequest.headSha,
  )
  const shouldPublishCheck = shouldPublishSurface(
    checkPublication,
    checkPayload.payloadHash,
    pullRequest.headSha,
  )

  if (!shouldPublishComment && !shouldPublishCheck) {
    return
  }

  const accessToken = await githubApi.createGithubInstallationAccessToken(
    env,
    repository.installationId,
  )

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
