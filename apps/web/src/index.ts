import { Hono } from 'hono'

import type { AppEnv } from './env.js'
import { handleDeriveRunMessage } from './derive-runs.js'
import { handleMaterializeComparisonMessage } from './materialize-comparison.js'
import { handleNormalizeRunMessage } from './normalize-runs.js'
import { registerUploadRoutes } from './routes/uploads.js'
import { handleScheduleComparisonsMessage } from './schedule-comparisons.js'

const app = new Hono<AppEnv>()

app.get('/healthz', (c) => {
  return c.json({ ok: true })
})

registerUploadRoutes(app)

app.onError((error, c) => {
  console.error('Unhandled app error', error)

  return c.json(
    {
      error: {
        code: 'internal_error',
        message: 'The server could not complete the request.',
      },
    },
    500,
  )
})

export default {
  fetch: app.fetch.bind(app),
  queue: async (batch: MessageBatch<unknown>, env: Cloudflare.Env, _ctx?: ExecutionContext) => {
    for (const message of batch.messages) {
      const body = message.body
      const kind =
        typeof body === 'object' && body !== null && 'kind' in body ? body.kind : null

      if (kind === 'normalize-run') {
        await handleNormalizeRunMessage(message, env)
        continue
      }

      if (kind === 'derive-run') {
        await handleDeriveRunMessage(message, env)
        continue
      }

      if (kind === 'schedule-comparisons') {
        await handleScheduleComparisonsMessage(message, env)
        continue
      }

      if (kind === 'materialize-comparison') {
        await handleMaterializeComparisonMessage(message, env)
        continue
      }

      console.error('Dropping unknown queue message', body)
      message.ack()
    }
  },
}
