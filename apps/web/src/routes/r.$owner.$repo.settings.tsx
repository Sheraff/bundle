import { publicRepositoryRouteParamsSchema } from "@workspace/contracts"
import { and, asc, desc, eq } from "drizzle-orm"
import * as v from "valibot"
import { Link, createFileRoute, notFound, redirect, useRouter } from "@tanstack/react-router"
import { createServerFn, useServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { useState } from "react"
import { ulid } from "ulid"

import { requireUser } from "../auth/session.js"
import { getDb, schema } from "../db/index.js"
import { repositoryRouteMatch } from "../db/repository-route-match.js"
import { selectOne } from "../db/select-one.js"
import type { AppBindings } from "../env.js"
import { requireRepositoryAdminForUser } from "../github/onboarding.js"
import { policySentence } from "../policies.js"

import "./repo-shared.css"

const createPolicyInputSchema = v.strictObject({
  blocking: v.boolean(),
  enabled: v.boolean(),
  entrypointKey: v.optional(v.string()),
  environment: v.optional(v.string()),
  lens: v.optional(v.string()),
  name: v.pipe(v.string(), v.minLength(1)),
  operator: v.union([v.literal("delta_greater_than"), v.literal("total_greater_than")]),
  owner: v.pipe(v.string(), v.minLength(1)),
  repo: v.pipe(v.string(), v.minLength(1)),
  scenarioSlug: v.pipe(v.string(), v.minLength(1)),
  severity: v.union([v.literal("warning"), v.literal("error")]),
  sizeMetric: v.union([v.literal("raw"), v.literal("gzip"), v.literal("brotli")]),
  thresholdBytes: v.pipe(v.number(), v.integer(), v.minValue(0)),
})

const getRepositorySettings = createServerFn({ method: "GET" })
  .inputValidator(publicRepositoryRouteParamsSchema)
  .handler(async ({ context, data }) => {
    const user = await requireRouteUser(context.env)

    const db = getDb(context.env)
    const repository = await selectOne(
      db
        .select()
        .from(schema.repositories)
        .where(repositoryRouteMatch(data.owner, data.repo))
        .limit(1),
    )

    if (!repository || repository.enabled !== 1) {
      throw notFound()
    }

    try {
      await requireRepositoryAdminForUser(context.env, user, repository.owner, repository.name)
    } catch {
      throw notFound()
    }

    const [scenarioRuns, publications, scenarios, policies] = await Promise.all([
      db
        .select({
          branch: schema.scenarioRuns.branch,
          ciWorkflowRunId: schema.scenarioRuns.ciWorkflowRunId,
          commitSha: schema.scenarioRuns.commitSha,
          failureCode: schema.scenarioRuns.failureCode,
          failureMessage: schema.scenarioRuns.failureMessage,
          scenarioId: schema.scenarioRuns.scenarioId,
          status: schema.scenarioRuns.status,
          updatedAt: schema.scenarioRuns.updatedAt,
          uploadedAt: schema.scenarioRuns.uploadedAt,
        })
        .from(schema.scenarioRuns)
        .where(eq(schema.scenarioRuns.repositoryId, repository.id))
        .orderBy(desc(schema.scenarioRuns.createdAt))
        .limit(5),
      db
        .select({
          externalUrl: schema.githubPublications.externalUrl,
          lastErrorCode: schema.githubPublications.lastErrorCode,
          lastErrorMessage: schema.githubPublications.lastErrorMessage,
          prNumber: schema.pullRequests.prNumber,
          publishedHeadSha: schema.githubPublications.publishedHeadSha,
          status: schema.githubPublications.status,
          surface: schema.githubPublications.surface,
          updatedAt: schema.githubPublications.updatedAt,
        })
        .from(schema.githubPublications)
        .leftJoin(
          schema.pullRequests,
          eq(schema.pullRequests.id, schema.githubPublications.pullRequestId),
        )
        .where(eq(schema.githubPublications.repositoryId, repository.id))
        .orderBy(desc(schema.githubPublications.updatedAt))
        .limit(5),
      db
        .select({ id: schema.scenarios.id, slug: schema.scenarios.slug })
        .from(schema.scenarios)
        .where(eq(schema.scenarios.repositoryId, repository.id))
        .orderBy(asc(schema.scenarios.slug)),
      db
        .select({
          blocking: schema.policies.blocking,
          enabled: schema.policies.enabled,
          entrypointKey: schema.policies.entrypointKey,
          environment: schema.policies.environment,
          id: schema.policies.id,
          lens: schema.policies.lens,
          name: schema.policies.name,
          operator: schema.policies.operator,
          scenarioSlug: schema.scenarios.slug,
          severity: schema.policies.severity,
          sizeMetric: schema.policies.sizeMetric,
          thresholdBytes: schema.policies.thresholdBytes,
          updatedAt: schema.policies.updatedAt,
          version: schema.policies.version,
        })
        .from(schema.policies)
        .innerJoin(schema.scenarios, eq(schema.scenarios.id, schema.policies.scenarioId))
        .where(eq(schema.policies.repositoryId, repository.id))
        .orderBy(asc(schema.scenarios.slug), asc(schema.policies.name)),
    ])

    return {
      apiOrigin: context.env.PUBLIC_APP_ORIGIN,
      repository: {
        name: repository.name,
        owner: repository.owner,
      },
      publications: publications.map((publication) => ({
        ...publication,
        shortPublishedHeadSha: publication.publishedHeadSha
          ? formatSha(publication.publishedHeadSha)
          : null,
      })),
      policies: policies.map((policy) => ({
        ...policy,
        sentence: policySentence(policy),
      })),
      scenarioRuns: scenarioRuns.map((scenarioRun) => ({
        ...scenarioRun,
        shortCommitSha: formatSha(scenarioRun.commitSha),
        workflowUrl: scenarioRun.ciWorkflowRunId
          ? `https://github.com/${repository.owner}/${repository.name}/actions/runs/${scenarioRun.ciWorkflowRunId}`
          : null,
      })),
      scenarios,
    }
  })

const createPolicy = createServerFn({ method: "POST" })
  .inputValidator(createPolicyInputSchema)
  .handler(async ({ context, data }) => {
    const user = await requireRouteUser(context.env)
    const db = getDb(context.env)
    const repository = await selectOne(
      db
        .select()
        .from(schema.repositories)
        .where(repositoryRouteMatch(data.owner, data.repo))
        .limit(1),
    )

    if (!repository || repository.enabled !== 1) throw notFound()
    await requireRepositoryAdminForUser(context.env, user, repository.owner, repository.name)

    const scenario = await selectOne(
      db
        .select({ id: schema.scenarios.id })
        .from(schema.scenarios)
        .where(and(eq(schema.scenarios.repositoryId, repository.id), eq(schema.scenarios.slug, data.scenarioSlug)))
        .limit(1),
    )

    if (!scenario) {
      return { kind: "error" as const, message: "Scenario was not found." }
    }

    const timestamp = new Date().toISOString()
    await db.insert(schema.policies).values({
      id: ulid(),
      repositoryId: repository.id,
      scenarioId: scenario.id,
      name: data.name,
      environment: emptyToNull(data.environment),
      entrypointKey: emptyToNull(data.entrypointKey),
      lens: emptyToNull(data.lens),
      sizeMetric: data.sizeMetric,
      operator: data.operator,
      thresholdBytes: data.thresholdBytes,
      severity: data.severity,
      blocking: data.blocking ? 1 : 0,
      enabled: data.enabled ? 1 : 0,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    return { kind: "ok" as const }
  })

export const Route = createFileRoute("/r/$owner/$repo/settings")({
  params: {
    parse: (params) => v.parse(publicRepositoryRouteParamsSchema, params),
  },
  loader: ({ params }) => getRepositorySettings({ data: params }),
  component: RepositorySettingsRouteComponent,
})

function RepositorySettingsRouteComponent() {
  const data = Route.useLoaderData()

  return (
    <main className="page repo-page">
      <header className="page-header">
        <p className="breadcrumb">
          <Link to="/app">Admin</Link>
          <span aria-hidden="true">/</span>
          <span>{data.repository.owner}/{data.repository.name}</span>
        </p>
        <h1>
          <span data-owner>{data.repository.owner}</span>
          <span data-sep aria-hidden="true">/</span>
          {data.repository.name}
        </h1>
        <p>Repository settings, latest uploads, and publication state.</p>
        <div className="row">
          <Link
            className="button-secondary"
            to="/r/$owner/$repo"
            params={{ owner: data.repository.owner, repo: data.repository.name }}
          >
            Open public page
          </Link>
          <Link
            className="button-secondary"
            to="/r/$owner/$repo/settings/synthetic-scenarios"
            params={{ owner: data.repository.owner, repo: data.repository.name }}
          >
            Manage hosted synthetic scenarios
          </Link>
        </div>
      </header>

      <section className="section">
        <h2>Setup checklist</h2>
        <ol className="numbered">
          <li>Install the Chunk Scope Vite plugin.</li>
          <li>Add the plugin to <code>vite.config.ts</code> with a stable scenario id.</li>
          <li>Add this workflow to collect Chunk Scope data in GitHub Actions.</li>
        </ol>
        <pre><code>{buildWorkflowSnippet(data.apiOrigin)}</code></pre>
      </section>

      <PolicySettings data={data} />

      <section className="section">
        <h2>Latest uploads</h2>
        {data.scenarioRuns.length === 0 ? (
          <p className="notice">No uploads yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>Status</th>
                  <th>Commit</th>
                  <th>Branch</th>
                  <th>Workflow</th>
                  <th>Updated</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {data.scenarioRuns.map((scenarioRun) => (
                  <tr key={`${scenarioRun.ciWorkflowRunId}-${scenarioRun.commitSha}`}>
                    <td>{scenarioRun.scenarioId}</td>
                    <td>{scenarioRun.status}</td>
                    <td><code>{scenarioRun.shortCommitSha}</code></td>
                    <td>{scenarioRun.branch}</td>
                    <td>{scenarioRun.workflowUrl ? <a href={scenarioRun.workflowUrl}>workflow</a> : <span className="text-muted">—</span>}</td>
                    <td className="num">{scenarioRun.updatedAt}</td>
                    <td className="text-muted">{scenarioRun.failureCode ?? scenarioRun.failureMessage ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <h2>Latest GitHub publications</h2>
        {data.publications.length === 0 ? (
          <p className="notice">No PR comments or checks published yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Surface</th>
                  <th>Status</th>
                  <th>PR</th>
                  <th>Head</th>
                  <th>Link</th>
                  <th>Updated</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {data.publications.map((publication) => (
                  <tr key={`${publication.surface}-${publication.prNumber ?? "none"}`}>
                    <td>{publication.surface}</td>
                    <td>{publication.status}</td>
                    <td>{publication.prNumber ? `#${publication.prNumber}` : <span className="text-muted">—</span>}</td>
                    <td>{publication.shortPublishedHeadSha ? <code>{publication.shortPublishedHeadSha}</code> : <span className="text-muted">—</span>}</td>
                    <td>{publication.externalUrl ? <a href={publication.externalUrl}>open</a> : <span className="text-muted">—</span>}</td>
                    <td className="num">{publication.updatedAt}</td>
                    <td className="text-muted">{publication.lastErrorCode ?? publication.lastErrorMessage ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}

function PolicySettings(props: { data: ReturnType<typeof Route.useLoaderData> }) {
  const data = props.data
  const router = useRouter()
  const createPolicyFn = useServerFn(createPolicy)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  return (
    <section className="section">
      <h2>Scenario policies</h2>
      <p>Policies evaluate measured comparison rows. Policy state remains separate from measurement state.</p>
      {data.policies.length === 0 ? (
        <p className="notice">No scenario policies are configured yet.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Rule</th>
                <th>Consequence</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.policies.map((policy: { blocking: number; enabled: number; id: string; scenarioSlug: string; sentence: string; severity: string }) => (
                <tr key={policy.id}>
                  <td>{policy.scenarioSlug}</td>
                  <td>{policy.sentence}</td>
                  <td>{policy.blocking ? "Blocks merge" : policy.severity === "warning" ? "Warns only" : "No enforcement"}</td>
                  <td>{policy.enabled ? "enabled" : "disabled"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.scenarios.length === 0 ? (
        <p className="notice">Create or upload a scenario before adding policy rules.</p>
      ) : (
        <form
          className="compare-form"
          onSubmit={async (event) => {
            event.preventDefault()
            setError(null)
            setPending(true)

            const formData = new FormData(event.currentTarget)

            try {
              const result = await createPolicyFn({
                data: {
                  blocking: formData.get("blocking") === "on",
                  enabled: formData.get("enabled") === "on",
                  entrypointKey: String(formData.get("entrypointKey") ?? ""),
                  environment: String(formData.get("environment") ?? ""),
                  lens: String(formData.get("lens") ?? ""),
                  name: String(formData.get("name") ?? ""),
                  operator: formData.get("operator") === "total_greater_than" ? "total_greater_than" : "delta_greater_than",
                  owner: data.repository.owner,
                  repo: data.repository.name,
                  scenarioSlug: String(formData.get("scenarioSlug") ?? ""),
                  severity: formData.get("severity") === "warning" ? "warning" : "error",
                  sizeMetric: formData.get("sizeMetric") === "raw" ? "raw" : formData.get("sizeMetric") === "brotli" ? "brotli" : "gzip",
                  thresholdBytes: Number(formData.get("thresholdBytes") ?? 0),
                },
              })

              if (result.kind === "error") {
                setError(result.message)
              } else {
                await router.invalidate()
                event.currentTarget.reset()
              }
            } finally {
              setPending(false)
            }
          }}
        >
          <label>
            Rule name
            <input name="name" required placeholder="Gzip regression guard" />
          </label>
          <label>
            Scenario
            <select name="scenarioSlug" required>
              {data.scenarios.map((scenario: { id: string; slug: string }) => <option key={scenario.id} value={scenario.slug}>{scenario.slug}</option>)}
            </select>
          </label>
          <label>
            Environment
            <input name="environment" placeholder="optional, e.g. default" />
          </label>
          <label>
            Entrypoint
            <input name="entrypointKey" placeholder="optional, e.g. src/main.ts" />
          </label>
          <label>
            What's counted
            <input name="lens" placeholder="optional, defaults to any lens" />
          </label>
          <label>
            Size
            <select name="sizeMetric" defaultValue="gzip">
              <option value="raw">raw</option>
              <option value="gzip">gzip</option>
              <option value="brotli">brotli</option>
            </select>
          </label>
          <label>
            Operator
            <select name="operator" defaultValue="delta_greater_than">
              <option value="delta_greater_than">grows by more than</option>
              <option value="total_greater_than">is greater than</option>
            </select>
          </label>
          <label>
            Threshold bytes
            <input name="thresholdBytes" required type="number" min="0" defaultValue="10240" />
          </label>
          <label>
            Severity
            <select name="severity" defaultValue="error">
              <option value="error">error</option>
              <option value="warning">warning</option>
            </select>
          </label>
          <label><input name="blocking" type="checkbox" defaultChecked /> Blocks merge</label>
          <label><input name="enabled" type="checkbox" defaultChecked /> Enabled</label>
          <button disabled={pending} type="submit">{pending ? "Saving..." : "Create policy"}</button>
          {error ? <p className="notice">{error}</p> : null}
        </form>
      )}
    </section>
  )
}

async function requireRouteUser(env: AppBindings) {
  const request = getRequest()

  try {
    return await requireUser(env, request)
  } catch {
    const url = new URL(request.url)
    throw redirect({
      href: `/api/v1/auth/github/start?redirect_to=${encodeURIComponent(`${url.pathname}${url.search}`)}`,
      statusCode: 302,
      reloadDocument: true,
    })
  }
}

function buildWorkflowSnippet(apiOrigin: string) {
  return `name: Chunk Scope
on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  id-token: write

jobs:
  chunk-scope:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Sheraff/bundle/packages/github-action@staging
        env:
          BUNDLE_API_ORIGIN: ${apiOrigin}
        with:
          command: pnpm build`
}

function formatSha(sha: string) {
  return sha.slice(0, 7)
}

function emptyToNull(value: string | undefined) {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
