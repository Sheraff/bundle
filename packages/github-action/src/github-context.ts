import fs from "node:fs/promises"

import {
  gitShaSchema,
  githubOwnerSchema,
  githubRepoNameSchema,
  nonEmptyStringSchema,
  positiveIntegerSchema,
} from "@workspace/contracts/shared"
import {
  type GitContext,
  type PullRequestContext,
  type RepositoryContext,
} from "@workspace/contracts/upload-envelope"
import * as v from "valibot"

import {
  formatIssues,
  normalizeRequiredInput,
  normalizeTrimmedInput,
  parsePositiveInteger,
} from "./parsing.js"

const ACTION_VERSION = "0.0.0"

const githubEnvironmentSchema = v.strictObject({
  GITHUB_ACTION_REF: v.optional(nonEmptyStringSchema),
  GITHUB_EVENT_NAME: nonEmptyStringSchema,
  GITHUB_EVENT_PATH: nonEmptyStringSchema,
  GITHUB_JOB: v.optional(nonEmptyStringSchema),
  GITHUB_REF_NAME: v.optional(nonEmptyStringSchema),
  GITHUB_REPOSITORY: v.optional(nonEmptyStringSchema),
  GITHUB_REPOSITORY_ID: v.optional(nonEmptyStringSchema),
  GITHUB_RUN_ATTEMPT: v.optional(nonEmptyStringSchema),
  GITHUB_RUN_ID: nonEmptyStringSchema,
  GITHUB_SHA: gitShaSchema,
})

const repositoryNamePartsSchema = v.strictObject({
  owner: githubOwnerSchema,
  name: githubRepoNameSchema,
})

const pullRequestContextSchema = v.strictObject({
  number: positiveIntegerSchema,
  baseSha: gitShaSchema,
  baseRef: nonEmptyStringSchema,
  headSha: gitShaSchema,
  headRef: nonEmptyStringSchema,
})
const githubEventPayloadSchema = v.object({
  pull_request: v.optional(
    v.object({
      base: v.optional(
        v.object({
          ref: v.optional(v.unknown()),
          sha: v.optional(v.unknown()),
        }),
      ),
      head: v.optional(
        v.object({
          ref: v.optional(v.unknown()),
          sha: v.optional(v.unknown()),
        }),
      ),
      number: v.optional(v.unknown()),
    }),
  ),
  ref: v.optional(v.unknown()),
  repository: v.optional(
    v.object({
      full_name: v.optional(v.unknown()),
      id: v.optional(v.unknown()),
      name: v.optional(v.unknown()),
      owner: v.optional(
        v.object({
          login: v.optional(v.unknown()),
        }),
      ),
    }),
  ),
})

type GithubEventPayload = v.InferOutput<typeof githubEventPayloadSchema>

interface GithubCiContext {
  actionVersion?: string
  job?: string
  provider: "github-actions"
  workflowRunAttempt?: number
  workflowRunId: string
}

export interface GithubActionContext {
  ci: GithubCiContext
  git: GitContext
  pullRequest?: PullRequestContext
  repository: RepositoryContext
}

export async function collectGithubContext(
  env: NodeJS.ProcessEnv,
  installationId: number,
): Promise<GithubActionContext> {
  const normalizedEnvironment = normalizeEnvironment(env)
  const environmentResult = v.safeParse(githubEnvironmentSchema, normalizedEnvironment)

  if (!environmentResult.success) {
    throw new Error(`Invalid GitHub runtime environment: ${formatIssues(environmentResult.issues)}`)
  }

  const githubEnvironment = environmentResult.output
  const eventPayload = await readGithubEventPayload(githubEnvironment.GITHUB_EVENT_PATH)

  const githubRepoId =
    parsePositiveInteger(githubEnvironment.GITHUB_REPOSITORY_ID) ??
    parsePositiveInteger(eventPayload.repository?.id)

  if (!githubRepoId) {
    throw new Error("Could not determine GITHUB_REPOSITORY_ID for the current run")
  }

  const repositoryName =
    githubEnvironment.GITHUB_REPOSITORY ??
    normalizeRepositoryNameFromPayload(eventPayload.repository)

  if (!repositoryName) {
    throw new Error("Could not determine the current GitHub repository name")
  }

  const repositoryPartsResult = v.safeParse(
    repositoryNamePartsSchema,
    splitRepositoryName(repositoryName),
  )

  if (!repositoryPartsResult.success) {
    throw new Error(`Invalid GitHub repository name: ${formatIssues(repositoryPartsResult.issues)}`)
  }

  const branch = resolveBranchName(eventPayload, githubEnvironment.GITHUB_REF_NAME)
  const pullRequest = resolvePullRequestContext(eventPayload)

  return {
    ci: {
      provider: "github-actions",
      workflowRunId: githubEnvironment.GITHUB_RUN_ID,
      workflowRunAttempt: parsePositiveInteger(githubEnvironment.GITHUB_RUN_ATTEMPT) ?? undefined,
      job: githubEnvironment.GITHUB_JOB,
      actionVersion: githubEnvironment.GITHUB_ACTION_REF ?? ACTION_VERSION,
    },
    git: {
      commitSha: githubEnvironment.GITHUB_SHA,
      branch,
    },
    ...(pullRequest ? { pullRequest } : {}),
    repository: {
      githubRepoId,
      owner: repositoryPartsResult.output.owner,
      name: repositoryPartsResult.output.name,
      installationId,
    },
  }
}

async function readGithubEventPayload(eventPath: string): Promise<GithubEventPayload> {
  let contents: string

  try {
    contents = await fs.readFile(eventPath, "utf8")
  } catch (error) {
    throw new Error(`Could not read the GitHub event payload at ${eventPath}`, {
      cause: error,
    })
  }

  let parsedPayload: unknown

  try {
    parsedPayload = JSON.parse(contents)
  } catch (error) {
    throw new Error(`Could not parse the GitHub event payload at ${eventPath}`, { cause: error })
  }

  const payloadResult = v.safeParse(githubEventPayloadSchema, parsedPayload)

  if (!payloadResult.success) {
    throw new Error(
      `Invalid GitHub event payload at ${eventPath}: ${formatIssues(payloadResult.issues)}`,
    )
  }

  return payloadResult.output
}

function normalizeEnvironment(env: NodeJS.ProcessEnv) {
  return {
    GITHUB_ACTION_REF: normalizeTrimmedInput(env.GITHUB_ACTION_REF),
    GITHUB_EVENT_NAME: normalizeRequiredInput(env.GITHUB_EVENT_NAME),
    GITHUB_EVENT_PATH: normalizeRequiredInput(env.GITHUB_EVENT_PATH),
    GITHUB_JOB: normalizeTrimmedInput(env.GITHUB_JOB),
    GITHUB_REF_NAME: normalizeTrimmedInput(env.GITHUB_REF_NAME),
    GITHUB_REPOSITORY: normalizeTrimmedInput(env.GITHUB_REPOSITORY),
    GITHUB_REPOSITORY_ID: normalizeTrimmedInput(env.GITHUB_REPOSITORY_ID),
    GITHUB_RUN_ATTEMPT: normalizeTrimmedInput(env.GITHUB_RUN_ATTEMPT),
    GITHUB_RUN_ID: normalizeRequiredInput(env.GITHUB_RUN_ID),
    GITHUB_SHA: normalizeRequiredInput(env.GITHUB_SHA),
  }
}

function normalizeRepositoryNameFromPayload(repository: GithubEventPayload["repository"]) {
  if (typeof repository?.full_name === "string") {
    return repository.full_name
  }

  if (typeof repository?.owner?.login === "string" && typeof repository.name === "string") {
    return `${repository.owner.login}/${repository.name}`
  }

  return null
}

function splitRepositoryName(value: string) {
  const [owner, ...nameParts] = value.split("/")
  return {
    owner,
    name: nameParts.join("/"),
  }
}

function resolveBranchName(eventPayload: GithubEventPayload, refName?: string) {
  if (
    typeof eventPayload.pull_request?.head?.ref === "string" &&
    eventPayload.pull_request.head.ref.length > 0
  ) {
    return eventPayload.pull_request.head.ref
  }

  if (refName) {
    return refName
  }

  if (typeof eventPayload.ref === "string" && eventPayload.ref.length > 0) {
    return eventPayload.ref.replace(/^refs\/heads\//, "")
  }

  throw new Error("Could not determine the current Git branch name")
}

function resolvePullRequestContext(eventPayload: GithubEventPayload) {
  const pullRequest = eventPayload.pull_request

  if (!pullRequest) {
    return undefined
  }

  const result = v.safeParse(pullRequestContextSchema, {
    number: pullRequest.number,
    baseSha: pullRequest.base?.sha,
    baseRef: pullRequest.base?.ref,
    headSha: pullRequest.head?.sha,
    headRef: pullRequest.head?.ref,
  })

  if (!result.success) {
    throw new Error(
      `Invalid pull request context in GitHub event payload: ${formatIssues(result.issues)}`,
    )
  }

  return result.output
}
