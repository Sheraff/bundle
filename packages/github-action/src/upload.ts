import { githubActionsUploadTokenResponseV1Schema } from "@workspace/contracts/upload-auth"
import { nonEmptyStringSchema } from "@workspace/contracts/shared"
import { type UploadScenarioRunEnvelopeV1 } from "@workspace/contracts/upload-envelope"
import * as core from "@actions/core"
import * as v from "valibot"

import { formatIssues, normalizeTrimmedInput } from "./parsing.js"

const uploadEnvironmentSchema = v.strictObject({
  BUNDLE_API_ORIGIN: nonEmptyStringSchema,
  BUNDLE_OIDC_AUDIENCE: v.optional(nonEmptyStringSchema),
})

export interface UploadRuntimeConfig {
  apiOrigin: string
  oidcAudience: string
}

export interface ScenarioRunUploadConfig {
  apiOrigin: string
  uploadToken: string
}

export interface UploadRuntimeCredentials {
  installationId: number
  token: string
}

export async function uploadScenarioRunEnvelope(
  envelope: UploadScenarioRunEnvelopeV1,
  config: ScenarioRunUploadConfig,
  fetchImplementation: typeof fetch = fetch,
) {
  const uploadUrl = new URL(
    "/api/v1/uploads/scenario-runs",
    ensureTrailingSlash(config.apiOrigin),
  ).toString()
  const response = await fetchImplementation(uploadUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.uploadToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(envelope),
  })

  if (!response.ok) {
    const responseBody = await response.text()
    const responseSuffix = responseBody ? `: ${truncate(responseBody)}` : ""
    throw new Error(`Scenario-run upload failed with status ${response.status}${responseSuffix}`)
  }

  return {
    status: response.status,
    uploadUrl,
  }
}

export async function fetchUploadRuntimeCredentials(
  config: UploadRuntimeConfig,
  fetchImplementation: typeof fetch = fetch,
): Promise<UploadRuntimeCredentials> {
  const oidcToken = await core.getIDToken(config.oidcAudience)
  const exchangeUrl = new URL(
    "/api/v1/uploads/github-actions/token",
    ensureTrailingSlash(config.apiOrigin),
  ).toString()
  const response = await fetchImplementation(exchangeUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ token: oidcToken }),
  })

  if (!response.ok) {
    const responseBody = await response.text()
    const responseSuffix = responseBody ? `: ${truncate(responseBody)}` : ""
    throw new Error(`Upload token exchange failed with status ${response.status}${responseSuffix}`)
  }

  const responseBody = await response.json()
  const responseResult = v.safeParse(githubActionsUploadTokenResponseV1Schema, responseBody)

  if (!responseResult.success) {
    throw new Error(
      `Invalid upload token exchange response: ${formatIssues(responseResult.issues)}`,
    )
  }

  return {
    installationId: responseResult.output.installationId,
    token: responseResult.output.token,
  }
}

export function parseUploadRuntimeConfig(env: NodeJS.ProcessEnv): UploadRuntimeConfig {
  const result = v.safeParse(uploadEnvironmentSchema, {
    BUNDLE_API_ORIGIN: normalizeTrimmedInput(env.BUNDLE_API_ORIGIN),
    BUNDLE_OIDC_AUDIENCE: normalizeTrimmedInput(env.BUNDLE_OIDC_AUDIENCE),
  })

  if (!result.success) {
    throw new Error(`Invalid upload runtime environment: ${formatIssues(result.issues)}`)
  }

  let apiOrigin: string

  try {
    apiOrigin = new URL(result.output.BUNDLE_API_ORIGIN).toString()
  } catch (error) {
    throw new Error(`Invalid BUNDLE_API_ORIGIN: ${result.output.BUNDLE_API_ORIGIN}`, {
      cause: error,
    })
  }

  return {
    apiOrigin,
    oidcAudience: result.output.BUNDLE_OIDC_AUDIENCE ?? removeTrailingSlash(apiOrigin),
  }
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`
}

function removeTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value
}

function truncate(value: string) {
  return value.length <= 500 ? value : `${value.slice(0, 497)}...`
}
