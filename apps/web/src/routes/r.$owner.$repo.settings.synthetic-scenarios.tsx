import { Link, createFileRoute } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { asc, eq } from "drizzle-orm"
import * as v from "valibot"

import { getDb, schema } from "../db/index.js"
import { StateBadge } from "../components/state-badge.js"
import { repositoryAdminParamsSchema } from "../lib/repository-admin-schema.js"

import "./repo-shared.css"

const getHostedSyntheticScenarios = createServerFn({ method: "GET" })
  .inputValidator(repositoryAdminParamsSchema)
  .handler(async ({ context, data }) => {
    const { requireRepositoryAdminRoute } = await import("../lib/repository-admin.server.js")
    const { repository } = await requireRepositoryAdminRoute(context.env, data)
    const [definitions, repoScenarios] = await Promise.all([
      getDb(context.env)
        .select()
        .from(schema.hostedSyntheticScenarios)
        .where(eq(schema.hostedSyntheticScenarios.repositoryId, repository.id))
        .orderBy(asc(schema.hostedSyntheticScenarios.scenarioSlug)),
      getDb(context.env)
        .select({ slug: schema.scenarios.slug, sourceKind: schema.scenarios.sourceKind })
        .from(schema.scenarios)
        .where(eq(schema.scenarios.repositoryId, repository.id)),
    ])
    const repoDefinedSlugs = new Set(repoScenarios.filter((scenario) => scenario.sourceKind !== "hosted-synthetic").map((scenario) => scenario.slug))

    return {
      repository: { owner: repository.owner, name: repository.name },
      definitions: definitions.map((definition) => ({
        ...definition,
        shadowedByRepoDefinition: repoDefinedSlugs.has(definition.scenarioSlug),
      })),
    }
  })

export const Route = createFileRoute("/r/$owner/$repo/settings/synthetic-scenarios")({
  params: { parse: (params) => v.parse(repositoryAdminParamsSchema, params) },
  loader: ({ params }) => getHostedSyntheticScenarios({ data: params }),
  component: HostedSyntheticScenarioListRoute,
})

function HostedSyntheticScenarioListRoute() {
  const data = Route.useLoaderData()

  return (
    <main className="page repo-page">
      <header className="page-header">
        <p className="breadcrumb">
          <Link to="/r/$owner/$repo/settings" params={{ owner: data.repository.owner, repo: data.repository.name }}>
            Settings
          </Link>
          <span aria-hidden="true">/</span>
          <span>Hosted synthetic scenarios</span>
        </p>
        <h1>Hosted synthetic scenarios</h1>
        <p>Hosted definitions are stored here for CI resolution. Real measurement still happens in GitHub Actions.</p>
        <div className="row">
          <Link
            className="button-link"
            to="/r/$owner/$repo/settings/synthetic-scenarios/new"
            params={{ owner: data.repository.owner, repo: data.repository.name }}
          >
            Create hosted synthetic scenario
          </Link>
        </div>
      </header>

      <section className="section">
        <h2>Definitions</h2>
        {data.definitions.length === 0 ? (
          <p className="notice">No hosted synthetic scenarios have been configured.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>Display name</th>
                  <th>Budgets</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.definitions.map((definition) => {
                  const status = definition.archivedAt
                    ? "archived"
                    : definition.shadowedByRepoDefinition
                      ? "shadowed"
                      : "active"
                  return (
                    <tr key={definition.id}>
                      <td className="mono">{definition.scenarioSlug}</td>
                      <td>{definition.displayName}</td>
                      <td className="num text-secondary">{formatBudgets(definition)}</td>
                      <td><StateBadge state={status} /></td>
                      <td>
                        <Link
                          to="/r/$owner/$repo/settings/synthetic-scenarios/$scenarioId/edit"
                          params={{ owner: data.repository.owner, repo: data.repository.name, scenarioId: definition.id }}
                        >
                          Edit
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}

function formatBudgets(definition: { budgetRawBytes: number | null; budgetGzipBytes: number | null; budgetBrotliBytes: number | null }) {
  const parts = [
    definition.budgetRawBytes == null ? null : `raw ${definition.budgetRawBytes}`,
    definition.budgetGzipBytes == null ? null : `gzip ${definition.budgetGzipBytes}`,
    definition.budgetBrotliBytes == null ? null : `brotli ${definition.budgetBrotliBytes}`,
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(", ") : "not configured"
}
