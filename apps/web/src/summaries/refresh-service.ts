import { eq } from "drizzle-orm"

import { getDb, schema } from "../db/index.js"
import { selectOne } from "../db/select-one.js"
import type { AppBindings } from "../env.js"

import { buildCommitGroupSummary } from "./commit-group-summary-builder.js"
import { upsertCommitGroupSummary, upsertPrReviewSummary } from "./persist-summary.js"
import { buildPrReviewSummary } from "./pr-review-summary-builder.js"
import {
  scheduleCommitGroupSettlementWorkflow,
  schedulePrPublishDebounceWorkflow,
} from "./workflow-orchestration.js"

import type { RefreshSummariesQueueMessage } from "@workspace/contracts"

export async function refreshSummariesForCommitGroup(
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
  await schedulePrPublishDebounceWorkflow(env, commitGroup, pullRequest)
}

export class TerminalRefreshSummariesError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TerminalRefreshSummariesError"
  }
}
