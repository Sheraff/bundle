import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'

import { handleDeriveRunMessage } from '../src/derive-runs.js'
import { handleNormalizeRunMessage } from '../src/normalize-runs.js'

const sha = '0123456789abcdef0123456789abcdef01234567'
const secondSha = '1111111111111111111111111111111111111111'

describe('derive-run queue handling', () => {
  it('derives default-lens series points and marks the scenario run as processed', async () => {
    const logger = buildLogger()
    const normalizeSendSpy = vi.spyOn(env.NORMALIZE_RUN_QUEUE, 'send')
    const deriveSendSpy = vi.spyOn(env.DERIVE_RUN_QUEUE, 'send')

    const response = await sendUploadRequest(buildEnvelope())

    expect(response.status).toBe(202)

    const normalizeMessage = buildQueueMessage(normalizeSendSpy.mock.calls[0]?.[0])
    await handleNormalizeRunMessage(normalizeMessage, env, logger)

    expect(normalizeMessage.ack).toHaveBeenCalledTimes(1)
    expect(deriveSendSpy).toHaveBeenCalledTimes(1)

    const deriveMessage = buildQueueMessage(deriveSendSpy.mock.calls[0]?.[0])
    await handleDeriveRunMessage(deriveMessage, env, logger)

    expect(deriveMessage.ack).toHaveBeenCalledTimes(1)
    expect(deriveMessage.retry).not.toHaveBeenCalled()

    const scenarioRun = await env.DB.prepare(
      `SELECT status, failure_code, failure_message
       FROM scenario_runs
       LIMIT 1`,
    ).first<{
      failure_code: string | null
      failure_message: string | null
      status: string
    }>()

    const series = await env.DB.prepare(
      `SELECT environment, entrypoint_key, entrypoint_kind, lens
       FROM series
       LIMIT 1`,
    ).first<{
      entrypoint_key: string
      entrypoint_kind: string
      environment: string
      lens: string
    }>()

    const seriesPoint = await env.DB.prepare(
      `SELECT
         entry_js_raw_bytes,
         entry_js_gzip_bytes,
         entry_js_brotli_bytes,
         direct_css_raw_bytes,
         direct_css_gzip_bytes,
         direct_css_brotli_bytes,
         total_raw_bytes,
         total_gzip_bytes,
         total_brotli_bytes,
         measured_at
       FROM series_points
       LIMIT 1`,
    ).first<{
      direct_css_brotli_bytes: number
      direct_css_gzip_bytes: number
      direct_css_raw_bytes: number
      entry_js_brotli_bytes: number
      entry_js_gzip_bytes: number
      entry_js_raw_bytes: number
      measured_at: string
      total_brotli_bytes: number
      total_gzip_bytes: number
      total_raw_bytes: number
    }>()

    expect(scenarioRun).toEqual({
      status: 'processed',
      failure_code: null,
      failure_message: null,
    })
    expect(series).toEqual({
      environment: 'default',
      entrypoint_key: 'src/main.ts',
      entrypoint_kind: 'entry',
      lens: 'entry-js-direct-css',
    })
    expect(seriesPoint).toEqual({
      entry_js_raw_bytes: 123,
      entry_js_gzip_bytes: 45,
      entry_js_brotli_bytes: 38,
      direct_css_raw_bytes: 10,
      direct_css_gzip_bytes: 8,
      direct_css_brotli_bytes: 6,
      total_raw_bytes: 133,
      total_gzip_bytes: 53,
      total_brotli_bytes: 44,
      measured_at: '2026-04-06T12:00:00.000Z',
    })
    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('reuses one stable series across hash churn and appends fresh points', async () => {
    const logger = buildLogger()

    await processEnvelope(buildEnvelope(), logger)
    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: secondSha,
          branch: 'main',
        },
        ci: {
          provider: 'github-actions',
          workflowRunId: '1000',
          workflowRunAttempt: 1,
          job: 'build',
          actionVersion: 'v1',
        },
        artifact: buildArtifact({
          generatedAt: '2026-04-06T12:10:00.000Z',
          chunkFileName: 'assets/main-NEW123.js',
          cssFileName: 'assets/main-NEW123.css',
          chunkSizes: {
            raw: 150,
            gzip: 56,
            brotli: 46,
          },
          cssSizes: {
            raw: 15,
            gzip: 9,
            brotli: 7,
          },
        }),
      }),
      logger,
    )

    expect(await countRows('series')).toBe(1)
    expect(await countRows('series_points')).toBe(2)

    const distinctSeriesIds = await env.DB.prepare(
      'SELECT COUNT(DISTINCT series_id) AS count FROM series_points',
    ).first<{ count: number }>()
    const totals = await env.DB.prepare(
      'SELECT total_raw_bytes FROM series_points ORDER BY measured_at ASC',
    ).all<{ total_raw_bytes: number }>()

    expect(distinctSeriesIds?.count).toBe(1)
    expect(totals.results.map((row) => row.total_raw_bytes)).toEqual([133, 165])
  })

  it('measures manifest-only html entrypoints from their imported js chunk', async () => {
    const logger = buildLogger()

    await processEnvelope(
      buildEnvelope({
        artifact: {
          ...buildArtifact(),
          environments: [
            {
              name: 'default',
              build: {
                outDir: 'dist',
              },
              manifest: {
                'index.html': {
                  file: 'index.html',
                  src: 'index.html',
                  isEntry: true,
                  imports: ['assets/main.js'],
                  css: ['assets/main.css'],
                  assets: ['assets/logo.svg'],
                },
              },
              chunks: [
                {
                  fileName: 'assets/main.js',
                  name: 'main',
                  isEntry: false,
                  isDynamicEntry: false,
                  facadeModuleId: '/tmp/repo/src/main.ts',
                  imports: ['assets/shared.js'],
                  dynamicImports: [],
                  implicitlyLoadedBefore: [],
                  importedCss: ['assets/main.css'],
                  importedAssets: ['assets/logo.svg'],
                  modules: [
                    {
                      rawId: '/tmp/repo/src/main.ts',
                      renderedLength: 123,
                      originalLength: 456,
                    },
                  ],
                  sizes: size(123, 45, 38),
                },
                {
                  fileName: 'assets/shared.js',
                  name: 'shared',
                  isEntry: false,
                  isDynamicEntry: false,
                  facadeModuleId: null,
                  imports: [],
                  dynamicImports: [],
                  implicitlyLoadedBefore: [],
                  importedCss: [],
                  importedAssets: [],
                  modules: [
                    {
                      rawId: '/tmp/repo/src/shared.ts',
                      renderedLength: 45,
                      originalLength: 60,
                    },
                  ],
                  sizes: size(45, 20, 18),
                },
              ],
              assets: [
                {
                  fileName: 'assets/main.css',
                  names: ['main.css'],
                  needsCodeReference: false,
                  sizes: size(10, 8, 6),
                },
                {
                  fileName: 'assets/logo.svg',
                  names: ['logo.svg'],
                  needsCodeReference: false,
                  sizes: size(12, 10, 8),
                },
              ],
              warnings: [],
            },
          ],
        },
      }),
      logger,
    )

    const series = await env.DB.prepare(
      `SELECT environment, entrypoint_key, entrypoint_kind, lens
       FROM series
       LIMIT 1`,
    ).first<{
      entrypoint_key: string
      entrypoint_kind: string
      environment: string
      lens: string
    }>()
    const seriesPoint = await env.DB.prepare(
      `SELECT entry_js_raw_bytes, direct_css_raw_bytes, total_raw_bytes
       FROM series_points
       LIMIT 1`,
    ).first<{
      direct_css_raw_bytes: number
      entry_js_raw_bytes: number
      total_raw_bytes: number
    }>()

    expect(series).toEqual({
      environment: 'default',
      entrypoint_key: 'index.html',
      entrypoint_kind: 'entry',
      lens: 'entry-js-direct-css',
    })
    expect(seriesPoint).toEqual({
      entry_js_raw_bytes: 123,
      direct_css_raw_bytes: 10,
      total_raw_bytes: 133,
    })
  })

  it('marks the scenario run as failed when the normalized snapshot becomes invalid', async () => {
    const logger = buildLogger()
    const normalizeSendSpy = vi.spyOn(env.NORMALIZE_RUN_QUEUE, 'send')
    const deriveSendSpy = vi.spyOn(env.DERIVE_RUN_QUEUE, 'send')
    const response = await sendUploadRequest(buildEnvelope())

    expect(response.status).toBe(202)

    const normalizeMessage = buildQueueMessage(normalizeSendSpy.mock.calls[0]?.[0])
    await handleNormalizeRunMessage(normalizeMessage, env, logger)

    const scenarioRun = await env.DB.prepare(
      'SELECT id, normalized_snapshot_r2_key FROM scenario_runs LIMIT 1',
    ).first<{
      id: string
      normalized_snapshot_r2_key: string
    }>()

    await env.CACHE_BUCKET.put(scenarioRun!.normalized_snapshot_r2_key, '{}', {
      httpMetadata: {
        contentType: 'application/json',
      },
    })

    const deriveMessage = buildQueueMessage(deriveSendSpy.mock.calls[0]?.[0])
    await handleDeriveRunMessage(deriveMessage, env, logger)

    const failedRun = await env.DB.prepare(
      `SELECT status, failure_code, failure_message
       FROM scenario_runs
       WHERE id = ?`,
    ).bind(scenarioRun!.id).first<{
      failure_code: string | null
      failure_message: string | null
      status: string
    }>()

    expect(deriveMessage.ack).toHaveBeenCalledTimes(1)
    expect(deriveMessage.retry).not.toHaveBeenCalled()
    expect(failedRun?.status).toBe('failed')
    expect(failedRun?.failure_code).toBe('invalid_normalized_snapshot')
    expect(failedRun?.failure_message).toContain('failed schema validation')
    expect(await countRows('series')).toBe(0)
    expect(await countRows('series_points')).toBe(0)
  })

  it('treats an already-processed derive run as idempotent', async () => {
    const logger = buildLogger()
    const { deriveMessageBody } = await processEnvelope(buildEnvelope(), logger)

    const secondDeriveMessage = buildQueueMessage(deriveMessageBody)
    await handleDeriveRunMessage(secondDeriveMessage, env, logger)

    expect(secondDeriveMessage.ack).toHaveBeenCalledTimes(1)
    expect(secondDeriveMessage.retry).not.toHaveBeenCalled()
    expect(await countRows('series')).toBe(1)
    expect(await countRows('series_points')).toBe(1)
  })
})

async function processEnvelope(envelope: ReturnType<typeof buildEnvelope>, logger = buildLogger()) {
  const normalizeSendSpy = vi.spyOn(env.NORMALIZE_RUN_QUEUE, 'send')
  const deriveSendSpy = vi.spyOn(env.DERIVE_RUN_QUEUE, 'send')
  normalizeSendSpy.mockClear()
  deriveSendSpy.mockClear()

  const response = await sendUploadRequest(envelope)
  expect(response.status).toBe(202)

  const normalizeMessageBody = normalizeSendSpy.mock.calls.at(-1)?.[0]
  const normalizeMessage = buildQueueMessage(normalizeMessageBody)
  await handleNormalizeRunMessage(normalizeMessage, env, logger)

  const deriveMessageBody = deriveSendSpy.mock.calls.at(-1)?.[0]
  const deriveMessage = buildQueueMessage(deriveMessageBody)
  await handleDeriveRunMessage(deriveMessage, env, logger)

  return {
    normalizeMessageBody,
    deriveMessageBody,
  }
}

function buildQueueMessage(body: unknown) {
  return {
    id: 'msg-1',
    attempts: 1,
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  }
}

function buildLogger() {
  return {
    error: vi.fn(),
    warn: vi.fn(),
  }
}

async function sendUploadRequest(
  envelope: ReturnType<typeof buildEnvelope>,
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
      body: JSON.stringify(envelope),
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

function buildArtifact({
  generatedAt = '2026-04-06T12:00:00.000Z',
  chunkFileName = 'assets/main.js',
  cssFileName = 'assets/main.css',
  chunkSizes = {
    raw: 123,
    gzip: 45,
    brotli: 38,
  },
  cssSizes = {
    raw: 10,
    gzip: 8,
    brotli: 6,
  },
}: {
  chunkFileName?: string
  chunkSizes?: { brotli: number; gzip: number; raw: number }
  cssFileName?: string
  cssSizes?: { brotli: number; gzip: number; raw: number }
  generatedAt?: string
} = {}) {
  return {
    schemaVersion: 1,
    pluginVersion: '0.1.0',
    generatedAt,
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
            file: chunkFileName,
            src: 'src/main.ts',
            isEntry: true,
            css: [cssFileName],
          },
        },
        chunks: [
          {
            fileName: chunkFileName,
            name: 'main',
            isEntry: true,
            isDynamicEntry: false,
            facadeModuleId: '/tmp/repo/src/main.ts',
            imports: [],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: [cssFileName],
            importedAssets: [],
            modules: [
              {
                rawId: '/tmp/repo/src/main.ts',
                renderedLength: chunkSizes.raw,
                originalLength: 456,
              },
            ],
            sizes: chunkSizes,
          },
        ],
        assets: [
          {
            fileName: cssFileName,
            names: ['main.css'],
            needsCodeReference: false,
            sizes: cssSizes,
          },
        ],
        warnings: [],
      },
    ],
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
      workflowRunAttempt: 1,
      job: 'build',
      actionVersion: 'v1',
    },
    ...overrides,
  }
}

function size(raw: number, gzip: number, brotli: number) {
  return { raw, gzip, brotli }
}
