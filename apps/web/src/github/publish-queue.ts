import { SCHEMA_VERSION_V1, publishGithubQueueMessageSchema } from "@workspace/contracts"
import * as v from "valibot"

import type { AppBindings } from "../env.js"
import { getAppLogger, type AppLogger } from "../logger.js"
import { formatIssues } from "../shared/format-issues.js"

import { TerminalPublishGithubError } from "./publish-errors.js"
import { publishGithubForPullRequest } from "./publish-service.js"

type QueueMessageLike<TBody> = Pick<Message<TBody>, "ack" | "retry" | "body" | "id" | "attempts">

export async function handlePublishGithubMessage(
  message: QueueMessageLike<unknown>,
  env: AppBindings,
  logger: AppLogger = getAppLogger(),
) {
  const messageResult = v.safeParse(publishGithubQueueMessageSchema, message.body)

  if (!messageResult.success) {
    logger.error("Dropping invalid publish-github message", formatIssues(messageResult.issues))
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

    logger.error("Retrying publish-github message after transient failure", error)
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
    kind: "publish-github",
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
    contentType: "json",
  })
}
