import { Hono } from 'hono'

import type { AppEnv } from './env.js'
import { registerUploadRoutes } from './routes/uploads.js'

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

export default app
