import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { useState } from "react"

import { getCurrentUser } from "../auth/session.js"

const getRootViewer = createServerFn({ method: "GET" }).handler(async ({ context }) => {
  try {
    const user = await getCurrentUser(context.env, getRequest())

    return user ? { login: user.login } : null
  } catch {
    return null
  }
})

export const Route = createRootRoute({
  loader: () => getRootViewer(),
  component: RootComponent,
  errorComponent: RootErrorComponent,
  notFoundComponent: RootNotFoundComponent,
})

function RootComponent() {
  const viewer = Route.useLoaderData()
  const [queryClient] = useState(() => new QueryClient())

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Chunk Scope</title>
        <HeadContent />
      </head>
      <body>
        <header>
          <nav aria-label="Global navigation">
            <Link to="/">Chunk Scope</Link> <Link to="/app">Admin</Link>{" "}
            <Link to="/app/setup">Setup</Link>{" "}
            {viewer ? (
              <>
                <span>Signed in as {viewer.login}</span> <a href="/api/v1/auth/logout">Sign out</a>
              </>
            ) : (
              <a href="/api/v1/auth/github/start">Sign in with GitHub</a>
            )}
          </nav>
        </header>
        <QueryClientProvider client={queryClient}>
          <Outlet />
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  )
}

function RootErrorComponent(props: { error: Error }) {
  return (
    <main>
      <h1>Application Error</h1>
      <p>{props.error.message}</p>
    </main>
  )
}

function RootNotFoundComponent() {
  return (
    <main>
      <h1>Not Found</h1>
      <p>The requested page does not exist.</p>
    </main>
  )
}
