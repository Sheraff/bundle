import { publicRepositoryRouteParamsSchema } from "@workspace/contracts"
import { and, eq } from "drizzle-orm"
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

    const repository = await selectOne(
      getDb(context.env)
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

    return {
      apiOrigin: context.env.PUBLIC_APP_ORIGIN,
      repository: {
        name: repository.name,
        owner: repository.owner,
      },
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
      <p>Repository enabled. Add this workflow to collect Chunk Scope data in GitHub Actions.</p>
      <pre>{buildWorkflowSnippet(data.apiOrigin)}</pre>
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
      - uses: Sheraff/bundle/packages/github-action@main
        env:
          BUNDLE_API_ORIGIN: ${apiOrigin}
        with:
          command: pnpm build`
}

function loginUrl(redirectTo: string) {
  return `/api/v1/auth/github/start?redirect_to=${encodeURIComponent(redirectTo)}`
}
