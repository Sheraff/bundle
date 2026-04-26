import { Link, createFileRoute, redirect } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"

import { requireUser } from "../auth/session.js"
import { listStoredInstallationsForUser } from "../github/onboarding.js"

const getAdminHome = createServerFn({ method: "GET" }).handler(async ({ context }) => {
  const user = await requireRouteUser(context.env)
  const installations = await listStoredInstallationsForUser(context.env, user)
  const installUrl = context.env.GITHUB_APP_SLUG
    ? `https://github.com/apps/${context.env.GITHUB_APP_SLUG}/installations/new`
    : null

  return {
    installUrl,
    installations: installations.map((installation) => ({
      account: {
        login: installation.account.login,
      },
      installationId: installation.installationId,
    })),
    user: {
      login: user.login,
    },
  }
})

export const Route = createFileRoute("/app/")({
  loader: () => getAdminHome(),
  component: AdminHomeRouteComponent,
})

function AdminHomeRouteComponent() {
  const data = Route.useLoaderData()

  return (
    <main className="page narrow">
      <header className="page-header">
        <h1>Admin</h1>
        <p>
          Signed in as <strong>{data.user.login}</strong>.{" "}
          <a href="/api/v1/auth/logout">Log out</a>.
        </p>
        <div className="row">
          {data.installUrl ? (
            <a className="button-link" href={data.installUrl}>
              Install on GitHub
            </a>
          ) : null}
          <Link className="button-secondary" to="/app/setup">
            Setup guide
          </Link>
        </div>
      </header>

      <section className="section">
        <h2>GitHub App installations</h2>
        {data.installations.length === 0 ? (
          <p className="notice">No installations found for this GitHub user.</p>
        ) : (
          <ul className="bulleted">
            {data.installations.map((installation) => (
              <li key={installation.installationId}>
                <Link
                  to="/app/installations/$installationId"
                  params={{ installationId: installation.installationId }}
                >
                  {installation.account.login}
                </Link>{" "}
                <small className="text-muted">({installation.installationId})</small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

async function requireRouteUser(env: Parameters<typeof requireUser>[0]) {
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
