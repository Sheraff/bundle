import {
  nonEmptyStringSchema,
  publicRepositoryRouteParamsSchema,
  ulidSchema,
} from "@workspace/contracts"
import { and, eq } from "drizzle-orm"
import type { Hono } from "hono"
import * as v from "valibot"

import { getDb, schema } from "../db/index.js"
import type { AppEnv } from "../env.js"
import { parseSizeMetric } from "../lib/size-metric.js"
import { requireRepository } from "../lib/public-read-models/shared.server.js"
import { loadTreemapFrameForScenarioRun } from "../lib/public-read-models/selected-series-detail.server.js"
import { formatIssues } from "../shared/format-issues.js"

const treemapFrameQuerySchema = v.strictObject({
  owner: publicRepositoryRouteParamsSchema.entries.owner,
  repo: publicRepositoryRouteParamsSchema.entries.repo,
  scenarioRunId: ulidSchema,
  env: nonEmptyStringSchema,
  entrypoint: nonEmptyStringSchema,
  metric: v.optional(nonEmptyStringSchema),
})

export function registerPublicApiRoutes(app: Hono<AppEnv>) {
  app.get("/api/v1/public/treemap-frame", async (c) => {
    const parsed = v.safeParse(treemapFrameQuerySchema, {
      owner: c.req.query("owner"),
      repo: c.req.query("repo"),
      scenarioRunId: c.req.query("scenarioRunId"),
      env: c.req.query("env"),
      entrypoint: c.req.query("entrypoint"),
      metric: c.req.query("metric"),
    })

    if (!parsed.success) {
      return c.json({ error: { code: "invalid_query", message: formatIssues(parsed.issues) } }, 400)
    }

    const repository = await requireRepository(c.env, parsed.output.owner, parsed.output.repo)
    const scenarioRun = await getDb(c.env)
      .select({ id: schema.scenarioRuns.id })
      .from(schema.scenarioRuns)
      .where(and(
        eq(schema.scenarioRuns.id, parsed.output.scenarioRunId),
        eq(schema.scenarioRuns.repositoryId, repository.id),
      ))
      .limit(1)

    if (scenarioRun.length === 0) {
      return c.json({ error: { code: "not_found", message: "The requested treemap frame was not found." } }, 404)
    }

    const nodes = await loadTreemapFrameForScenarioRun(c.env, {
      scenarioRunId: parsed.output.scenarioRunId,
      environment: parsed.output.env,
      entrypoint: parsed.output.entrypoint,
      metric: parseSizeMetric(parsed.output.metric),
    })

    return c.json({ nodes })
  })
}
