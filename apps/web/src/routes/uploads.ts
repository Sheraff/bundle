import {
  SCHEMA_VERSION_V1,
  normalizeRunQueueMessageSchema,
  uploadScenarioRunAcceptedResponseV1Schema,
  uploadScenarioRunEnvelopeV1Schema,
  type NormalizeRunQueueMessage,
  type PullRequestContext,
  type RepositoryContext,
  type ScenarioRunStatus,
  type UploadScenarioRunAcceptedResponseV1,
  type UploadScenarioRunEnvelopeV1,
} from '@workspace/contracts'
import { and, eq } from 'drizzle-orm'
import type { Context, Hono } from 'hono'
import * as v from 'valibot'
import { ulid } from 'ulid'

import { getDb, schema } from '../db/index.js'
import type { AppBindings, AppEnv } from '../env.js'

const textEncoder = new TextEncoder()

type AppDb = ReturnType<typeof getDb>
type ScenarioRunRecord = typeof schema.scenarioRuns.$inferSelect

interface StoredUploadTexts {
  artifactSha256: string
  artifactSizeBytes: number
  artifactText: string
  envelopeSha256: string
  envelopeSizeBytes: number
  envelopeText: string
}

export function registerUploadRoutes(app: Hono<AppEnv>) {
  app.post('/api/v1/uploads/scenario-runs', async (c) => {
    const uploadToken = readBearerToken(c.req.header('authorization'))

    if (!uploadToken || uploadToken !== c.env.BUNDLE_UPLOAD_TOKEN) {
      return jsonError(c, 401, 'unauthorized', 'The upload token is missing or invalid.')
    }

    const rawRequestBody = await c.req.text()
    const parsedRequestBody = parseJsonBody(rawRequestBody)

    if (!parsedRequestBody.success) {
      return jsonError(c, 400, 'invalid_json', 'The upload body must be valid JSON.')
    }

    const envelopeResult = v.safeParse(
      uploadScenarioRunEnvelopeV1Schema,
      parsedRequestBody.output,
    )

    if (!envelopeResult.success) {
      return jsonError(
        c,
        400,
        'invalid_upload_envelope',
        formatIssues(envelopeResult.issues),
      )
    }

    const envelope = envelopeResult.output
    const db = getDb(c.env)
    const uploadDedupeKey = await sha256Hex(stableStringify(envelope))
    const existingScenarioRun = await getScenarioRunByDedupeKey(db, uploadDedupeKey)

    if (existingScenarioRun) {
      return c.json(buildAcceptedResponse(existingScenarioRun), 202)
    }

    const timestamp = new Date().toISOString()
    const storedTexts = await buildStoredUploadTexts(envelope, rawRequestBody)
    const scenarioRunId = ulid()
    const rawArtifactR2Key = `raw/scenario-runs/${scenarioRunId}/artifact.json`
    const rawEnvelopeR2Key = `raw/scenario-runs/${scenarioRunId}/envelope.json`

    await Promise.all([
      putRawUploadObject(
        c.env,
        rawArtifactR2Key,
        storedTexts.artifactText,
        storedTexts.artifactSha256,
        envelope.artifact.schemaVersion,
      ),
      putRawUploadObject(
        c.env,
        rawEnvelopeR2Key,
        storedTexts.envelopeText,
        storedTexts.envelopeSha256,
        envelope.schemaVersion,
      ),
    ])

    const repository = await upsertRepository(db, envelope.repository, timestamp)
    const scenario = await upsertScenario(db, repository.id, envelope, timestamp)
    const pullRequest = envelope.pullRequest
      ? await upsertPullRequest(db, repository.id, envelope.pullRequest, timestamp)
      : null
    const commitGroup = await upsertCommitGroup(
      db,
      repository.id,
      pullRequest?.id ?? null,
      envelope.git.commitSha,
      envelope.git.branch,
      timestamp,
    )

    await db
      .insert(schema.scenarioRuns)
      .values({
        id: scenarioRunId,
        repositoryId: repository.id,
        scenarioId: scenario.id,
        commitGroupId: commitGroup.id,
        pullRequestId: pullRequest?.id ?? null,
        commitSha: envelope.git.commitSha,
        branch: envelope.git.branch,
        status: 'queued',
        scenarioSourceKind: envelope.scenarioSource.kind,
        artifactScenarioKind: envelope.artifact.scenario.kind,
        uploadDedupeKey,
        rawArtifactR2Key,
        rawEnvelopeR2Key,
        artifactSha256: storedTexts.artifactSha256,
        envelopeSha256: storedTexts.envelopeSha256,
        artifactSizeBytes: storedTexts.artifactSizeBytes,
        envelopeSizeBytes: storedTexts.envelopeSizeBytes,
        artifactSchemaVersion: envelope.artifact.schemaVersion,
        uploadSchemaVersion: envelope.schemaVersion,
        ciProvider: envelope.ci.provider,
        ciWorkflowRunId: envelope.ci.workflowRunId,
        ciWorkflowRunAttempt: envelope.ci.workflowRunAttempt ?? null,
        ciJob: envelope.ci.job ?? null,
        ciActionVersion: envelope.ci.actionVersion ?? null,
        uploadedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .onConflictDoNothing({ target: schema.scenarioRuns.uploadDedupeKey })

    const persistedScenarioRun = await getScenarioRunByDedupeKey(db, uploadDedupeKey)

    if (!persistedScenarioRun) {
      throw new Error('Scenario-run upload did not persist a scenario_runs row.')
    }

    if (persistedScenarioRun.id === scenarioRunId) {
      try {
        await enqueueNormalizeRun(c.env, repository.id, scenarioRunId)
      } catch {
        await rollbackScenarioRunInsert(
          db,
          c.env,
          scenarioRunId,
          rawArtifactR2Key,
          rawEnvelopeR2Key,
        )

        return jsonError(
          c,
          503,
          'normalize_queue_unavailable',
          'The upload could not be accepted because follow-up processing could not be scheduled.',
        )
      }
    }

    return c.json(buildAcceptedResponse(persistedScenarioRun), 202)
  })
}

function parseJsonBody(rawRequestBody: string) {
  try {
    return {
      success: true as const,
      output: JSON.parse(rawRequestBody) as unknown,
    }
  } catch {
    return {
      success: false as const,
    }
  }
}

export async function buildStoredUploadTexts(
  envelope: UploadScenarioRunEnvelopeV1,
  rawRequestBody: string,
): Promise<StoredUploadTexts> {
  const artifactText = `${JSON.stringify(envelope.artifact, null, 2)}\n`
  const envelopeText = ensureTrailingNewline(rawRequestBody)

  return {
    artifactText,
    artifactSha256: await sha256Hex(artifactText),
    artifactSizeBytes: textEncoder.encode(artifactText).byteLength,
    envelopeText,
    envelopeSha256: await sha256Hex(envelopeText),
    envelopeSizeBytes: textEncoder.encode(envelopeText).byteLength,
  }
}

async function putRawUploadObject(
  env: AppBindings,
  key: string,
  value: string,
  sha256: string,
  schemaVersion: number,
) {
  await env.RAW_UPLOADS_BUCKET.put(key, value, {
    httpMetadata: {
      contentType: 'application/json',
    },
    customMetadata: {
      schemaVersion: String(schemaVersion),
      sha256,
    },
  })
}

async function enqueueNormalizeRun(
  env: AppBindings,
  repositoryId: string,
  scenarioRunId: string,
) {
  const messageResult = v.safeParse(normalizeRunQueueMessageSchema, {
    schemaVersion: SCHEMA_VERSION_V1,
    kind: 'normalize-run',
    repositoryId,
    scenarioRunId,
    dedupeKey: `normalize-run:${scenarioRunId}:v1`,
  })

  if (!messageResult.success) {
    throw new Error(`Generated normalize-run message is invalid: ${formatIssues(messageResult.issues)}`)
  }

  await env.NORMALIZE_RUN_QUEUE.send(messageResult.output, {
    contentType: 'json',
  })
}

async function upsertRepository(
  db: AppDb,
  repository: RepositoryContext,
  timestamp: string,
) {
  const existingRepository = await selectOne(
    db
      .select({ id: schema.repositories.id })
      .from(schema.repositories)
      .where(eq(schema.repositories.githubRepoId, repository.githubRepoId))
      .limit(1),
  )

  if (existingRepository) {
    await db
      .update(schema.repositories)
      .set({
        owner: repository.owner,
        name: repository.name,
        installationId: repository.installationId,
        updatedAt: timestamp,
      })
      .where(eq(schema.repositories.id, existingRepository.id))

    return existingRepository
  }

  const createdRepositoryId = ulid()

  try {
    await db.insert(schema.repositories).values({
      id: createdRepositoryId,
      githubRepoId: repository.githubRepoId,
      owner: repository.owner,
      name: repository.name,
      installationId: repository.installationId,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  } catch {
    const concurrentRepository = await selectOne(
      db
        .select({ id: schema.repositories.id })
        .from(schema.repositories)
        .where(eq(schema.repositories.githubRepoId, repository.githubRepoId))
        .limit(1),
    )

    if (concurrentRepository) {
      return concurrentRepository
    }

    throw new Error('Could not create the repository row for this upload.')
  }

  return {
    id: createdRepositoryId,
  }
}

async function upsertScenario(
  db: AppDb,
  repositoryId: string,
  envelope: UploadScenarioRunEnvelopeV1,
  timestamp: string,
) {
  const existingScenario = await selectOne(
    db
      .select({ id: schema.scenarios.id })
      .from(schema.scenarios)
      .where(
        and(
          eq(schema.scenarios.repositoryId, repositoryId),
          eq(schema.scenarios.slug, envelope.artifact.scenario.id),
        ),
      )
      .limit(1),
  )

  if (existingScenario) {
    await db
      .update(schema.scenarios)
      .set({
        sourceKind: envelope.scenarioSource.kind,
        updatedAt: timestamp,
      })
      .where(eq(schema.scenarios.id, existingScenario.id))

    return existingScenario
  }

  const createdScenarioId = ulid()

  try {
    await db.insert(schema.scenarios).values({
      id: createdScenarioId,
      repositoryId,
      slug: envelope.artifact.scenario.id,
      sourceKind: envelope.scenarioSource.kind,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  } catch {
    const concurrentScenario = await selectOne(
      db
        .select({ id: schema.scenarios.id })
        .from(schema.scenarios)
        .where(
          and(
            eq(schema.scenarios.repositoryId, repositoryId),
            eq(schema.scenarios.slug, envelope.artifact.scenario.id),
          ),
        )
        .limit(1),
    )

    if (concurrentScenario) {
      return concurrentScenario
    }

    throw new Error('Could not create the scenario row for this upload.')
  }

  return {
    id: createdScenarioId,
  }
}

async function upsertPullRequest(
  db: AppDb,
  repositoryId: string,
  pullRequest: PullRequestContext,
  timestamp: string,
) {
  const existingPullRequest = await selectOne(
    db
      .select({ id: schema.pullRequests.id })
      .from(schema.pullRequests)
      .where(
        and(
          eq(schema.pullRequests.repositoryId, repositoryId),
          eq(schema.pullRequests.prNumber, pullRequest.number),
        ),
      )
      .limit(1),
  )

  if (existingPullRequest) {
    await db
      .update(schema.pullRequests)
      .set({
        baseSha: pullRequest.baseSha,
        baseRef: pullRequest.baseRef,
        headSha: pullRequest.headSha,
        headRef: pullRequest.headRef,
        updatedAt: timestamp,
      })
      .where(eq(schema.pullRequests.id, existingPullRequest.id))

    return existingPullRequest
  }

  const createdPullRequestId = ulid()

  try {
    await db.insert(schema.pullRequests).values({
      id: createdPullRequestId,
      repositoryId,
      prNumber: pullRequest.number,
      baseSha: pullRequest.baseSha,
      baseRef: pullRequest.baseRef,
      headSha: pullRequest.headSha,
      headRef: pullRequest.headRef,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  } catch {
    const concurrentPullRequest = await selectOne(
      db
        .select({ id: schema.pullRequests.id })
        .from(schema.pullRequests)
        .where(
          and(
            eq(schema.pullRequests.repositoryId, repositoryId),
            eq(schema.pullRequests.prNumber, pullRequest.number),
          ),
        )
        .limit(1),
    )

    if (concurrentPullRequest) {
      return concurrentPullRequest
    }

    throw new Error('Could not create the pull request row for this upload.')
  }

  return {
    id: createdPullRequestId,
  }
}

async function upsertCommitGroup(
  db: AppDb,
  repositoryId: string,
  pullRequestId: string | null,
  commitSha: string,
  branch: string,
  timestamp: string,
) {
  const existingCommitGroup = await selectOne(
    db
      .select({
        id: schema.commitGroups.id,
        pullRequestId: schema.commitGroups.pullRequestId,
      })
      .from(schema.commitGroups)
      .where(
        and(
          eq(schema.commitGroups.repositoryId, repositoryId),
          eq(schema.commitGroups.commitSha, commitSha),
        ),
      )
      .limit(1),
  )

  if (existingCommitGroup) {
    await db
      .update(schema.commitGroups)
      .set({
        branch,
        pullRequestId: pullRequestId ?? existingCommitGroup.pullRequestId ?? null,
        status: 'pending',
        latestUploadAt: timestamp,
        updatedAt: timestamp,
      })
      .where(eq(schema.commitGroups.id, existingCommitGroup.id))

    return {
      id: existingCommitGroup.id,
    }
  }

  const createdCommitGroupId = ulid()

  try {
    await db.insert(schema.commitGroups).values({
      id: createdCommitGroupId,
      repositoryId,
      pullRequestId,
      commitSha,
      branch,
      status: 'pending',
      latestUploadAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  } catch {
    const concurrentCommitGroup = await selectOne(
      db
        .select({ id: schema.commitGroups.id })
        .from(schema.commitGroups)
        .where(
          and(
            eq(schema.commitGroups.repositoryId, repositoryId),
            eq(schema.commitGroups.commitSha, commitSha),
          ),
        )
        .limit(1),
    )

    if (concurrentCommitGroup) {
      return concurrentCommitGroup
    }

    throw new Error('Could not create the commit-group row for this upload.')
  }

  return {
    id: createdCommitGroupId,
  }
}

async function getScenarioRunByDedupeKey(db: AppDb, uploadDedupeKey: string) {
  return selectOne(
    db
      .select({
        id: schema.scenarioRuns.id,
        repositoryId: schema.scenarioRuns.repositoryId,
        commitGroupId: schema.scenarioRuns.commitGroupId,
        status: schema.scenarioRuns.status,
      })
      .from(schema.scenarioRuns)
      .where(eq(schema.scenarioRuns.uploadDedupeKey, uploadDedupeKey))
      .limit(1),
  )
}

async function rollbackScenarioRunInsert(
  db: AppDb,
  env: AppBindings,
  scenarioRunId: string,
  rawArtifactR2Key: string,
  rawEnvelopeR2Key: string,
) {
  await Promise.allSettled([
    db.delete(schema.scenarioRuns).where(eq(schema.scenarioRuns.id, scenarioRunId)),
    env.RAW_UPLOADS_BUCKET.delete(rawArtifactR2Key),
    env.RAW_UPLOADS_BUCKET.delete(rawEnvelopeR2Key),
  ])
}

function buildAcceptedResponse(
  scenarioRun: Pick<ScenarioRunRecord, 'id' | 'repositoryId' | 'commitGroupId' | 'status'>,
): UploadScenarioRunAcceptedResponseV1 {
  const responseResult = v.safeParse(uploadScenarioRunAcceptedResponseV1Schema, {
    schemaVersion: SCHEMA_VERSION_V1,
    accepted: true,
    repositoryId: scenarioRun.repositoryId,
    commitGroupId: scenarioRun.commitGroupId,
    scenarioRunId: scenarioRun.id,
    status: scenarioRun.status as ScenarioRunStatus,
  })

  if (!responseResult.success) {
    throw new Error(`Generated upload response is invalid: ${formatIssues(responseResult.issues)}`)
  }

  return responseResult.output
}

export function readBearerToken(authorizationHeader?: string) {
  if (!authorizationHeader) {
    return null
  }

  const [scheme, token] = authorizationHeader.trim().split(/\s+/, 2)

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null
  }

  return token
}

function jsonError(
  c: Context<AppEnv>,
  status: 400 | 401 | 500 | 503,
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

function ensureTrailingNewline(value: string) {
  return value.endsWith('\n') ? value : `${value}\n`
}

function formatIssues(issues: readonly { message: string }[]) {
  return issues.map((issue) => issue.message).join('; ')
}

export async function sha256Hex(value: string) {
  const hash = await crypto.subtle.digest('SHA-256', textEncoder.encode(value))
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  )

  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(',')}}`
}

async function selectOne<T>(query: Promise<T[]>) {
  const [row] = await query
  return row ?? null
}
