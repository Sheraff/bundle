import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test"
import { env, exports } from "cloudflare:workers"
import type { UploadScenarioRunEnvelopeV1 } from "@workspace/contracts"
import { ulid } from "ulid"

import { createUploadToken } from "../../src/uploads/upload-token.js"
import { buildEnvelope } from "./builders.js"

export async function sendUploadRequest(envelope: UploadScenarioRunEnvelopeV1, token?: string) {
  return sendRawRequest(JSON.stringify(envelope), token ?? (await createTestUploadToken(envelope)))
}

export async function sendRawRequest(body: string, token?: string) {
  const uploadToken = token ?? (await createTestUploadToken(extractEnvelopeOrDefault(body)))

  return fetchWorker(
    new Request("https://bundle.test/api/v1/uploads/scenario-runs", {
      method: "POST",
      headers: {
        authorization: `Bearer ${uploadToken}`,
        "content-type": "application/json",
      },
      body,
    }),
  )
}

export async function createTestUploadToken(envelope: UploadScenarioRunEnvelopeV1) {
  await ensureEnabledRepository(envelope)

  const repository = await env.DB.prepare(
    "SELECT id FROM repositories WHERE github_repo_id = ? LIMIT 1",
  )
    .bind(envelope.repository.githubRepoId)
    .first<{ id: string }>()

  if (!repository) {
    throw new Error("Could not prepare repository for upload test.")
  }

  return createUploadToken(env, {
    commitSha: envelope.git.commitSha,
    githubRepoId: envelope.repository.githubRepoId,
    installationId: envelope.repository.installationId,
    owner: envelope.repository.owner,
    repositoryId: repository.id,
    repositoryName: envelope.repository.name,
    runAttempt: envelope.ci.workflowRunAttempt,
    runId: envelope.ci.workflowRunId,
  })
}

export async function fetchPage(url: string) {
  return fetchWorker(new Request(url))
}

export function toRequestUrl(input: Request | string | URL) {
  if (typeof input === "string") {
    return input
  }

  return input instanceof URL ? input.toString() : input.url
}

async function fetchWorker(request: Request) {
  const executionContext = createExecutionContext()
  const worker = (
    exports as unknown as {
      default: {
        fetch: (request: Request, env: Cloudflare.Env, ctx: ExecutionContext) => Promise<Response>
      }
    }
  ).default

  const response = await worker.fetch(request, env, executionContext)
  await waitOnExecutionContext(executionContext)
  return response
}

function extractEnvelopeOrDefault(body: string) {
  try {
    const parsed = JSON.parse(body) as Partial<UploadScenarioRunEnvelopeV1>

    return parsed.repository && parsed.git && parsed.ci
      ? (parsed as UploadScenarioRunEnvelopeV1)
      : buildEnvelope()
  } catch {
    return buildEnvelope()
  }
}

async function ensureEnabledRepository(envelope: UploadScenarioRunEnvelopeV1) {
  const timestamp = new Date().toISOString()

  await env.DB.prepare(
    `INSERT INTO repositories (
      id,
      github_repo_id,
      owner,
      name,
      installation_id,
      enabled,
      visibility,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, 1, 'public', ?, ?)
    ON CONFLICT(github_repo_id) DO UPDATE SET
      owner = excluded.owner,
      name = excluded.name,
      installation_id = excluded.installation_id,
      enabled = 1,
      visibility = 'public',
      disabled_at = NULL,
      deleted_at = NULL,
      updated_at = excluded.updated_at`,
  )
    .bind(
      ulid(),
      envelope.repository.githubRepoId,
      envelope.repository.owner,
      envelope.repository.name,
      envelope.repository.installationId,
      timestamp,
      timestamp,
    )
    .run()
}
