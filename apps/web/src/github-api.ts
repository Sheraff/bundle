import type { AppBindings } from "./env.js"

const GITHUB_API_ORIGIN = "https://api.github.com"
const GITHUB_API_VERSION = "2022-11-28"
const GITHUB_USER_AGENT = "bundle-web"
const textEncoder = new TextEncoder()

interface GithubIssueCommentResponse {
  id: number
  node_id: string
  html_url: string
  body: string
}

interface GithubCheckRunResponse {
  id: number
  node_id: string
  html_url: string
}

interface GithubAccessTokenResponse {
  token: string
}

interface GithubRequestOptions {
  accessToken?: string
  body?: string
  method: string
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

let cachedPrivateKeyPromise: Promise<CryptoKey> | null = null
let cachedPrivateKeyValue: string | null = null

export async function createGithubInstallationAccessToken(
  env: Pick<AppBindings, "GITHUB_APP_ID" | "GITHUB_APP_PRIVATE_KEY">,
  installationId: number,
) {
  const appJwt = await createGithubAppJwt(env)
  const response = await requestGithub<GithubAccessTokenResponse>({
    body: "{}",
    method: "POST",
    url: `${GITHUB_API_ORIGIN}/app/installations/${installationId}/access_tokens`,
    accessToken: appJwt,
  })

  return response.token
}

export async function upsertGithubPullRequestComment(
  options: UpsertGithubPullRequestCommentOptions,
): Promise<GithubIssueCommentPublication> {
  const updateExistingComment = async (commentId: string) => {
    const response = await requestGithub<GithubIssueCommentResponse>({
      accessToken: options.accessToken,
      body: JSON.stringify({ body: options.body }),
      method: "PATCH",
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

  const comments = await requestGithub<GithubIssueCommentResponse[]>({
    accessToken: options.accessToken,
    method: "GET",
    url: `${GITHUB_API_ORIGIN}/repos/${options.owner}/${options.repository}/issues/${options.pullRequestNumber}/comments?per_page=100`,
  })
  const markedComment = comments.find((comment) => comment.body.includes(options.marker))

  if (markedComment) {
    return updateExistingComment(String(markedComment.id))
  }

  const createdComment = await requestGithub<GithubIssueCommentResponse>({
    accessToken: options.accessToken,
    body: JSON.stringify({ body: options.body }),
    method: "POST",
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
    const response = await requestGithub<GithubCheckRunResponse>({
      accessToken: options.accessToken,
      body: JSON.stringify(requestBody),
      method: "PATCH",
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

  const createdCheckRun = await requestGithub<GithubCheckRunResponse>({
    accessToken: options.accessToken,
    body: JSON.stringify({
      ...requestBody,
      head_sha: options.headSha,
      name: options.name,
    }),
    method: "POST",
    url: `${GITHUB_API_ORIGIN}/repos/${options.owner}/${options.repository}/check-runs`,
  })

  return {
    id: String(createdCheckRun.id),
    nodeId: createdCheckRun.node_id,
    url: createdCheckRun.html_url,
  }
}

async function requestGithub<T>({
  accessToken,
  body,
  method,
  url,
}: GithubRequestOptions): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      "user-agent": GITHUB_USER_AGENT,
      "x-github-api-version": GITHUB_API_VERSION,
    },
    ...(body ? { body } : {}),
  })

  const responseText = await response.text()
  const responseJson = responseText.length > 0 ? safeParseJson(responseText) : null

  if (!response.ok) {
    const message = extractGithubErrorMessage(response, responseJson)
    throw new GithubApiError(
      `github_api_${response.status}`,
      message,
      response.status,
      isRetryableGithubResponse(response),
    )
  }

  if (responseJson === null) {
    throw new GithubApiError(
      "github_empty_response",
      `GitHub returned an empty response for ${method} ${url}.`,
      response.status,
      false,
    )
  }

  return responseJson as T
}

async function createGithubAppJwt(
  env: Pick<AppBindings, "GITHUB_APP_ID" | "GITHUB_APP_PRIVATE_KEY">,
) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64UrlEncodeJson({ alg: "RS256", typ: "JWT" })
  const payload = base64UrlEncodeJson({
    exp: now + 9 * 60,
    iat: now - 60,
    iss: env.GITHUB_APP_ID,
  })
  const signingInput = `${header}.${payload}`
  const privateKey = await importGithubAppPrivateKey(env.GITHUB_APP_PRIVATE_KEY)
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    textEncoder.encode(signingInput),
  )

  return `${signingInput}.${base64UrlEncodeBytes(new Uint8Array(signature))}`
}

async function importGithubAppPrivateKey(privateKeyPem: string) {
  if (cachedPrivateKeyPromise && cachedPrivateKeyValue === privateKeyPem) {
    return cachedPrivateKeyPromise
  }

  cachedPrivateKeyValue = privateKeyPem
  cachedPrivateKeyPromise = crypto.subtle.importKey(
    "pkcs8",
    decodeGithubPem(privateKeyPem),
    {
      hash: "SHA-256",
      name: "RSASSA-PKCS1-v1_5",
    },
    false,
    ["sign"],
  )

  return cachedPrivateKeyPromise
}

function decodeGithubPem(pem: string) {
  const base64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replaceAll(/\s+/g, "")

  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
}

function base64UrlEncodeJson(value: unknown) {
  return base64UrlEncodeBytes(textEncoder.encode(JSON.stringify(value)))
}

function base64UrlEncodeBytes(bytes: Uint8Array) {
  const base64 = btoa(String.fromCharCode(...bytes))
  return base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "")
}

function extractGithubErrorMessage(response: Response, responseJson: unknown) {
  if (
    typeof responseJson === "object" &&
    responseJson !== null &&
    "message" in responseJson &&
    typeof responseJson.message === "string"
  ) {
    return responseJson.message
  }

  return `GitHub API request failed with ${response.status} ${response.statusText}.`
}

function isRetryableGithubResponse(response: Response) {
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    return true
  }

  return (
    response.status === 403 &&
    Boolean(
      response.headers.get("retry-after") || response.headers.get("x-ratelimit-remaining") === "0",
    )
  )
}

function safeParseJson(text: string) {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}
