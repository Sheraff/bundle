import {
  SCHEMA_VERSION_V1,
  commitGroupSettlementWorkflowInputSchema,
  prPublishDebounceWorkflowInputSchema,
} from "@workspace/contracts"
import * as v from "valibot"

import type { AppBindings } from "../env.js"
import { formatIssues } from "../shared/format-issues.js"

import type { CommitGroupRow, PullRequestRow } from "./types.js"

export async function scheduleCommitGroupSettlementWorkflow(
  env: AppBindings,
  commitGroup: CommitGroupRow,
) {
  if (
    !env.COMMIT_GROUP_SETTLEMENT_WORKFLOW ||
    typeof env.COMMIT_GROUP_SETTLEMENT_WORKFLOW.createBatch !== "function"
  ) {
    return
  }

  const latestUploadTimestamp = Date.parse(commitGroup.latestUploadAt)
  if (Number.isNaN(latestUploadTimestamp)) {
    return
  }

  const workflowInputResult = v.safeParse(commitGroupSettlementWorkflowInputSchema, {
    schemaVersion: SCHEMA_VERSION_V1,
    kind: "CommitGroupSettlementWorkflow",
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

export async function schedulePrPublishDebounceWorkflow(
  env: AppBindings,
  commitGroup: CommitGroupRow,
  pullRequest: PullRequestRow,
) {
  if (
    !env.PR_PUBLISH_DEBOUNCE_WORKFLOW ||
    typeof env.PR_PUBLISH_DEBOUNCE_WORKFLOW.createBatch !== "function"
  ) {
    return
  }

  const latestUploadTimestamp = Date.parse(commitGroup.latestUploadAt)
  if (Number.isNaN(latestUploadTimestamp)) {
    return
  }

  const workflowInputResult = v.safeParse(prPublishDebounceWorkflowInputSchema, {
    schemaVersion: SCHEMA_VERSION_V1,
    kind: "PrPublishDebounceWorkflow",
    repositoryId: commitGroup.repositoryId,
    pullRequestId: pullRequest.id,
    orchestrationKey: `latest-upload-${latestUploadTimestamp}`,
  })

  if (!workflowInputResult.success) {
    throw new Error(
      `Generated PR publish debounce workflow input is invalid: ${formatIssues(workflowInputResult.issues)}`,
    )
  }

  await env.PR_PUBLISH_DEBOUNCE_WORKFLOW.createBatch([
    {
      id: `pr-publish-debounce-${pullRequest.id}-${latestUploadTimestamp}`,
      params: workflowInputResult.output,
    },
  ])
}
