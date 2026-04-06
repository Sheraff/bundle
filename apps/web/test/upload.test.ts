import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import {
  normalizeRunQueueMessageSchema,
  uploadScenarioRunAcceptedResponseV1Schema,
} from '@workspace/contracts'
import { describe, expect, it, vi } from 'vitest'
import * as v from 'valibot'

const sha = '0123456789abcdef0123456789abcdef01234567'

describe('POST /api/v1/uploads/scenario-runs', () => {
  it('persists a fixture-app upload to D1 and R2 and enqueues normalization', async () => {
    const sendSpy = vi.spyOn(env.NORMALIZE_RUN_QUEUE, 'send')
    const response = await sendUploadRequest(buildEnvelope())
    const responseBody = await response.json()
    const responseResult = v.safeParse(
      uploadScenarioRunAcceptedResponseV1Schema,
      responseBody,
    )

    expect(response.status).toBe(202)
    expect(responseResult.success).toBe(true)
    expect(sendSpy).toHaveBeenCalledTimes(1)

    const queuedMessage = sendSpy.mock.calls[0]?.[0]
    const queuedMessageResult = v.safeParse(normalizeRunQueueMessageSchema, queuedMessage)
    expect(queuedMessageResult.success).toBe(true)
    expect((queuedMessage as Record<string, unknown>).repositoryId).toBe(
      responseResult.success ? responseResult.output.repositoryId : null,
    )
    expect((queuedMessage as Record<string, unknown>).scenarioRunId).toBe(
      responseResult.success ? responseResult.output.scenarioRunId : null,
    )

    const scenarioRun = await env.DB.prepare(
      'SELECT repository_id, commit_group_id, status, raw_artifact_r2_key, raw_envelope_r2_key FROM scenario_runs',
    ).first<{
      commit_group_id: string
      raw_artifact_r2_key: string
      raw_envelope_r2_key: string
      repository_id: string
      status: string
    }>()

    expect(scenarioRun).toBeTruthy()
    expect(scenarioRun?.repository_id).toBe(
      responseResult.success ? responseResult.output.repositoryId : null,
    )
    expect(scenarioRun?.commit_group_id).toBe(
      responseResult.success ? responseResult.output.commitGroupId : null,
    )
    expect(scenarioRun?.status).toBe('queued')

    const artifactObject = await env.RAW_UPLOADS_BUCKET.get(scenarioRun!.raw_artifact_r2_key)
    const envelopeObject = await env.RAW_UPLOADS_BUCKET.get(scenarioRun!.raw_envelope_r2_key)

    expect(await artifactObject?.text()).toContain('fixture-app-cost')
    expect(await envelopeObject?.text()).toContain('"githubRepoId":123')
  })

  it('accepts repo-synthetic uploads and records the scenario source kind', async () => {
    const sendSpy = vi.spyOn(env.NORMALIZE_RUN_QUEUE, 'send')
    const response = await sendUploadRequest(
      buildEnvelope({
        artifact: buildArtifact({
          scenario: {
            id: 'button-cost',
            kind: 'synthetic-import',
          },
        }),
        scenarioSource: {
          kind: 'repo-synthetic',
        },
        syntheticDefinition: {
          source: "export { Button } from '@acme/ui'",
        },
      }),
    )

    expect(response.status).toBe(202)
    expect(sendSpy).toHaveBeenCalledTimes(1)

    const scenario = await env.DB.prepare(
      'SELECT slug, source_kind FROM scenarios LIMIT 1',
    ).first<{
      slug: string
      source_kind: string
    }>()

    expect(scenario).toEqual({
      slug: 'button-cost',
      source_kind: 'repo-synthetic',
    })
  })

  it('persists pull request metadata when the upload includes PR context', async () => {
    const response = await sendUploadRequest(
      buildEnvelope({
        pullRequest: {
          number: 42,
          baseSha: '1111111111111111111111111111111111111111',
          baseRef: 'main',
          headSha: sha,
          headRef: 'feature/upload-ingest',
        },
      }),
    )

    expect(response.status).toBe(202)

    const pullRequest = await env.DB.prepare(
      'SELECT pr_number, base_ref, head_ref FROM pull_requests LIMIT 1',
    ).first<{
      base_ref: string
      head_ref: string
      pr_number: number
    }>()

    const commitGroup = await env.DB.prepare(
      'SELECT status, pull_request_id FROM commit_groups LIMIT 1',
    ).first<{
      pull_request_id: string | null
      status: string
    }>()

    expect(pullRequest).toEqual({
      pr_number: 42,
      base_ref: 'main',
      head_ref: 'feature/upload-ingest',
    })
    expect(commitGroup?.status).toBe('pending')
    expect(commitGroup?.pull_request_id).toBeTruthy()
  })

  it('rejects requests with an invalid bearer token', async () => {
    const response = await sendUploadRequest(buildEnvelope(), 'wrong-token')

    expect(response.status).toBe(401)
    expect(await countRows('scenario_runs')).toBe(0)
  })

  it('rejects requests with an invalid envelope body', async () => {
    const response = await sendRawRequest(
      JSON.stringify({
        schemaVersion: 1,
      }),
    )

    expect(response.status).toBe(400)
    expect(await countRows('scenario_runs')).toBe(0)
  })

  it('reuses the same scenario run for an exact duplicate upload', async () => {
    const sendSpy = vi.spyOn(env.NORMALIZE_RUN_QUEUE, 'send')
    const firstResponse = await sendUploadRequest(buildEnvelope())
    const secondResponse = await sendUploadRequest(buildEnvelope())
    const firstBodyResult = v.safeParse(
      uploadScenarioRunAcceptedResponseV1Schema,
      await firstResponse.json(),
    )
    const secondBodyResult = v.safeParse(
      uploadScenarioRunAcceptedResponseV1Schema,
      await secondResponse.json(),
    )

    expect(firstResponse.status).toBe(202)
    expect(secondResponse.status).toBe(202)
    expect(firstBodyResult.success).toBe(true)
    expect(secondBodyResult.success).toBe(true)
    expect(firstBodyResult.success && firstBodyResult.output.scenarioRunId).toBe(
      secondBodyResult.success ? secondBodyResult.output.scenarioRunId : null,
    )
    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(await countRows('scenario_runs')).toBe(1)
  })
})

async function sendUploadRequest(
  envelope: ReturnType<typeof buildEnvelope>,
  token = env.BUNDLE_UPLOAD_TOKEN,
) {
  return sendRawRequest(JSON.stringify(envelope), token)
}

async function sendRawRequest(
  body: string,
  token = env.BUNDLE_UPLOAD_TOKEN,
) {
  const executionContext = createExecutionContext()
  const worker = (exports as unknown as {
    default: {
      fetch: (request: Request, env: Cloudflare.Env, ctx: ExecutionContext) => Promise<Response>
    }
  }).default

  const response = await worker.fetch(
    new Request('https://bundle.test/api/v1/uploads/scenario-runs', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body,
    }),
    env,
    executionContext,
  )

  await waitOnExecutionContext(executionContext)

  return response
}

async function countRows(tableName: string) {
  const result = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).first<{
    count: number
  }>()

  return result?.count ?? 0
}

function buildArtifact(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    pluginVersion: '0.1.0',
    generatedAt: '2026-04-06T12:00:00.000Z',
    scenario: {
      id: 'fixture-app-cost',
      kind: 'fixture-app',
    },
    build: {
      bundler: 'vite',
      bundlerVersion: '8.0.4',
      rootDir: '/tmp/repo',
    },
    environments: [
      {
        name: 'default',
        build: {
          outDir: 'dist',
        },
        manifest: {
          'src/main.ts': {
            file: 'assets/main.js',
            src: 'src/main.ts',
            isEntry: true,
          },
        },
        chunks: [
          {
            fileName: 'assets/main.js',
            name: 'main',
            isEntry: true,
            isDynamicEntry: false,
            facadeModuleId: '/tmp/repo/src/main.ts',
            imports: [],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: ['assets/main.css'],
            importedAssets: [],
            modules: [
              {
                rawId: '/tmp/repo/src/main.ts',
                renderedLength: 123,
                originalLength: 456,
              },
            ],
            sizes: {
              raw: 123,
              gzip: 45,
              brotli: 38,
            },
          },
        ],
        assets: [
          {
            fileName: 'assets/main.css',
            names: ['main.css'],
            needsCodeReference: false,
            sizes: {
              raw: 10,
              gzip: 8,
              brotli: 6,
            },
          },
        ],
        warnings: [],
      },
    ],
    ...overrides,
  }
}

function buildEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    artifact: buildArtifact(),
    repository: {
      githubRepoId: 123,
      owner: 'acme',
      name: 'widget',
      installationId: 456,
    },
    git: {
      commitSha: sha,
      branch: 'main',
    },
    scenarioSource: {
      kind: 'fixture-app',
    },
    ci: {
      provider: 'github-actions',
      workflowRunId: '999',
      workflowRunAttempt: 2,
      job: 'build',
      actionVersion: 'v1',
    },
    ...overrides,
  }
}
