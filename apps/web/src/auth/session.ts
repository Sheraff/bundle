import { eq } from "drizzle-orm"
import { generateCookie } from "hono/cookie"
import { parse } from "hono/utils/cookie"
import * as v from "valibot"

import { getDb, schema } from "../db/index.js"
import { selectOne } from "../db/select-one.js"
import type { AppBindings } from "../env.js"
import {
  createSignedToken,
  verifySignedToken,
  type ExpiringTokenPayload,
} from "../security/signed-token.js"

const SESSION_COOKIE_NAME = "bundle_session"
const OAUTH_STATE_COOKIE_NAME = "bundle_oauth_state"
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14
const OAUTH_STATE_TTL_SECONDS = 60 * 10
const userSessionPayloadSchema = v.object({
  exp: v.number(),
  githubUserId: v.number(),
  kind: v.literal("user-session"),
  login: v.string(),
  userId: v.string(),
})
const oauthStatePayloadSchema = v.object({
  exp: v.number(),
  kind: v.literal("oauth-state"),
  nonce: v.string(),
  redirectTo: v.string(),
})

export type UserSessionPayload = v.InferOutput<typeof userSessionPayloadSchema> &
  ExpiringTokenPayload

export type OAuthStatePayload = v.InferOutput<typeof oauthStatePayloadSchema> & ExpiringTokenPayload

export async function createSessionSetCookieHeader(
  env: Pick<AppBindings, "SESSION_SIGNING_SECRET">,
  payload: Omit<UserSessionPayload, "exp" | "kind">,
) {
  const token = await createSignedToken(
    {
      ...payload,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
      kind: "user-session",
    },
    requireSessionSecret(env),
  )

  return generateCookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
    sameSite: "Lax",
    secure: true,
  })
}

export function createClearSessionSetCookieHeader() {
  return generateCookie(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "Lax",
    secure: true,
  })
}

export async function createOAuthStateSetCookieHeader(
  env: Pick<AppBindings, "SESSION_SIGNING_SECRET">,
  payload: Omit<OAuthStatePayload, "exp" | "kind">,
) {
  const token = await createSignedToken(
    {
      ...payload,
      exp: Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS,
      kind: "oauth-state",
    },
    requireSessionSecret(env),
  )

  return generateCookie(OAUTH_STATE_COOKIE_NAME, token, {
    httpOnly: true,
    maxAge: OAUTH_STATE_TTL_SECONDS,
    path: "/",
    sameSite: "Lax",
    secure: true,
  })
}

export function createClearOAuthStateSetCookieHeader() {
  return generateCookie(OAUTH_STATE_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "Lax",
    secure: true,
  })
}

export async function readOAuthStateFromRequest(
  env: Pick<AppBindings, "SESSION_SIGNING_SECRET">,
  request: Request,
) {
  const token = readRequestCookie(request, OAUTH_STATE_COOKIE_NAME)

  return token
    ? verifySignedToken(token, requireSessionSecret(env), "oauth-state", oauthStatePayloadSchema)
    : null
}

export async function readSessionFromRequest(
  env: Pick<AppBindings, "SESSION_SIGNING_SECRET">,
  request: Request,
) {
  const token = readRequestCookie(request, SESSION_COOKIE_NAME)

  return token
    ? verifySignedToken(token, requireSessionSecret(env), "user-session", userSessionPayloadSchema)
    : null
}

export async function getCurrentUser(env: AppBindings, request: Request) {
  const session = await readSessionFromRequest(env, request)

  if (!session) {
    return null
  }

  return selectOne(
    getDb(env).select().from(schema.users).where(eq(schema.users.id, session.userId)).limit(1),
  )
}

export async function requireUser(env: AppBindings, request: Request) {
  const user = await getCurrentUser(env, request)

  if (!user) {
    throw new AuthRequiredError()
  }

  return user
}

export class AuthRequiredError extends Error {
  constructor() {
    super("Authentication is required.")
    this.name = "AuthRequiredError"
  }
}

function requireSessionSecret(env: Pick<AppBindings, "SESSION_SIGNING_SECRET">) {
  if (!env.SESSION_SIGNING_SECRET) {
    throw new Error("SESSION_SIGNING_SECRET is required for authenticated routes.")
  }

  return env.SESSION_SIGNING_SECRET
}

function readRequestCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie")

  return cookieHeader ? (parse(cookieHeader)[name] ?? null) : null
}
