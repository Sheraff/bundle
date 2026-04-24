import {
  githubActionsUploadTokenRequestV1Schema,
  githubActionsUploadTokenResponseV1Schema,
} from "@workspace/contracts"
import { and, eq, isNull } from "drizzle-orm"
import type { Context, Hono } from "hono"
import * as v from "valibot"

import { verifyGithubActionsOidcToken, GithubOidcVerificationError } from "../auth/github-oidc.js"
import { getDb, schema } from "../db/index.js"
import { selectOne } from "../db/select-one.js"
import type { AppEnv } from "../env.js"
import { formatIssues } from "../shared/format-issues.js"
import { createUploadToken, UPLOAD_TOKEN_TTL_SECONDS } from "../uploads/upload-token.js"

export function registerUploadAuthRoutes(app: Hono<AppEnv>) {
  app.post("/api/v1/uploads/github-actions/token", async (c) => {
    const rawRequestBody = await c.req.text()
    const parsedRequestBody = parseJsonBody(rawRequestBody)

    if (!parsedRequestBody.success) {
      return jsonError(c, 400, "invalid_json", "The request body must be valid JSON.")
    }

    const requestResult = v.safeParse(
      githubActionsUploadTokenRequestV1Schema,
      parsedRequestBody.output,
    )

    if (!requestResult.success) {
      return jsonError(c, 400, "invalid_token_request", formatIssues(requestResult.issues))
    }

    let claims: Awaited<ReturnType<typeof verifyGithubActionsOidcToken>>

    try {
      claims = await verifyGithubActionsOidcToken(c.env, requestResult.output.token)
    } catch (error) {
      if (error instanceof GithubOidcVerificationError) {
        return jsonError(c, 401, "invalid_oidc_token", error.message)
      }

      throw error
    }

    const repository = await selectOne(
      getDb(c.env)
        .select({
          id: schema.repositories.id,
          githubRepoId: schema.repositories.githubRepoId,
          installationId: schema.repositories.installationId,
          enabled: schema.repositories.enabled,
          visibility: schema.repositories.visibility,
          deletedAt: schema.repositories.deletedAt,
          disabledAt: schema.repositories.disabledAt,
          installationDeletedAt: schema.githubAppInstallations.deletedAt,
          installationSuspendedAt: schema.githubAppInstallations.suspendedAt,
        })
        .from(schema.repositories)
        .leftJoin(
          schema.githubAppInstallations,
          eq(schema.githubAppInstallations.installationId, schema.repositories.installationId),
        )
        .where(
          and(
            eq(schema.repositories.githubRepoId, claims.repositoryId),
            eq(schema.repositories.owner, claims.owner),
            eq(schema.repositories.name, claims.repositoryName),
            isNull(schema.repositories.deletedAt),
          ),
        )
        .limit(1),
    )

    if (
      !repository ||
      repository.enabled !== 1 ||
      repository.disabledAt ||
      repository.visibility !== "public" ||
      repository.installationDeletedAt ||
      repository.installationSuspendedAt
    ) {
      return jsonError(c, 403, "repository_not_enabled", "This repository is not enabled.")
    }

    const token = await createUploadToken(c.env, {
      commitSha: claims.commitSha,
      githubRepoId: claims.repositoryId,
      installationId: repository.installationId,
      owner: claims.owner,
      repositoryId: repository.id,
      repositoryName: claims.repositoryName,
      runAttempt: claims.runAttempt,
      runId: claims.runId,
    })
    const expiresAt = new Date(Date.now() + UPLOAD_TOKEN_TTL_SECONDS * 1000).toISOString()
    const responseResult = v.safeParse(githubActionsUploadTokenResponseV1Schema, {
      expiresAt,
      installationId: repository.installationId,
      repositoryId: repository.id,
      token,
    })

    if (!responseResult.success) {
      throw new Error(
        `Generated upload token response is invalid: ${formatIssues(responseResult.issues)}`,
      )
    }

    return c.json(responseResult.output)
  })
}

function parseJsonBody(rawRequestBody: string) {
  try {
    return {
      success: true as const,
      output: JSON.parse(rawRequestBody),
    }
  } catch {
    return {
      success: false as const,
    }
  }
}

function jsonError(
  c: Context<AppEnv>,
  status: 400 | 401 | 403 | 500,
  code: string,
  message: string,
) {
  return c.json(
    {
      error: {
        code,
        message,
      },
    },
    status,
  )
}
