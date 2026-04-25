import { Hono } from "hono"
import startHandler from "@tanstack/react-start/server-entry"

import { CommitGroupSettlementWorkflow } from "./commit-group-settlement-workflow.js"
import { registerAuthRoutes } from "./api/auth.js"
import { registerUploadAuthRoutes } from "./api/upload-auth.js"
import type { AppEnv } from "./env.js"
import { registerGithubWebhookRoutes } from "./github/webhook.js"
import { getAppLogger } from "./logger.js"
import { PrPublishDebounceWorkflow } from "./pr-publish-debounce-workflow.js"
import { dispatchMessage } from "./queues/dispatch-message.js"
import { registerUploadRoutes } from "./api/uploads.js"
import { registerPublicApiRoutes } from "./api/public.js"

const app = new Hono<AppEnv>()

app.get("/healthz", (c) => {
  return c.json({ ok: true })
})

registerUploadRoutes(app)
registerPublicApiRoutes(app)
registerUploadAuthRoutes(app)
registerAuthRoutes(app)
registerGithubWebhookRoutes(app)

app.all("*", async (c) => {
  return startHandler.fetch(c.req.raw, {
    context: {
      env: c.env,
      executionContext: c.executionCtx as ExecutionContext<unknown>,
    },
  })
})

app.onError((error, c) => {
  getAppLogger().error("Unhandled app error", error)

  if (c.req.path.startsWith("/api/")) {
    return c.json(
      {
        error: {
          code: "internal_error",
          message: "The server could not complete the request.",
        },
      },
      500,
    )
  }

  return c.text("The server could not complete the request.", 500)
})

export default {
  fetch: app.fetch.bind(app),
  queue: async (batch: MessageBatch<unknown>, env: Cloudflare.Env, _ctx?: ExecutionContext) => {
    const logger = getAppLogger()

    for (const message of batch.messages) {
      await dispatchMessage(message, env, logger)
    }
  },
}

export { CommitGroupSettlementWorkflow, PrPublishDebounceWorkflow }
