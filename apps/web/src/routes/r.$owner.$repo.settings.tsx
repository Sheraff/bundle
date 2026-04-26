import { publicRepositoryRouteParamsSchema } from "@workspace/contracts"
import { and, desc, eq } from "drizzle-orm"
import * as v from "valibot"
import { Link, createFileRoute, notFound, redirect } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"

import { requireUser } from "../auth/session.js"
import { getDb, schema } from "../db/index.js"
import { repositoryRouteMatch } from "../db/repository-route-match.js"
import { selectOne } from "../db/select-one.js"
import type { AppBindings } from "../env.js"
import { requireRepositoryAdminForUser } from "../github/onboarding.js"

import "./repo-shared.css"

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

    const [scenarioRuns, publications] = await Promise.all([
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
      scenarioRuns: scenarioRuns.map((scenarioRun) => ({
        ...scenarioRun,
        shortCommitSha: formatSha(scenarioRun.commitSha),
        workflowUrl: scenarioRun.ciWorkflowRunId
          ? `https://github.com/${repository.owner}/${repository.name}/actions/runs/${scenarioRun.ciWorkflowRunId}`
          : null,
      })),
    }
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

async function requireRouteUser(env: AppBindings) {
  const request = getRequest()

  try {
    return await requireUser(env, request)
  } catch {
    const url = new URL(request.url)
    throw redirect({
      href: loginUrl(`${url.pathname}${url.search}`),
      statusCode: 302,
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

function loginUrl(redirectTo: string) {
  return `/api/v1/auth/github/start?redirect_to=${encodeURIComponent(redirectTo)}`
}
