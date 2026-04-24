import * as githubApi from "../github-api.js"

export function classifyPublishError(error: unknown) {
  if (error instanceof githubApi.GithubApiError && !error.retryable) {
    return new TerminalPublishGithubError(error.message)
  }

  return error instanceof Error ? error : new Error("GitHub publication failed.")
}

export function safeParseJson(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export class TerminalPublishGithubError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TerminalPublishGithubError"
  }
}
