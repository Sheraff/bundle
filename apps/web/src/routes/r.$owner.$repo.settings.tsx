import { publicRepositoryRouteParamsSchema } from "@workspace/contracts"
import { and, desc, eq } from "drizzle-orm"
import * as v from "valibot"
import { Link, createFileRoute, notFound, redirect } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"

import { requireUser } from "../auth/session.js"
import { getDb, schema } from "../db/index.js"
import { selectOne } from "../db/select-one.js"
import type { AppBindings } from "../env.js"
import { requireRepositoryAdminForUser } from "../github/onboarding.js"

const getRepositorySettings = createServerFn({ method: "GET" })
  .inputValidator(publicRepositoryRouteParamsSchema)
  .handler(async ({ context, data }) => {
    const user = await requireRouteUser(context.env)

    try {
      await requireRepositoryAdminForUser(context.env, user, data.owner, data.repo)
    } catch {
      throw notFound()
    }

    const db = getDb(context.env)
    const repository = await selectOne(
      db
        .select()
        .from(schema.repositories)
        .where(
          and(eq(schema.repositories.owner, data.owner), eq(schema.repositories.name, data.repo)),
        )
        .limit(1),
    )

    if (!repository || repository.enabled !== 1) {
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
    <main>
      <p>
        <Link to="/app">Back to admin</Link>
      </p>
      <h1>
        {data.repository.owner}/{data.repository.name}
      </h1>
      <p>
        Repository enabled.{" "}
        <Link
          to="/r/$owner/$repo"
          params={{ owner: data.repository.owner, repo: data.repository.name }}
        >
          Open public page
        </Link>
        .
      </p>
      <h2>Setup checklist</h2>
      <ol>
        <li>Install the Chunk Scope Vite plugin.</li>
        <li>Add the plugin to `vite.config.ts` with a stable scenario id.</li>
        <li>Add this workflow to collect Chunk Scope data in GitHub Actions.</li>
      </ol>
      <pre>{buildWorkflowSnippet(data.apiOrigin)}</pre>
      <h2>Latest uploads</h2>
      {data.scenarioRuns.length === 0 ? (
        <p>No uploads yet.</p>
      ) : (
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
                <td>
                  <code>{scenarioRun.shortCommitSha}</code>
                </td>
                <td>{scenarioRun.branch}</td>
                <td>
                  {scenarioRun.workflowUrl ? <a href={scenarioRun.workflowUrl}>workflow</a> : "-"}
                </td>
                <td>{scenarioRun.updatedAt}</td>
                <td>{scenarioRun.failureCode ?? scenarioRun.failureMessage ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>Latest GitHub publications</h2>
      {data.publications.length === 0 ? (
        <p>No PR comments or checks published yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Surface</th>
              <th>Status</th>
              <th>PR</th>
              <th>Head</th>
              <th>External link</th>
              <th>Updated</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {data.publications.map((publication) => (
              <tr key={`${publication.surface}-${publication.prNumber ?? "none"}`}>
                <td>{publication.surface}</td>
                <td>{publication.status}</td>
                <td>{publication.prNumber ? `#${publication.prNumber}` : "-"}</td>
                <td>
                  {publication.shortPublishedHeadSha ? (
                    <code>{publication.shortPublishedHeadSha}</code>
                  ) : (
                    "-"
                  )}
                </td>
                <td>{publication.externalUrl ? <a href={publication.externalUrl}>open</a> : "-"}</td>
                <td>{publication.updatedAt}</td>
                <td>{publication.lastErrorCode ?? publication.lastErrorMessage ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
