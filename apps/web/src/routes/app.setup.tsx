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
    <main>
      <p>
        <Link to="/app">Back to admin</Link>
      </p>
      <h1>Chunk Scope setup guide</h1>
      <p>Use these values for the staging GitHub App and repository workflow.</p>
      <h2>GitHub App URLs</h2>
      <dl>
        <dt>Homepage URL</dt>
        <dd>
          <code>{data.appOrigin}</code>
        </dd>
        <dt>Callback URL</dt>
        <dd>
          <code>{data.callbackUrl}</code>
        </dd>
        <dt>Setup URL</dt>
        <dd>
          <code>{data.setupUrl}</code>
        </dd>
        <dt>Webhook URL</dt>
        <dd>
          <code>{data.webhookUrl}</code>
        </dd>
      </dl>
      <h2>Repository permissions</h2>
      <ul>
        <li>Metadata: read</li>
        <li>Contents: read</li>
        <li>Pull requests: read/write</li>
        <li>Issues: read/write</li>
        <li>Checks: read/write</li>
      </ul>
      <h2>Webhook events</h2>
      <ul>
        <li>Repository</li>
        <li>Pull request</li>
        <li>Installation</li>
        <li>Installation repositories</li>
      </ul>
      <h2>Workflow permissions</h2>
      <pre>{`permissions:
  contents: read
  id-token: write`}</pre>
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
