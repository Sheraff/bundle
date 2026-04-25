import { scenarioSlugSchema } from "@workspace/contracts"
import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { createServerFn, useServerFn } from "@tanstack/react-start"
import { and, eq } from "drizzle-orm"
import { useState } from "react"
import * as v from "valibot"

import { HostedSyntheticForm } from "../components/hosted-synthetic-form.js"
import { getDb, schema } from "../db/index.js"
import { selectOne } from "../db/select-one.js"
import { repositoryAdminParamsSchema } from "../lib/repository-admin-schema.js"

const editParamsSchema = v.strictObject({
  owner: repositoryAdminParamsSchema.entries.owner,
  repo: repositoryAdminParamsSchema.entries.repo,
  scenarioId: v.pipe(v.string(), v.minLength(1)),
})

const updateInputSchema = v.strictObject({
  params: editParamsSchema,
  scenarioSlug: scenarioSlugSchema,
  displayName: v.pipe(v.string(), v.trim(), v.minLength(1)),
  sourceText: v.pipe(v.string(), v.trim(), v.minLength(1)),
  budgetRawBytes: v.optional(v.number()),
  budgetGzipBytes: v.optional(v.number()),
  budgetBrotliBytes: v.optional(v.number()),
})

const getEditHostedSyntheticScenario = createServerFn({ method: "GET" })
  .inputValidator(editParamsSchema)
  .handler(async ({ context, data }) => {
    const { requireRepositoryAdminRoute } = await import("../lib/repository-admin.server.js")
    const { repository } = await requireRepositoryAdminRoute(context.env, data)
    const definition = await selectOne(getDb(context.env).select().from(schema.hostedSyntheticScenarios).where(and(eq(schema.hostedSyntheticScenarios.repositoryId, repository.id), eq(schema.hostedSyntheticScenarios.id, data.scenarioId))).limit(1))
    if (!definition) throw new Error("Hosted synthetic scenario was not found.")
    return { repository: { owner: repository.owner, name: repository.name }, definition }
  })

const updateHostedSyntheticScenario = createServerFn({ method: "POST" })
  .inputValidator(updateInputSchema)
  .handler(async ({ context, data }) => {
    const { requireRepositoryAdminRoute } = await import("../lib/repository-admin.server.js")
    const { repository } = await requireRepositoryAdminRoute(context.env, data.params)
    await getDb(context.env).update(schema.hostedSyntheticScenarios).set({
      scenarioSlug: data.scenarioSlug,
      displayName: data.displayName,
      sourceText: data.sourceText,
      budgetRawBytes: data.budgetRawBytes ?? null,
      budgetGzipBytes: data.budgetGzipBytes ?? null,
      budgetBrotliBytes: data.budgetBrotliBytes ?? null,
      updatedAt: new Date().toISOString(),
    }).where(and(eq(schema.hostedSyntheticScenarios.repositoryId, repository.id), eq(schema.hostedSyntheticScenarios.id, data.params.scenarioId)))
    return { ok: true }
  })

const archiveHostedSyntheticScenario = createServerFn({ method: "POST" })
  .inputValidator(editParamsSchema)
  .handler(async ({ context, data }) => {
    const { requireRepositoryAdminRoute } = await import("../lib/repository-admin.server.js")
    const { repository } = await requireRepositoryAdminRoute(context.env, data)
    const now = new Date().toISOString()
    await getDb(context.env).update(schema.hostedSyntheticScenarios).set({ archivedAt: now, updatedAt: now }).where(and(eq(schema.hostedSyntheticScenarios.repositoryId, repository.id), eq(schema.hostedSyntheticScenarios.id, data.scenarioId)))
    return { ok: true }
  })

export const Route = createFileRoute("/r/$owner/$repo/settings/synthetic-scenarios/$scenarioId/edit")({
  params: { parse: (params) => v.parse(editParamsSchema, params) },
  loader: ({ params }) => getEditHostedSyntheticScenario({ data: params }),
  component: EditHostedSyntheticScenarioRoute,
})

function EditHostedSyntheticScenarioRoute() {
  const data = Route.useLoaderData()
  const params = Route.useParams()
  const router = useRouter()
  const updateDefinition = useServerFn(updateHostedSyntheticScenario)
  const archiveDefinition = useServerFn(archiveHostedSyntheticScenario)
  const [error, setError] = useState<string | null>(null)

  return (
    <main>
      <p><Link to="/r/$owner/$repo/settings/synthetic-scenarios" params={{ owner: data.repository.owner, repo: data.repository.name }}>Back to hosted scenarios</Link></p>
      <h1>Edit Hosted Synthetic Scenario</h1>
      {data.definition.archivedAt ? <p>This definition is archived. It is kept for auditability and can be edited before future reactivation work.</p> : null}
      <HostedSyntheticForm initial={{
        ...data.definition,
        budgetRawBytes: data.definition.budgetRawBytes ?? undefined,
        budgetGzipBytes: data.definition.budgetGzipBytes ?? undefined,
        budgetBrotliBytes: data.definition.budgetBrotliBytes ?? undefined,
      }} submitLabel="Save" onSubmit={async (input) => {
        try {
          setError(null)
          await updateDefinition({ data: { params, ...input } })
          await router.invalidate()
        } catch (error) {
          setError(error instanceof Error ? error.message : "Could not save hosted synthetic scenario.")
        }
      }} />
      <button type="button" onClick={async () => { await archiveDefinition({ data: params }); await router.invalidate() }}>Archive</button>
      {error ? <p>{error}</p> : null}
    </main>
  )
}
