import type { GithubCheckRunOutput } from "../github-api.js"
import { schema } from "../db/index.js"

export type GithubPublicationRow = typeof schema.githubPublications.$inferSelect

export interface CommentPublicationPayload {
  body: string
  marker: string
  payloadHash: string
}

export interface CheckRunPublicationPayload {
  conclusion?: "failure" | "success"
  detailsUrl: string
  externalId: string
  headSha: string
  name: string
  output: GithubCheckRunOutput
  payloadHash: string
  status: "completed" | "in_progress"
}

export const PR_COMMENT_SURFACE = "pr-comment"
export const PR_CHECK_SURFACE = "pr-check"
export const PR_CHECK_NAME = "Chunk Scope Review"
