import {
  gitShaSchema,
  nonEmptyStringSchema,
  positiveIntegerSchema,
  type UploadScenarioRunEnvelopeV1,
  ulidSchema,
} from "@workspace/contracts"
import { and, eq, isNull } from "drizzle-orm"
import * as v from "valibot"

import { getDb, schema } from "../db/index.js"
import { selectOne } from "../db/select-one.js"
import type { AppBindings } from "../env.js"
import {
  createSignedToken,
  verifySignedToken,
  type ExpiringTokenPayload,
} from "../security/signed-token.js"

export const UPLOAD_TOKEN_TTL_SECONDS = 60 * 10
const uploadTokenPayloadSchema = v.object({
  commitSha: gitShaSchema,
  exp: positiveIntegerSchema,
  githubRepoId: positiveIntegerSchema,
  installationId: positiveIntegerSchema,
  kind: v.literal("github-actions-upload"),
  owner: nonEmptyStringSchema,
  repositoryId: ulidSchema,
  repositoryName: nonEmptyStringSchema,
  runAttempt: v.optional(positiveIntegerSchema),
  runId: nonEmptyStringSchema,
})

export type UploadTokenPayload = v.InferOutput<typeof uploadTokenPayloadSchema> &
  ExpiringTokenPayload

export async function createUploadToken(
  env: Pick<AppBindings, "UPLOAD_TOKEN_SIGNING_SECRET">,
  payload: Omit<UploadTokenPayload, "exp" | "kind">,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  return createSignedToken(
    {
      ...payload,
      exp: nowSeconds + UPLOAD_TOKEN_TTL_SECONDS,
      kind: "github-actions-upload",
    },
    requireUploadTokenSecret(env),
  )
}

export async function verifyUploadToken(
  env: Pick<AppBindings, "UPLOAD_TOKEN_SIGNING_SECRET">,
  token: string,
) {
  return verifySignedToken(
    token,
    requireUploadTokenSecret(env),
    "github-actions-upload",
    uploadTokenPayloadSchema,
  )
}

export async function verifyUploadTokenForEnvelope(
  env: AppBindings,
  token: string,
  envelope: UploadScenarioRunEnvelopeV1,
) {
  const payload = await verifyUploadToken(env, token)

  if (!payload) {
    return {
      ok: false as const,
      code: "invalid_upload_token",
      message: "The upload token is invalid or expired.",
    }
  }

  if (
    payload.githubRepoId !== envelope.repository.githubRepoId ||
    payload.owner !== envelope.repository.owner ||
    payload.repositoryName !== envelope.repository.name ||
    payload.installationId !== envelope.repository.installationId ||
    payload.commitSha.toLowerCase() !== envelope.git.commitSha.toLowerCase() ||
    payload.runId !== envelope.ci.workflowRunId ||
    (payload.runAttempt ?? null) !== (envelope.ci.workflowRunAttempt ?? null)
  ) {
    return {
      ok: false as const,
      code: "upload_token_mismatch",
      message: "The upload token does not match this upload envelope.",
    }
  }

  const repository = await selectOne(
    getDb(env)
      .select({
        id: schema.repositories.id,
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
          eq(schema.repositories.id, payload.repositoryId),
          eq(schema.repositories.githubRepoId, envelope.repository.githubRepoId),
          eq(schema.repositories.owner, payload.owner),
          eq(schema.repositories.name, payload.repositoryName),
          eq(schema.repositories.installationId, payload.installationId),
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
    return {
      ok: false as const,
      code: "repository_not_enabled",
      message: "This repository is not enabled for uploads.",
    }
  }

  return {
    ok: true as const,
    payload,
  }
}

function requireUploadTokenSecret(env: Pick<AppBindings, "UPLOAD_TOKEN_SIGNING_SECRET">) {
  if (!env.UPLOAD_TOKEN_SIGNING_SECRET) {
    throw new Error("UPLOAD_TOKEN_SIGNING_SECRET is required for upload authentication.")
  }

  return env.UPLOAD_TOKEN_SIGNING_SECRET
}
