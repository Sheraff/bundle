import { scenarioSlugSchema } from "@workspace/contracts"
import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { createServerFn, useServerFn } from "@tanstack/react-start"
import { ulid } from "ulid"
import { useState } from "react"
import * as v from "valibot"

import { HostedSyntheticForm } from "../components/hosted-synthetic-form.js"
import { getDb, schema } from "../db/index.js"
import { repositoryAdminParamsSchema } from "../lib/repository-admin-schema.js"

import "./repo-shared.css"

const hostedSyntheticInputSchema = v.strictObject({
  params: repositoryAdminParamsSchema,
  scenarioSlug: scenarioSlugSchema,
  displayName: v.pipe(v.string(), v.trim(), v.minLength(1)),
  sourceText: v.pipe(v.string(), v.trim(), v.minLength(1)),
  budgetRawBytes: v.optional(v.number()),
  budgetGzipBytes: v.optional(v.number()),
  budgetBrotliBytes: v.optional(v.number()),
})

const getNewHostedSyntheticScenario = createServerFn({ method: "GET" })
  .inputValidator(repositoryAdminParamsSchema)
  .handler(async ({ context, data }) => {
    const { requireRepositoryAdminRoute } = await import("../lib/repository-admin.server.js")
    const { repository } = await requireRepositoryAdminRoute(context.env, data)
    return { repository: { owner: repository.owner, name: repository.name } }
  })

const createHostedSyntheticScenario = createServerFn({ method: "POST" })
  .inputValidator(hostedSyntheticInputSchema)
  .handler(async ({ context, data }) => {
    const { requireRepositoryAdminRoute } = await import("../lib/repository-admin.server.js")
    const { repository } = await requireRepositoryAdminRoute(context.env, data.params)
    const now = new Date().toISOString()
    await getDb(context.env).insert(schema.hostedSyntheticScenarios).values({
      id: ulid(),
      repositoryId: repository.id,
      scenarioSlug: data.scenarioSlug,
      displayName: data.displayName,
      sourceText: data.sourceText,
      budgetRawBytes: data.budgetRawBytes ?? null,
      budgetGzipBytes: data.budgetGzipBytes ?? null,
      budgetBrotliBytes: data.budgetBrotliBytes ?? null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    return { ok: true }
  })

export const Route = createFileRoute("/r/$owner/$repo/settings/synthetic-scenarios/new")({
  params: { parse: (params) => v.parse(repositoryAdminParamsSchema, params) },
  loader: ({ params }) => getNewHostedSyntheticScenario({ data: params }),
  component: NewHostedSyntheticScenarioRoute,
})

function NewHostedSyntheticScenarioRoute() {
  const data = Route.useLoaderData()
  const params = Route.useParams()
  const router = useRouter()
  const createDefinition = useServerFn(createHostedSyntheticScenario)
  const [error, setError] = useState<string | null>(null)

  return (
    <main className="page repo-page">
      <header className="page-header">
        <p className="breadcrumb">
          <Link to="/r/$owner/$repo/settings/synthetic-scenarios" params={{ owner: data.repository.owner, repo: data.repository.name }}>
            Hosted synthetic scenarios
          </Link>
          <span aria-hidden="true">/</span>
          <span>New</span>
        </p>
        <h1>Create hosted synthetic scenario</h1>
        <p>Hosted definitions resolve at CI build time. Real measurement still happens in GitHub Actions.</p>
      </header>

      <HostedSyntheticForm
        submitLabel="Create"
        onSubmit={async (input) => {
          try {
            setError(null)
            await createDefinition({ data: { params, ...input } })
            await router.navigate({ to: "/r/$owner/$repo/settings/synthetic-scenarios", params })
          } catch (error) {
            setError(error instanceof Error ? error.message : "Could not create hosted synthetic scenario.")
          }
        }}
      />
      {error ? <p className="text-danger">{error}</p> : null}
    </main>
  )
}
