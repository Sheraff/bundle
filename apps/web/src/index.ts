import { Hono } from 'hono'
import startHandler from '@tanstack/react-start/server-entry'

import { CommitGroupSettlementWorkflow } from './commit-group-settlement-workflow.js'
import type { AppEnv } from './env.js'
import { handleDeriveRunMessage } from './derive-runs.js'
import { getAppLogger } from './logger.js'
import { handleMaterializeComparisonMessage } from './materialize-comparison.js'
import { handleNormalizeRunMessage } from './normalize-runs.js'
import { PrPublishDebounceWorkflow } from './pr-publish-debounce-workflow.js'
import { handlePublishGithubMessage } from './publish-github.js'
import { handleRefreshSummariesMessage } from './refresh-summaries.js'
import { registerUploadRoutes } from './api/uploads.js'
import { handleScheduleComparisonsMessage } from './schedule-comparisons.js'

const app = new Hono<AppEnv>()

app.get('/healthz', (c) => {
  return c.json({ ok: true })
})

registerUploadRoutes(app)

app.all('*', async (c) => {
  return startHandler.fetch(c.req.raw, {
    context: {
      env: c.env,
      executionContext: c.executionCtx as ExecutionContext<unknown>,
    },
  })
})

app.onError((error, c) => {
  getAppLogger().error('Unhandled app error', error)

  if (c.req.path.startsWith('/api/')) {
    return c.json(
      {
        error: {
          code: 'internal_error',
          message: 'The server could not complete the request.',
        },
      },
      500,
    )
  }

  return c.text('The server could not complete the request.', 500)
})

export default {
  fetch: app.fetch.bind(app),
  queue: async (batch: MessageBatch<unknown>, env: Cloudflare.Env, _ctx?: ExecutionContext) => {
    const logger = getAppLogger()

    for (const message of batch.messages) {
      const body = message.body
      const kind =
        typeof body === 'object' && body !== null && 'kind' in body ? body.kind : null

      if (kind === 'normalize-run') {
        await handleNormalizeRunMessage(message, env, logger)
        continue
      }

      if (kind === 'derive-run') {
        await handleDeriveRunMessage(message, env, logger)
        continue
      }

      if (kind === 'schedule-comparisons') {
        await handleScheduleComparisonsMessage(message, env, logger)
        continue
      }

      if (kind === 'materialize-comparison') {
        await handleMaterializeComparisonMessage(message, env, logger)
        continue
      }

      if (kind === 'refresh-summaries') {
        await handleRefreshSummariesMessage(message, env, logger)
        continue
      }

      if (kind === 'publish-github') {
        await handlePublishGithubMessage(message, env, logger)
        continue
      }

      logger.error('Dropping unknown queue message', body)
      message.ack()
    }
  },
}

export { CommitGroupSettlementWorkflow, PrPublishDebounceWorkflow }
