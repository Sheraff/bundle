import { createAppAuth } from "@octokit/auth-app"
import {
  exchangeWebFlowCode,
  getWebFlowAuthorizationUrl,
  refreshToken as refreshGithubAppUserToken,
} from "@octokit/oauth-methods"
import { request as octokitRequest } from "@octokit/request"
import { nonEmptyStringSchema, positiveIntegerSchema } from "@workspace/contracts"
import * as v from "valibot"

import type { AppBindings } from "./env.js"
import { formatIssues } from "./shared/format-issues.js"

const GITHUB_API_ORIGIN = "https://api.github.com"
const GITHUB_API_VERSION = "2022-11-28"
const GITHUB_USER_AGENT = "bundle-web"

const githubPermissionsSchema = v.object({
  admin: v.optional(v.boolean()),
  pull: v.optional(v.boolean()),
  push: v.optional(v.boolean()),
})
const githubAccountSchema = v.object({
  avatar_url: v.optional(v.nullable(v.string())),
  id: positiveIntegerSchema,
  login: nonEmptyStringSchema,
  type: v.optional(nonEmptyStringSchema),
})
const githubIssueCommentResponseSchema = v.object({
  body: v.string(),
  html_url: nonEmptyStringSchema,
  id: positiveIntegerSchema,
  node_id: nonEmptyStringSchema,
})
const githubCheckRunResponseSchema = v.object({
  html_url: nonEmptyStringSchema,
  id: positiveIntegerSchema,
  node_id: nonEmptyStringSchema,
})
const githubAuthenticatedUserResponseSchema = v.object({
  avatar_url: v.optional(v.nullable(v.string())),
  id: positiveIntegerSchema,
  login: nonEmptyStringSchema,
  name: v.optional(v.nullable(v.string())),
})
const githubUserInstallationsResponseSchema = v.object({
  installations: v.array(
    v.object({
      account: v.optional(v.nullable(githubAccountSchema)),
      id: positiveIntegerSchema,
      permissions: v.optional(v.record(v.string(), v.unknown())),
      suspended_at: v.optional(v.nullable(v.string())),
      target_type: v.optional(nonEmptyStringSchema),
    }),
  ),
})
const githubInstallationRepositoriesResponseSchema = v.object({
  repositories: v.array(
    v.object({
      id: positiveIntegerSchema,
      name: nonEmptyStringSchema,
      owner: githubAccountSchema,
      permissions: v.optional(githubPermissionsSchema),
      private: v.boolean(),
    }),
  ),
})
const githubRepositoryPermissionResponseSchema = v.object({
  permission: nonEmptyStringSchema,
})

interface GithubRequestOptions<TSchema extends v.GenericSchema> {
  accessToken?: string
  body?: unknown
  method: string
  responseSchema: TSchema
  url: string
}

export interface GithubIssueCommentPublication {
  id: string
  nodeId: string
  url: string
}

export interface GithubCheckRunPublication {
  id: string
  nodeId: string
  url: string
}

export interface GithubCheckRunOutput {
  summary: string
  text: string
  title: string
}

export interface GithubAuthenticatedUser {
  avatarUrl: string | null
  githubUserId: number
  login: string
  name: string | null
}

export interface GithubUserAccessToken {
  accessToken: string
  accessTokenExpiresAt: string | null
  refreshToken: string | null
  refreshTokenExpiresAt: string | null
}

export interface GithubAccountSummary {
  avatarUrl: string | null
  githubAccountId: number
  login: string
  type: string
}

export interface GithubUserInstallation {
  account: GithubAccountSummary
  installationId: number
  permissions: Record<string, unknown>
  suspendedAt: string | null
  targetType: string
}

export interface GithubInstallationRepository {
  githubRepoId: number
  name: string
  owner: GithubAccountSummary
  permissions?: {
    admin?: boolean
    pull?: boolean
    push?: boolean
  }
  private: boolean
}

export interface UpsertGithubPullRequestCommentOptions {
  accessToken: string
  body: string
  marker: string
  owner: string
  publicationId: string | null
  pullRequestNumber: number
  repository: string
}

export interface UpsertGithubCheckRunOptions {
  accessToken: string
  conclusion?: "failure" | "success"
  detailsUrl: string
  externalId: string
  headSha: string
  name: string
  output: GithubCheckRunOutput
  owner: string
  publicationId: string | null
  repository: string
  status: "completed" | "in_progress"
}

export class GithubApiError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly status: number

  constructor(code: string, message: string, status: number, retryable: boolean) {
    super(message)
    this.name = "GithubApiError"
    this.code = code
    this.retryable = retryable
    this.status = status
  }
}

export async function createGithubInstallationAccessToken(
  env: Pick<AppBindings, "GITHUB_APP_ID" | "GITHUB_APP_PRIVATE_KEY">,
  installationId: number,
) {
  const appId = Number.parseInt(env.GITHUB_APP_ID, 10)

  if (!Number.isInteger(appId) || appId <= 0) {
    throw new GithubApiError("github_app_id_invalid", "GITHUB_APP_ID is invalid.", 500, false)
  }

  try {
    const auth = createAppAuth({
      appId,
      privateKey: env.GITHUB_APP_PRIVATE_KEY,
    })
    const installationAuthentication = await auth({
      type: "installation",
      installationId,
    })

    return installationAuthentication.token
  } catch (error) {
    throw normalizeGithubError(error, "github_installation_token_failed")
  }
}

export function createGithubOAuthAuthorizationUrl(
  env: Pick<AppBindings, "GITHUB_APP_CLIENT_ID" | "PUBLIC_APP_ORIGIN">,
  state: string,
) {
  if (!env.GITHUB_APP_CLIENT_ID) {
    throw new GithubApiError(
      "github_oauth_not_configured",
      "GitHub OAuth client credentials are not configured.",
      500,
      false,
    )
  }

  return getWebFlowAuthorizationUrl({
    clientId: env.GITHUB_APP_CLIENT_ID,
    clientType: "github-app",
    redirectUrl: `${env.PUBLIC_APP_ORIGIN}/api/v1/auth/github/callback`,
    request: octokitRequest,
    state,
  }).url
}

export async function exchangeGithubOAuthCode(
  env: Pick<AppBindings, "GITHUB_APP_CLIENT_ID" | "GITHUB_APP_CLIENT_SECRET" | "PUBLIC_APP_ORIGIN">,
  code: string,
) {
  if (!env.GITHUB_APP_CLIENT_ID || !env.GITHUB_APP_CLIENT_SECRET) {
    throw new GithubApiError(
      "github_oauth_not_configured",
      "GitHub OAuth client credentials are not configured.",
      500,
      false,
    )
  }

  try {
    const response = await exchangeWebFlowCode({
      clientId: env.GITHUB_APP_CLIENT_ID,
      clientSecret: env.GITHUB_APP_CLIENT_SECRET,
      clientType: "github-app",
      code,
      redirectUrl: `${env.PUBLIC_APP_ORIGIN}/api/v1/auth/github/callback`,
      request: octokitRequest,
    })

    return normalizeGithubUserAccessToken(response.authentication)
  } catch (error) {
    throw normalizeGithubError(error, "github_oauth_exchange_failed")
  }
}

export async function refreshGithubOAuthToken(
  env: Pick<AppBindings, "GITHUB_APP_CLIENT_ID" | "GITHUB_APP_CLIENT_SECRET">,
  refreshToken: string,
) {
  if (!env.GITHUB_APP_CLIENT_ID || !env.GITHUB_APP_CLIENT_SECRET) {
    throw new GithubApiError(
      "github_oauth_not_configured",
      "GitHub OAuth client credentials are not configured.",
      500,
      false,
    )
  }

  try {
    const response = await refreshGithubAppUserToken({
      clientId: env.GITHUB_APP_CLIENT_ID,
      clientSecret: env.GITHUB_APP_CLIENT_SECRET,
      clientType: "github-app",
      refreshToken,
      request: octokitRequest,
    })

    return normalizeGithubUserAccessToken(response.authentication)
  } catch (error) {
    throw normalizeGithubError(error, "github_oauth_refresh_failed")
  }
}

export async function fetchGithubAuthenticatedUser(accessToken: string) {
  const response = await requestGithub({
    accessToken,
    method: "GET",
    responseSchema: githubAuthenticatedUserResponseSchema,
    url: `${GITHUB_API_ORIGIN}/user`,
  })

  return {
    avatarUrl: response.avatar_url ?? null,
    githubUserId: response.id,
    login: response.login,
    name: response.name ?? null,
  } satisfies GithubAuthenticatedUser
}

export async function listGithubUserInstallations(accessToken: string) {
  const installations: v.InferOutput<
    typeof githubUserInstallationsResponseSchema
  >["installations"] = []
  let url: string | null = `${GITHUB_API_ORIGIN}/user/installations?per_page=100`

  while (url) {
    const page = await requestGithubJson({
      accessToken,
      method: "GET",
      responseSchema: githubUserInstallationsResponseSchema,
      url,
    })

    installations.push(...page.data.installations)
    url = getNextPageUrl(page.headers.link)
  }

  return installations
    .filter((installation) => installation.account?.id && installation.account.login)
    .map((installation) => ({
      account: {
        avatarUrl: installation.account?.avatar_url ?? null,
        githubAccountId: installation.account!.id,
        login: installation.account!.login,
        type: installation.account?.type ?? "User",
      },
      installationId: installation.id,
      permissions: installation.permissions ?? {},
      suspendedAt: installation.suspended_at ?? null,
      targetType: installation.target_type ?? "User",
    }))
}

export async function listGithubUserInstallationRepositories(
  accessToken: string,
  installationId: number,
) {
  const repositories: v.InferOutput<
    typeof githubInstallationRepositoriesResponseSchema
  >["repositories"] = []
  let url: string | null =
    `${GITHUB_API_ORIGIN}/user/installations/${installationId}/repositories?per_page=100`

  while (url) {
    const page = await requestGithubJson({
      accessToken,
      method: "GET",
      responseSchema: githubInstallationRepositoriesResponseSchema,
      url,
    })

    repositories.push(...page.data.repositories)
    url = getNextPageUrl(page.headers.link)
  }

  return repositories.map((repository) => ({
    githubRepoId: repository.id,
    name: repository.name,
    owner: {
      avatarUrl: repository.owner.avatar_url ?? null,
      githubAccountId: repository.owner.id,
      login: repository.owner.login,
      type: repository.owner.type ?? "User",
    },
    permissions: repository.permissions,
    private: repository.private,
  }))
}

export async function fetchGithubRepositoryPermission(
  accessToken: string,
  owner: string,
  repository: string,
  username: string,
) {
  const response = await requestGithub({
    accessToken,
    method: "GET",
    responseSchema: githubRepositoryPermissionResponseSchema,
    url: `${GITHUB_API_ORIGIN}/repos/${owner}/${repository}/collaborators/${username}/permission`,
  })

  return response.permission
}

export async function upsertGithubPullRequestComment(
  options: UpsertGithubPullRequestCommentOptions,
): Promise<GithubIssueCommentPublication> {
  const updateExistingComment = async (commentId: string) => {
    const response = await requestGithub({
      accessToken: options.accessToken,
      body: { body: options.body },
      method: "PATCH",
      responseSchema: githubIssueCommentResponseSchema,
      url: `${GITHUB_API_ORIGIN}/repos/${options.owner}/${options.repository}/issues/comments/${commentId}`,
    })

    return {
      id: String(response.id),
      nodeId: response.node_id,
      url: response.html_url,
    }
  }

  if (options.publicationId) {
    try {
      return await updateExistingComment(options.publicationId)
    } catch (error) {
      if (!(error instanceof GithubApiError) || error.status !== 404) {
        throw error
      }
    }
  }

  const comments = await requestGithub({
    accessToken: options.accessToken,
    method: "GET",
    responseSchema: v.array(githubIssueCommentResponseSchema),
    url: `${GITHUB_API_ORIGIN}/repos/${options.owner}/${options.repository}/issues/${options.pullRequestNumber}/comments?per_page=100`,
  })
  const markedComment = comments.find((comment) => comment.body.includes(options.marker))

  if (markedComment) {
    return updateExistingComment(String(markedComment.id))
  }

  const createdComment = await requestGithub({
    accessToken: options.accessToken,
    body: { body: options.body },
    method: "POST",
    responseSchema: githubIssueCommentResponseSchema,
    url: `${GITHUB_API_ORIGIN}/repos/${options.owner}/${options.repository}/issues/${options.pullRequestNumber}/comments`,
  })

  return {
    id: String(createdComment.id),
    nodeId: createdComment.node_id,
    url: createdComment.html_url,
  }
}

export async function upsertGithubCheckRun(
  options: UpsertGithubCheckRunOptions,
): Promise<GithubCheckRunPublication> {
  const requestBody = {
    details_url: options.detailsUrl,
    external_id: options.externalId,
    output: options.output,
    status: options.status,
    ...(options.status === "completed" ? { conclusion: options.conclusion ?? "success" } : {}),
  }

  const updateExistingCheckRun = async (checkRunId: string) => {
    const response = await requestGithub({
      accessToken: options.accessToken,
      body: requestBody,
      method: "PATCH",
      responseSchema: githubCheckRunResponseSchema,
      url: `${GITHUB_API_ORIGIN}/repos/${options.owner}/${options.repository}/check-runs/${checkRunId}`,
    })

    return {
      id: String(response.id),
      nodeId: response.node_id,
      url: response.html_url,
    }
  }

  if (options.publicationId) {
    try {
      return await updateExistingCheckRun(options.publicationId)
    } catch (error) {
      if (!(error instanceof GithubApiError) || error.status !== 404) {
        throw error
      }
    }
  }

  const createdCheckRun = await requestGithub({
    accessToken: options.accessToken,
    body: {
      ...requestBody,
      head_sha: options.headSha,
      name: options.name,
    },
    method: "POST",
    responseSchema: githubCheckRunResponseSchema,
    url: `${GITHUB_API_ORIGIN}/repos/${options.owner}/${options.repository}/check-runs`,
  })

  return {
    id: String(createdCheckRun.id),
    nodeId: createdCheckRun.node_id,
    url: createdCheckRun.html_url,
  }
}

async function requestGithub<TSchema extends v.GenericSchema>({
  accessToken,
  body,
  method,
  responseSchema,
  url,
}: GithubRequestOptions<TSchema>): Promise<v.InferOutput<TSchema>> {
  const response = await requestGithubJson({
    accessToken,
    body,
    method,
    responseSchema,
    url,
  })

  return response.data
}

async function requestGithubJson<TSchema extends v.GenericSchema>({
  accessToken,
  body,
  method,
  responseSchema,
  url,
}: GithubRequestOptions<TSchema>): Promise<{
  data: v.InferOutput<TSchema>
  headers: Record<string, string | undefined>
}> {
  let response: {
    data: unknown
    headers: Record<string, string | number | undefined>
    status: number
  }

  try {
    response = await octokitRequest({
      data: body,
      headers: {
        accept: "application/vnd.github+json",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
        "user-agent": GITHUB_USER_AGENT,
        "x-github-api-version": GITHUB_API_VERSION,
      },
      method,
      url,
    })
  } catch (error) {
    const status = isGithubRequestError(error) ? error.status : null

    throw normalizeGithubError(error, `github_api_${status ?? "failed"}`)
  }

  const responseResult = v.safeParse(responseSchema, response.data)

  if (!responseResult.success) {
    throw new GithubApiError(
      "github_invalid_response",
      `GitHub returned an invalid response for ${method} ${url}: ${formatIssues(
        responseResult.issues,
      )}`,
      response.status,
      false,
    )
  }

  return {
    data: responseResult.output,
    headers: normalizeHeaders(response.headers),
  }
}

function normalizeGithubError(error: unknown, fallbackCode: string) {
  if (isGithubRequestError(error)) {
    return new GithubApiError(
      fallbackCode,
      error.message,
      error.status,
      isRetryableGithubStatus(error.status, normalizeHeaders(error.response?.headers ?? {})),
    )
  }

  if (error instanceof Error) {
    return new GithubApiError(fallbackCode, error.message, 500, true)
  }

  return new GithubApiError(fallbackCode, "GitHub API request failed.", 500, true)
}

function normalizeGithubUserAccessToken(authentication: {
  expiresAt?: string
  refreshToken?: string
  refreshTokenExpiresAt?: string
  token: string
}): GithubUserAccessToken {
  return {
    accessToken: authentication.token,
    accessTokenExpiresAt: authentication.expiresAt ?? null,
    refreshToken: authentication.refreshToken ?? null,
    refreshTokenExpiresAt: authentication.refreshTokenExpiresAt ?? null,
  }
}

function isGithubRequestError(error: unknown): error is {
  message: string
  response?: { headers?: Record<string, string | number | undefined> }
  status: number
} {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number" &&
    "message" in error &&
    typeof error.message === "string"
  )
}

function isRetryableGithubStatus(status: number, headers: Record<string, string | undefined>) {
  if (status === 408 || status === 429 || status >= 500) {
    return true
  }

  return (
    status === 403 && Boolean(headers["retry-after"] || headers["x-ratelimit-remaining"] === "0")
  )
}

function normalizeHeaders(headers: Record<string, string | number | undefined>) {
  const output: Record<string, string | undefined> = {}

  for (const [key, value] of Object.entries(headers)) {
    output[key.toLowerCase()] = value === undefined ? undefined : String(value)
  }

  return output
}

function getNextPageUrl(linkHeader: string | null | undefined) {
  if (!linkHeader) {
    return null
  }

  for (const link of linkHeader.split(",")) {
    const [rawUrl, ...rawParameters] = link.split(";").map((part) => part.trim())
    const isNext = rawParameters.some((parameter) => parameter === 'rel="next"')

    if (isNext && rawUrl?.startsWith("<") && rawUrl.endsWith(">")) {
      return rawUrl.slice(1, -1)
    }
  }

  return null
}
