import { notFound, redirect } from "@tanstack/react-router"
import { getRequest } from "@tanstack/react-start/server"
import * as v from "valibot"

import { requireUser } from "../auth/session.js"
import { getDb, schema } from "../db/index.js"
import { repositoryRouteMatch } from "../db/repository-route-match.js"
import { selectOne } from "../db/select-one.js"
import type { AppBindings } from "../env.js"
import { requireRepositoryAdminForUser } from "../github/onboarding.js"
import { repositoryAdminParamsSchema } from "./repository-admin-schema.js"

export async function requireRepositoryAdminRoute(
  env: AppBindings,
  params: v.InferOutput<typeof repositoryAdminParamsSchema>,
) {
  const request = getRequest()
  let user: Awaited<ReturnType<typeof requireUser>>

  try {
    user = await requireUser(env, request)
  } catch {
    const url = new URL(request.url)
    throw redirect({
      href: `/api/v1/auth/github/start?redirect_to=${encodeURIComponent(`${url.pathname}${url.search}`)}`,
      statusCode: 302,
    })
  }

  const repository = await selectOne(
    getDb(env).select().from(schema.repositories).where(repositoryRouteMatch(params.owner, params.repo)).limit(1),
  )

  if (!repository || repository.enabled !== 1) throw notFound()

  try {
    await requireRepositoryAdminForUser(env, user, repository.owner, repository.name)
  } catch {
    throw notFound()
  }

  return { repository, user }
}
