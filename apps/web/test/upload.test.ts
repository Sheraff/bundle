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
    const queuedMessageOptions = sendSpy.mock.calls[0]?.[1]
    const queuedMessageResult = v.safeParse(normalizeRunQueueMessageSchema, queuedMessage)
    expect(queuedMessageResult.success).toBe(true)
    expect((queuedMessage as Record<string, unknown>).repositoryId).toBe(
      responseResult.success ? responseResult.output.repositoryId : null,
    )
    expect((queuedMessage as Record<string, unknown>).scenarioRunId).toBe(
      responseResult.success ? responseResult.output.scenarioRunId : null,
    )
    expect(queuedMessageOptions).toEqual({ contentType: 'json' })

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
    expect(artifactObject?.httpMetadata?.contentType).toBe('application/json')
    expect(envelopeObject?.httpMetadata?.contentType).toBe('application/json')
    expect(artifactObject?.customMetadata?.schemaVersion).toBe('1')
    expect(envelopeObject?.customMetadata?.schemaVersion).toBe('1')
    expect(artifactObject?.customMetadata?.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(envelopeObject?.customMetadata?.sha256).toMatch(/^[a-f0-9]{64}$/)
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

  it('rejects requests that omit the authorization header', async () => {
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
          'content-type': 'application/json',
        },
        body: JSON.stringify(buildEnvelope()),
      }),
      env,
      executionContext,
    )

    await waitOnExecutionContext(executionContext)

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

  it('rejects malformed JSON before schema validation', async () => {
    const response = await sendRawRequest('{"schemaVersion":1')
    const responseBody = (await response.json()) as {
      error?: { code?: string }
    }

    expect(response.status).toBe(400)
    expect(responseBody.error?.code).toBe('invalid_json')
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

  it('rolls back the scenario run when queue send fails so retries can enqueue again', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sendSpy = vi
      .spyOn(env.NORMALIZE_RUN_QUEUE, 'send')
      .mockRejectedValueOnce(new Error('queue unavailable'))

    const firstResponse = await sendUploadRequest(buildEnvelope())
    const firstResponseBody = (await firstResponse.json()) as {
      error?: { code?: string }
    }

    expect(firstResponse.status).toBe(503)
    expect(firstResponseBody.error?.code).toBe('normalize_queue_unavailable')
    expect(await countRows('scenario_runs')).toBe(0)
    expect(consoleErrorSpy).not.toHaveBeenCalled()

    const secondResponse = await sendUploadRequest(buildEnvelope())
    const secondBodyResult = v.safeParse(
      uploadScenarioRunAcceptedResponseV1Schema,
      await secondResponse.json(),
    )

    expect(secondResponse.status).toBe(202)
    expect(secondBodyResult.success).toBe(true)
    expect(sendSpy).toHaveBeenCalledTimes(2)
    expect(await countRows('scenario_runs')).toBe(1)
  })

  it('stores distinct scenario runs under the same commit group for one commit sha', async () => {
    const sendSpy = vi.spyOn(env.NORMALIZE_RUN_QUEUE, 'send')
    const firstResponse = await sendUploadRequest(buildEnvelope())
    const secondResponse = await sendUploadRequest(
      buildEnvelope({
        artifact: buildArtifact({
          scenario: {
            id: 'fixture-app-graph',
            kind: 'fixture-app',
          },
        }),
      }),
    )
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
    expect(firstBodyResult.success && firstBodyResult.output.commitGroupId).toBe(
      secondBodyResult.success ? secondBodyResult.output.commitGroupId : null,
    )
    expect(await countRows('commit_groups')).toBe(1)
    expect(await countRows('scenario_runs')).toBe(2)
    expect(await countRows('scenarios')).toBe(2)
    expect(sendSpy).toHaveBeenCalledTimes(2)
  })

  it('dedupes semantically identical uploads even when raw JSON formatting differs', async () => {
    const sendSpy = vi.spyOn(env.NORMALIZE_RUN_QUEUE, 'send')
    const envelope = buildEnvelope()
    const firstResponse = await sendRawRequest(JSON.stringify(envelope))
    const secondResponse = await sendRawRequest(buildReorderedEnvelopeBody(envelope))
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

  it('updates the repository row when the same github repo uploads refreshed metadata', async () => {
    await sendUploadRequest(buildEnvelope())
    await sendUploadRequest(
      buildEnvelope({
        repository: {
          githubRepoId: 123,
          owner: 'acme-renamed',
          name: 'widget-next',
          installationId: 789,
        },
        git: {
          commitSha: 'fedcba9876543210fedcba9876543210fedcba98',
          branch: 'release',
        },
      }),
    )

    const repository = await env.DB.prepare(
      'SELECT owner, name, installation_id FROM repositories LIMIT 1',
    ).first<{
      installation_id: number
      name: string
      owner: string
    }>()

    expect(await countRows('repositories')).toBe(1)
    expect(repository).toEqual({
      owner: 'acme-renamed',
      name: 'widget-next',
      installation_id: 789,
    })
  })

  it('updates pull request and commit-group rows when the same PR commit is re-uploaded', async () => {
    await sendUploadRequest(
      buildEnvelope({
        git: {
          commitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          branch: 'feature/original',
        },
        pullRequest: {
          number: 42,
          baseSha: '1111111111111111111111111111111111111111',
          baseRef: 'main',
          headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          headRef: 'feature/original',
        },
      }),
    )

    await sendUploadRequest(
      buildEnvelope({
        git: {
          commitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          branch: 'feature/renamed',
        },
        pullRequest: {
          number: 42,
          baseSha: '2222222222222222222222222222222222222222',
          baseRef: 'release',
          headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          headRef: 'feature/renamed',
        },
      }),
    )

    const pullRequest = await env.DB.prepare(
      'SELECT pr_number, base_sha, base_ref, head_sha, head_ref FROM pull_requests LIMIT 1',
    ).first<{
      base_ref: string
      base_sha: string
      head_ref: string
      head_sha: string
      pr_number: number
    }>()

    const commitGroup = await env.DB.prepare(
      'SELECT branch, status, pull_request_id FROM commit_groups LIMIT 1',
    ).first<{
      branch: string
      pull_request_id: string | null
      status: string
    }>()

    expect(await countRows('pull_requests')).toBe(1)
    expect(await countRows('commit_groups')).toBe(1)
    expect(await countRows('scenario_runs')).toBe(2)
    expect(pullRequest).toEqual({
      pr_number: 42,
      base_sha: '2222222222222222222222222222222222222222',
      base_ref: 'release',
      head_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      head_ref: 'feature/renamed',
    })
    expect(commitGroup).toEqual({
      branch: 'feature/renamed',
      status: 'pending',
      pull_request_id: expect.any(String),
    })
  })

  it('updates the scenario row when the same slug is re-uploaded with a new source kind', async () => {
    await sendUploadRequest(
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

    await sendUploadRequest(
      buildEnvelope({
        artifact: buildArtifact({
          scenario: {
            id: 'button-cost',
            kind: 'synthetic-import',
          },
        }),
        git: {
          commitSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          branch: 'main',
        },
        scenarioSource: {
          kind: 'hosted-synthetic',
          hostedScenarioId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        },
        syntheticDefinition: {
          displayName: 'Hosted button cost',
          source: "export { Button } from '@acme/ui/hosted'",
        },
      }),
    )

    const scenario = await env.DB.prepare(
      'SELECT slug, source_kind FROM scenarios LIMIT 1',
    ).first<{
      slug: string
      source_kind: string
    }>()

    expect(await countRows('scenarios')).toBe(1)
    expect(await countRows('scenario_runs')).toBe(2)
    expect(scenario).toEqual({
      slug: 'button-cost',
      source_kind: 'hosted-synthetic',
    })
  })

  it('accepts hosted-synthetic uploads and stores the source kind on the scenario run', async () => {
    const response = await sendUploadRequest(
      buildEnvelope({
        artifact: buildArtifact({
          scenario: {
            id: 'hosted-button-cost',
            kind: 'synthetic-import',
          },
        }),
        scenarioSource: {
          kind: 'hosted-synthetic',
          hostedScenarioId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
        },
        syntheticDefinition: {
          displayName: 'Hosted button cost',
          source: "export { Button } from '@acme/ui/hosted'",
        },
      }),
    )

    const scenarioRun = await env.DB.prepare(
      'SELECT scenario_source_kind, artifact_scenario_kind FROM scenario_runs LIMIT 1',
    ).first<{
      artifact_scenario_kind: string
      scenario_source_kind: string
    }>()

    expect(response.status).toBe(202)
    expect(scenarioRun).toEqual({
      scenario_source_kind: 'hosted-synthetic',
      artifact_scenario_kind: 'synthetic-import',
    })
  })

  it('cleans up raw uploads and returns a handled error when the second R2 write fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const originalPut = env.RAW_UPLOADS_BUCKET.put.bind(env.RAW_UPLOADS_BUCKET)
    let putCallCount = 0

    vi.spyOn(env.RAW_UPLOADS_BUCKET, 'put').mockImplementation(async (...args) => {
      putCallCount += 1

      if (putCallCount === 2) {
        throw new Error('r2 unavailable')
      }

      return originalPut(...args)
    })

    const response = await sendUploadRequest(buildEnvelope())
    const responseBody = (await response.json()) as {
      error?: { code?: string }
    }
    const listedObjects = await env.RAW_UPLOADS_BUCKET.list()

    expect(response.status).toBe(503)
    expect(responseBody.error?.code).toBe('raw_upload_storage_unavailable')
    expect(await countRows('scenario_runs')).toBe(0)
    expect(listedObjects.objects).toHaveLength(0)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('cleans up raw uploads and returns a handled error when D1 fails after raw persistence', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const originalPrepare = env.DB.prepare.bind(env.DB)
    let prepareCallCount = 0

    const prepareSpy = vi.spyOn(env.DB, 'prepare').mockImplementation((query) => {
      prepareCallCount += 1

      if (prepareCallCount > 1 && typeof query === 'string') {
        throw new Error('d1 unavailable')
      }

      return originalPrepare(query)
    })

    const response = await sendUploadRequest(buildEnvelope())
    const responseBody = (await response.json()) as {
      error?: { code?: string }
    }

    prepareSpy.mockRestore()

    const listedObjects = await env.RAW_UPLOADS_BUCKET.list()

    expect(response.status).toBe(503)
    expect(responseBody.error?.code).toBe('upload_persistence_failed')
    expect(await countRows('scenario_runs')).toBe(0)
    expect(listedObjects.objects).toHaveLength(0)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('reuses one scenario run and does not leak extra raw objects under a concurrent duplicate upload race', async () => {
    const sendSpy = vi.spyOn(env.NORMALIZE_RUN_QUEUE, 'send')
    const originalPut = env.RAW_UPLOADS_BUCKET.put.bind(env.RAW_UPLOADS_BUCKET)
    let artifactPutCount = 0
    let releaseArtifactGate: (() => void) | null = null
    const artifactGate = new Promise<void>((resolve) => {
      releaseArtifactGate = resolve
    })

    vi.spyOn(env.RAW_UPLOADS_BUCKET, 'put').mockImplementation(async (...args) => {
      const key = args[0]

      if (typeof key === 'string' && key.endsWith('/artifact.json')) {
        artifactPutCount += 1

        if (artifactPutCount === 1) {
          await artifactGate
        }

        if (artifactPutCount === 2) {
          releaseArtifactGate?.()
        }
      }

      return originalPut(...args)
    })

    const [firstResponse, secondResponse] = await Promise.all([
      sendUploadRequest(buildEnvelope()),
      sendUploadRequest(buildEnvelope()),
    ])
    const firstBodyResult = v.safeParse(
      uploadScenarioRunAcceptedResponseV1Schema,
      await firstResponse.json(),
    )
    const secondBodyResult = v.safeParse(
      uploadScenarioRunAcceptedResponseV1Schema,
      await secondResponse.json(),
    )
    const listedObjects = await env.RAW_UPLOADS_BUCKET.list()

    expect(firstResponse.status).toBe(202)
    expect(secondResponse.status).toBe(202)
    expect(firstBodyResult.success).toBe(true)
    expect(secondBodyResult.success).toBe(true)
    expect(firstBodyResult.success && firstBodyResult.output.scenarioRunId).toBe(
      secondBodyResult.success ? secondBodyResult.output.scenarioRunId : null,
    )
    expect(await countRows('scenario_runs')).toBe(1)
    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(listedObjects.objects).toHaveLength(2)
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

function buildReorderedEnvelopeBody(envelope: ReturnType<typeof buildEnvelope>) {
  return JSON.stringify(
    {
      scenarioSource: envelope.scenarioSource,
      repository: {
        owner: envelope.repository.owner,
        installationId: envelope.repository.installationId,
        githubRepoId: envelope.repository.githubRepoId,
        name: envelope.repository.name,
      },
      ci: {
        actionVersion: envelope.ci.actionVersion,
        job: envelope.ci.job,
        workflowRunAttempt: envelope.ci.workflowRunAttempt,
        workflowRunId: envelope.ci.workflowRunId,
        provider: envelope.ci.provider,
      },
      artifact: {
        generatedAt: envelope.artifact.generatedAt,
        pluginVersion: envelope.artifact.pluginVersion,
        build: envelope.artifact.build,
        environments: envelope.artifact.environments,
        scenario: {
          kind: envelope.artifact.scenario.kind,
          id: envelope.artifact.scenario.id,
        },
        schemaVersion: envelope.artifact.schemaVersion,
      },
      git: {
        branch: envelope.git.branch,
        commitSha: envelope.git.commitSha,
      },
      schemaVersion: envelope.schemaVersion,
    },
    null,
    2,
  )
}
