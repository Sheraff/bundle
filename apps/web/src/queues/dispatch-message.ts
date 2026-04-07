import type { AppBindings } from '../env.js'
import { handleDeriveRunMessage } from '../derive-runs.js'
import { getAppLogger, type AppLogger } from '../logger.js'
import { handleMaterializeComparisonMessage } from '../materialize-comparison.js'
import { handleNormalizeRunMessage } from '../normalize-runs.js'
import { handlePublishGithubMessage } from '../publish-github.js'
import { handleRefreshSummariesMessage } from '../refresh-summaries.js'
import { handleScheduleComparisonsMessage } from '../schedule-comparisons.js'

type QueueMessageLike<TBody> = Pick<Message<TBody>, 'ack' | 'retry' | 'body' | 'id' | 'attempts'>

export async function dispatchMessage(
  message: QueueMessageLike<unknown>,
  env: AppBindings,
  logger: AppLogger = getAppLogger(),
) {
  const body = message.body
  const kind = typeof body === 'object' && body !== null && 'kind' in body ? body.kind : null

  switch (kind) {
    case 'normalize-run':
      await handleNormalizeRunMessage(message, env, logger)
      return
    case 'derive-run':
      await handleDeriveRunMessage(message, env, logger)
      return
    case 'schedule-comparisons':
      await handleScheduleComparisonsMessage(message, env, logger)
      return
    case 'materialize-comparison':
      await handleMaterializeComparisonMessage(message, env, logger)
      return
    case 'refresh-summaries':
      await handleRefreshSummariesMessage(message, env, logger)
      return
    case 'publish-github':
      await handlePublishGithubMessage(message, env, logger)
      return
    default:
      logger.error('Dropping unknown queue message', body)
      message.ack()
  }
}
