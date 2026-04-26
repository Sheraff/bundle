import { Link, createFileRoute, redirect } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"

import { requireUser } from "../auth/session.js"
import type { AppBindings } from "../env.js"

const getSetupGuide = createServerFn({ method: "GET" }).handler(async ({ context }) => {
  await requireRouteUser(context.env)

  return {
    appOrigin: context.env.PUBLIC_APP_ORIGIN,
    callbackUrl: `${context.env.PUBLIC_APP_ORIGIN}/api/v1/auth/github/callback`,
    setupUrl: `${context.env.PUBLIC_APP_ORIGIN}/api/v1/github/setup`,
    webhookUrl: `${context.env.PUBLIC_APP_ORIGIN}/api/v1/github/webhooks`,
  }
})

export const Route = createFileRoute("/app/setup")({
  loader: () => getSetupGuide(),
  component: SetupGuideRouteComponent,
})

function SetupGuideRouteComponent() {
  const data = Route.useLoaderData()

  return (
    <main className="page narrow">
      <header className="page-header">
        <p className="breadcrumb">
          <Link to="/app">Admin</Link>
          <span aria-hidden="true">/</span>
          <span>Setup guide</span>
        </p>
        <h1>Setup guide</h1>
        <p>Use these values for the staging GitHub App and repository workflow.</p>
      </header>

      <section className="section">
        <h2>GitHub App URLs</h2>
        <dl className="definition">
          <dt>Homepage</dt>
          <dd><code>{data.appOrigin}</code></dd>
          <dt>Callback</dt>
          <dd><code>{data.callbackUrl}</code></dd>
          <dt>Setup</dt>
          <dd><code>{data.setupUrl}</code></dd>
          <dt>Webhook</dt>
          <dd><code>{data.webhookUrl}</code></dd>
        </dl>
      </section>

      <section className="section">
        <h2>Repository permissions</h2>
        <ul className="bulleted">
          <li>Metadata: read</li>
          <li>Contents: read</li>
          <li>Pull requests: read/write</li>
          <li>Issues: read/write</li>
          <li>Checks: read/write</li>
        </ul>
      </section>

      <section className="section">
        <h2>Webhook events</h2>
        <ul className="bulleted">
          <li>Repository</li>
          <li>Pull request</li>
          <li>Installation</li>
          <li>Installation repositories</li>
        </ul>
      </section>

      <section className="section">
        <h2>Workflow permissions</h2>
        <pre><code>{`permissions:
  contents: read
  id-token: write`}</code></pre>
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

function loginUrl(redirectTo: string) {
  return `/api/v1/auth/github/start?redirect_to=${encodeURIComponent(redirectTo)}`
}
