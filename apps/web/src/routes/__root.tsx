import { QueryClient } from "@tanstack/react-query"
import { HeadContent, Link, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"

import { getCurrentUser } from "../auth/session.js"

import appCss from "../styles/index.css?url"
import "./__root.css"

const getRootViewer = createServerFn({ method: "GET" }).handler(async ({ context }) => {
  try {
    const user = await getCurrentUser(context.env, getRequest())

    return user ? { login: user.login } : null
  } catch {
    return null
  }
})

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  head: () => ({
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  loader: () => getRootViewer(),
  component: RootComponent,
  errorComponent: RootErrorComponent,
  notFoundComponent: RootNotFoundComponent,
})

function RootComponent() {
  const viewer = Route.useLoaderData()

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Chunk Scope</title>
        <HeadContent />
      </head>
      <body>
        <header className="app-header">
          <div>
            <Link to="/">
              <span aria-hidden="true">⌘</span>
              <span>Chunk Scope</span>
            </Link>
            <nav aria-label="Primary">
              <Link to="/app">Admin</Link>
              <Link to="/app/setup">Setup</Link>
            </nav>
            <div data-role="viewer">
              {viewer ? (
                <>
                  <span>
                    Signed in as <strong>{viewer.login}</strong>
                  </span>
                  <a className="button-secondary" href="/api/v1/auth/logout">Sign out</a>
                </>
              ) : (
                <a className="button-link" href="/api/v1/auth/github/start">Sign in with GitHub</a>
              )}
            </div>
          </div>
        </header>
        <Outlet />
        <Scripts />
      </body>
    </html>
  )
}

function RootErrorComponent(props: { error: Error }) {
  return (
    <main className="page narrow">
      <header className="page-header">
        <h1>Application error</h1>
        <p>Something went wrong while rendering this page.</p>
      </header>
      <pre>{props.error.message}</pre>
    </main>
  )
}

function RootNotFoundComponent() {
  return (
    <main className="page narrow">
      <header className="page-header">
        <h1>Not found</h1>
        <p>The requested page does not exist.</p>
      </header>
      <p>
        <Link to="/" className="button-secondary">Go home</Link>
      </p>
    </main>
  )
}
