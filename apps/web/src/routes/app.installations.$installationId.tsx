import { positiveIntegerSchema } from "@workspace/contracts"
import { and, asc, eq } from "drizzle-orm"
import { useState } from "react"
import * as v from "valibot"
import { Link, createFileRoute, notFound, redirect, useNavigate } from "@tanstack/react-router"
import { createServerFn, useServerFn } from "@tanstack/react-start"
import { getRequest, setResponseStatus } from "@tanstack/react-start/server"

import { requireUser } from "../auth/session.js"
import { getDb, schema } from "../db/index.js"
import type { AppBindings } from "../env.js"
import {
  enableRepositoryForUser,
  OnboardingAuthorizationError,
  syncInstallationForUser,
} from "../github/onboarding.js"

const getInstallationPage = createServerFn({ method: "GET" })
  .inputValidator(
    v.object({
      installationId: positiveIntegerSchema,
    }),
  )
  .handler(async ({ context, data }) => {
    const user = await requireRouteUser(context.env)

    try {
      await syncInstallationForUser(context.env, user, data.installationId)
    } catch (error) {
      if (error instanceof OnboardingAuthorizationError) throw notFound()
      throw error
    }

    const repositories = await getDb(context.env)
      .select({
        accessStatus: schema.githubInstallationRepositories.accessStatus,
        enabled: schema.repositories.enabled,
        name: schema.githubInstallationRepositories.name,
        owner: schema.githubInstallationRepositories.owner,
        private: schema.githubInstallationRepositories.private,
      })
      .from(schema.githubInstallationRepositories)
      .leftJoin(
        schema.repositories,
        and(
          eq(schema.repositories.githubRepoId, schema.githubInstallationRepositories.githubRepoId),
          eq(schema.repositories.installationId, data.installationId),
        ),
      )
      .where(eq(schema.githubInstallationRepositories.installationId, data.installationId))
      .orderBy(
        asc(schema.githubInstallationRepositories.owner),
        asc(schema.githubInstallationRepositories.name),
      )

    return {
      installationId: data.installationId,
      repositories,
    }
  })

const enableRepository = createServerFn({ method: "POST" })
  .inputValidator(
    v.object({
      installationId: positiveIntegerSchema,
      owner: v.string(),
      repo: v.string(),
    }),
  )
  .handler(async ({ context, data }) => {
    const user = await requireRouteUser(context.env)

    try {
      await enableRepositoryForUser(context.env, user, data.installationId, data.owner, data.repo)
      return {
        kind: "ok" as const,
      }
    } catch (error) {
      setResponseStatus(403)
      return {
        kind: "error" as const,
        message: error instanceof Error ? error.message : "Could not enable repository.",
      }
    }
  })

export const Route = createFileRoute("/app/installations/$installationId")({
  params: {
    parse: (params) =>
      v.parse(
        v.object({
          installationId: v.pipe(v.string(), v.toNumber(), positiveIntegerSchema),
        }),
        params,
      ),
  },
  loader: ({ params }) => getInstallationPage({ data: params }),
  component: InstallationRouteComponent,
})

function InstallationRouteComponent() {
  const data = Route.useLoaderData()

  return (
    <main>
      <p>
        <Link to="/app">Back to admin</Link>
      </p>
      <h1>Installation {data.installationId}</h1>
      <table>
        <thead>
          <tr>
            <th>Repository</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {data.repositories.map((repository) => {
            const fullName = `${repository.owner}/${repository.name}`
            const status =
              repository.private === 1
                ? "Private repos are not supported in V1"
                : repository.enabled === 1
                  ? "Enabled"
                  : repository.accessStatus === "active"
                    ? "Available"
                    : "Removed"

            return (
              <tr key={fullName}>
                <td>{fullName}</td>
                <td>{status}</td>
                <td>
                  {repository.private === 1 ||
                  repository.accessStatus !== "active" ? null : repository.enabled === 1 ? (
                    <Link
                      to="/r/$owner/$repo/settings"
                      params={{ owner: repository.owner, repo: repository.name }}
                    >
                      Settings
                    </Link>
                  ) : (
                    <EnableRepositoryForm
                      installationId={data.installationId}
                      owner={repository.owner}
                      repo={repository.name}
                    />
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </main>
  )
}

function EnableRepositoryForm({
  installationId,
  owner,
  repo,
}: {
  installationId: number
  owner: string
  repo: string
}) {
  const enableRepositoryFn = useServerFn(enableRepository)
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault()
        setError(null)
        setPending(true)

        try {
          const result = await enableRepositoryFn({
            data: {
              installationId,
              owner,
              repo,
            },
          })

          if (result.kind === "error") {
            setError(result.message)
            return
          }

          await navigate({
            to: "/r/$owner/$repo/settings",
            params: { owner, repo },
          })
        } finally {
          setPending(false)
        }
      }}
    >
      <button disabled={pending} type="submit">
        Enable
      </button>
      {error ? <p>{error}</p> : null}
    </form>
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

function loginUrl(redirectTo: string) {
  return `/api/v1/auth/github/start?redirect_to=${encodeURIComponent(redirectTo)}`
}
