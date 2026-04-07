import {
  SCHEMA_VERSION_V1,
  refreshSummariesQueueMessageSchema,
} from '@workspace/contracts'
import * as v from 'valibot'

import type { AppBindings } from '../env.js'
import { getAppLogger, type AppLogger } from '../logger.js'
import { formatIssues } from '../shared/format-issues.js'

import { refreshSummariesForCommitGroup, TerminalRefreshSummariesError } from './refresh-service.js'

type QueueMessageLike<TBody> = Pick<Message<TBody>, 'ack' | 'retry' | 'body' | 'id' | 'attempts'>

export async function handleRefreshSummariesQueue(
  batch: MessageBatch<unknown>,
  env: AppBindings,
  _ctx?: ExecutionContext,
  logger: AppLogger = getAppLogger(),
) {
  for (const message of batch.messages) {
    await handleRefreshSummariesMessage(message, env, logger)
  }
}

export async function handleRefreshSummariesMessage(
  message: QueueMessageLike<unknown>,
  env: AppBindings,
  logger: AppLogger = getAppLogger(),
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
