import {
  gitShaSchema,
  nonEmptyStringSchema,
  positiveIntegerSchema,
} from "@workspace/contracts/shared"
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose"
import * as v from "valibot"

import type { AppBindings } from "../env.js"
import { formatIssues } from "../shared/format-issues.js"

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com"
const GITHUB_OIDC_JWKS_URL = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`

const oidcHeaderSchema = v.object({
  alg: v.literal("RS256"),
  kid: nonEmptyStringSchema,
})

const oidcClaimsSchema = v.object({
  aud: v.union([nonEmptyStringSchema, v.array(nonEmptyStringSchema)]),
  exp: positiveIntegerSchema,
  iat: positiveIntegerSchema,
  iss: v.literal(GITHUB_OIDC_ISSUER),
  repository: nonEmptyStringSchema,
  repository_id: nonEmptyStringSchema,
  repository_visibility: v.literal("public"),
  run_id: nonEmptyStringSchema,
  run_attempt: v.optional(nonEmptyStringSchema),
  sha: gitShaSchema,
})

export interface GithubActionsOidcClaims {
  commitSha: string
  owner: string
  repositoryId: number
  repositoryName: string
  runAttempt?: number
  runId: string
}

export async function verifyGithubActionsOidcToken(
  env: Pick<AppBindings, "GITHUB_OIDC_AUDIENCE" | "PUBLIC_APP_ORIGIN">,
  token: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<GithubActionsOidcClaims> {
  const expectedAudience = env.GITHUB_OIDC_AUDIENCE ?? env.PUBLIC_APP_ORIGIN
  let verifiedToken: Awaited<ReturnType<typeof jwtVerify>>

  try {
    verifiedToken = await jwtVerify(
      token,
      createRemoteJWKSet(new URL(GITHUB_OIDC_JWKS_URL), {
        [customFetch]: fetchImplementation,
      }),
      {
        algorithms: ["RS256"],
        audience: expectedAudience,
        issuer: GITHUB_OIDC_ISSUER,
      },
    )
  } catch {
    throw new GithubOidcVerificationError("The OIDC token is invalid.")
  }

  const headerResult = v.safeParse(oidcHeaderSchema, verifiedToken.protectedHeader)

  if (!headerResult.success) {
    throw new GithubOidcVerificationError(
      `Invalid OIDC token header: ${formatIssues(headerResult.issues)}`,
    )
  }

  const claimsResult = v.safeParse(oidcClaimsSchema, verifiedToken.payload)

  if (!claimsResult.success) {
    throw new GithubOidcVerificationError(
      `Invalid OIDC token claims: ${formatIssues(claimsResult.issues)}`,
    )
  }

  const claims = claimsResult.output
  const [owner, ...repositoryNameParts] = claims.repository.split("/")
  const repositoryName = repositoryNameParts.join("/")
  const repositoryId = Number.parseInt(claims.repository_id, 10)
  const runAttempt = claims.run_attempt ? Number.parseInt(claims.run_attempt, 10) : undefined

  if (!owner || !repositoryName || !Number.isInteger(repositoryId) || repositoryId <= 0) {
    throw new GithubOidcVerificationError("The OIDC token repository claims are invalid.")
  }

  if (runAttempt !== undefined && (!Number.isInteger(runAttempt) || runAttempt <= 0)) {
    throw new GithubOidcVerificationError("The OIDC token run attempt claim is invalid.")
  }

  return {
    commitSha: claims.sha,
    owner,
    repositoryId,
    repositoryName,
    runAttempt,
    runId: claims.run_id,
  }
}

export class GithubOidcVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GithubOidcVerificationError"
  }
}
