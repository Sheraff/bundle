import { positiveIntegerSchema } from "@workspace/contracts"
import type { Hono } from "hono"
import * as v from "valibot"

import {
  createClearOAuthStateSetCookieHeader,
  createClearSessionSetCookieHeader,
  createOAuthStateSetCookieHeader,
  createSessionSetCookieHeader,
  readOAuthStateFromRequest,
  requireUser,
} from "../auth/session.js"
import type { AppEnv } from "../env.js"
import {
  createGithubOAuthAuthorizationUrl,
  exchangeGithubOAuthCode,
  fetchGithubAuthenticatedUser,
} from "../github-api.js"
import { syncInstallationForUser, upsertUserWithGithubToken } from "../github/onboarding.js"

export function registerAuthRoutes(app: Hono<AppEnv>) {
  app.get("/api/v1/auth/github/start", async (c) => {
    if (!c.env.GITHUB_APP_CLIENT_ID) {
      return c.text("GitHub OAuth is not configured.", 500)
    }

    const redirectTo = normalizeRedirectTo(
      c.req.query("redirect_to") ?? "/app",
      c.env.PUBLIC_APP_ORIGIN,
    )
    const nonce = crypto.randomUUID()
    const authorizationUrl = createGithubOAuthAuthorizationUrl(c.env, nonce)

    c.header(
      "set-cookie",
      await createOAuthStateSetCookieHeader(c.env, {
        nonce,
        redirectTo,
      }),
    )

    return c.redirect(authorizationUrl)
  })

  app.get("/api/v1/auth/github/callback", async (c) => {
    const state = c.req.query("state")
    const code = c.req.query("code")
    const storedState = await readOAuthStateFromRequest(c.env, c.req.raw)

    c.header("set-cookie", createClearOAuthStateSetCookieHeader(), { append: true })

    if (!code || !state || !storedState || storedState.nonce !== state) {
      return c.text("GitHub login could not be verified.", 400)
    }

    try {
      const githubToken = await exchangeGithubOAuthCode(c.env, code)
      const githubUser = await fetchGithubAuthenticatedUser(githubToken.accessToken)
      const user = await upsertUserWithGithubToken(c.env, githubUser, githubToken)

      c.header(
        "set-cookie",
        await createSessionSetCookieHeader(c.env, {
          githubUserId: user.githubUserId,
          login: user.login,
          userId: user.id,
        }),
        { append: true },
      )

      return c.redirect(storedState.redirectTo)
    } catch (error) {
      return c.text(error instanceof Error ? error.message : "GitHub login failed.", 502)
    }
  })

  app.get("/api/v1/auth/logout", (c) => {
    c.header("set-cookie", createClearSessionSetCookieHeader())
    return c.redirect("/")
  })

  app.get("/api/v1/github/setup", async (c) => {
    let user: Awaited<ReturnType<typeof requireUser>>

    try {
      user = await requireUser(c.env, c.req.raw)
    } catch {
      const redirectTo = encodeURIComponent(`${c.req.path}?${new URL(c.req.url).searchParams}`)
      return c.redirect(`/api/v1/auth/github/start?redirect_to=${redirectTo}`)
    }

    const queryResult = v.safeParse(v.pipe(
      v.string(),
      v.toNumber(),
      positiveIntegerSchema,
    ), c.req.query("installation_id"))

    if (!queryResult.success) {
      return c.text("Missing GitHub installation id.", 400)
    }

    const installationId = queryResult.output

    try {
      await syncInstallationForUser(c.env, user, installationId)
      return c.redirect(`/app/installations/${installationId}`)
    } catch (error) {
      return c.text(error instanceof Error ? error.message : "Could not sync installation.", 403)
    }
  })
}

export function normalizeRedirectTo(value: string, appOrigin: string) {
  let resolvedRedirect: URL
  let resolvedAppOrigin: URL

  try {
    resolvedAppOrigin = new URL(appOrigin)
    resolvedRedirect = new URL(value, resolvedAppOrigin)
  } catch {
    return "/app"
  }

  return resolvedRedirect.origin === resolvedAppOrigin.origin
    ? `${resolvedRedirect.pathname}${resolvedRedirect.search}${resolvedRedirect.hash}`
    : "/app"
}
