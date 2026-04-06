import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'

import { handleDeriveRunMessage } from '../src/derive-runs.js'
import { handleMaterializeComparisonMessage } from '../src/materialize-comparison.js'
import { handleNormalizeRunMessage } from '../src/normalize-runs.js'
import { handleScheduleComparisonsMessage } from '../src/schedule-comparisons.js'

const baseSha = '0123456789abcdef0123456789abcdef01234567'
const nextSha = '1111111111111111111111111111111111111111'
const laterBaseSha = '2222222222222222222222222222222222222222'
const prHeadSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

describe('comparison and budget jobs', () => {
  it('stores a no-baseline branch comparison for the first processed series', async () => {
    const logger = buildLogger()
    const result = await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: baseSha,
          branch: 'main',
        },
        ci: buildCiContext('1000'),
      }),
      logger,
    )

    expect(result.materializeMessageBodies).toHaveLength(0)

    const comparison = await env.DB.prepare(
      `SELECT
         kind,
         status,
         requested_head_sha,
         selected_head_commit_sha,
         selected_base_commit_sha,
         budget_state
       FROM comparisons
       LIMIT 1`,
    ).first<{
      budget_state: string
      kind: string
      requested_head_sha: string
      selected_base_commit_sha: string | null
      selected_head_commit_sha: string
      status: string
    }>()

    expect(comparison).toEqual({
      kind: 'branch-previous',
      status: 'no-baseline',
      requested_head_sha: baseSha,
      selected_head_commit_sha: baseSha,
      selected_base_commit_sha: null,
      budget_state: 'not-configured',
    })
    expect(await countRows('comparisons')).toBe(1)
    expect(await countRows('budget_results')).toBe(0)
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('materializes branch comparisons with stable-identity summaries and no-op budget state', async () => {
    const logger = buildLogger()

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: baseSha,
          branch: 'main',
        },
        ci: buildCiContext('1000'),
        artifact: buildSplitBaseArtifact(),
      }),
      logger,
    )

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: nextSha,
          branch: 'main',
        },
        ci: buildCiContext('1001'),
        artifact: buildSplitHeadArtifact(),
      }),
      logger,
    )

    const comparison = await env.DB.prepare(
      `SELECT
         status,
         selected_base_commit_sha,
         current_total_raw_bytes,
         baseline_total_raw_bytes,
         delta_total_raw_bytes,
         selected_entrypoint_relation,
         stable_identity_summary_json,
         has_degraded_stable_identity,
         budget_state
       FROM comparisons
       WHERE kind = 'branch-previous' AND selected_head_commit_sha = ?`,
    ).bind(nextSha).first<{
      baseline_total_raw_bytes: number | null
      budget_state: string
      current_total_raw_bytes: number
      delta_total_raw_bytes: number | null
      has_degraded_stable_identity: number
      selected_base_commit_sha: string | null
      selected_entrypoint_relation: string | null
      stable_identity_summary_json: string | null
      status: string
    }>()

    const stableIdentitySummary = comparison?.stable_identity_summary_json
      ? JSON.parse(comparison.stable_identity_summary_json)
      : null

    expect(comparison).toMatchObject({
      status: 'materialized',
      selected_base_commit_sha: baseSha,
      current_total_raw_bytes: 162,
      baseline_total_raw_bytes: 133,
      delta_total_raw_bytes: 29,
      selected_entrypoint_relation: 'same',
      has_degraded_stable_identity: 0,
      budget_state: 'not-configured',
    })
    expect(stableIdentitySummary).toMatchObject({
      selectedEntrypoint: {
        relation: 'same',
      },
      entries: {
        sameCount: 1,
      },
      sharedChunks: {
        splitCount: 1,
      },
      css: {
        splitCount: 1,
      },
      degraded: {
        totalCount: 0,
      },
    })
    expect(await countRows('budget_results')).toBe(0)
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('keeps PR baseline selection anchored to runs available when the head uploaded', async () => {
    const logger = buildLogger()

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: baseSha,
          branch: 'main',
        },
        ci: buildCiContext('2000'),
        artifact: buildSimpleArtifact({
          generatedAt: '2026-04-06T12:00:00.000Z',
        }),
      }),
      logger,
    )

    const prResult = await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: prHeadSha,
          branch: 'feature/login',
        },
        pullRequest: {
          number: 42,
          baseSha,
          baseRef: 'main',
          headSha: prHeadSha,
          headRef: 'feature/login',
        },
        ci: buildCiContext('2001'),
        artifact: buildSimpleArtifact({
          generatedAt: '2026-04-06T12:10:00.000Z',
          chunkFileName: 'assets/main-pr.js',
          cssFileName: 'assets/main-pr.css',
          chunkSizes: size(140, 50, 40),
          cssSizes: size(11, 8, 6),
        }),
      }),
      logger,
    )

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: laterBaseSha,
          branch: 'main',
        },
        ci: buildCiContext('2002'),
        artifact: buildSimpleArtifact({
          generatedAt: '2026-04-06T12:20:00.000Z',
          chunkFileName: 'assets/main-late.js',
          cssFileName: 'assets/main-late.css',
          chunkSizes: size(170, 61, 48),
          cssSizes: size(14, 10, 8),
        }),
      }),
      logger,
    )

    const materializeSendSpy = vi.spyOn(env.MATERIALIZE_COMPARISON_QUEUE, 'send')
    materializeSendSpy.mockClear()

    for (const scheduleMessageBody of prResult.scheduleMessageBodies) {
      await handleScheduleComparisonsMessage(buildQueueMessage(scheduleMessageBody), env, logger)
    }

    for (const materializeMessageBody of materializeSendSpy.mock.calls.map((call) => call[0])) {
      await handleMaterializeComparisonMessage(buildQueueMessage(materializeMessageBody), env, logger)
    }

    const comparison = await env.DB.prepare(
      `SELECT
         status,
         requested_base_sha,
         selected_base_commit_sha,
         selected_head_commit_sha,
         budget_state
       FROM comparisons
       WHERE kind = 'pr-base' AND selected_head_commit_sha = ?`,
    ).bind(prHeadSha).first<{
      budget_state: string
      requested_base_sha: string | null
      selected_base_commit_sha: string | null
      selected_head_commit_sha: string
      status: string
    }>()

    expect(comparison).toEqual({
      status: 'materialized',
      requested_base_sha: baseSha,
      selected_base_commit_sha: baseSha,
      selected_head_commit_sha: prHeadSha,
      budget_state: 'not-configured',
    })
    expect(comparison?.selected_base_commit_sha).not.toBe(laterBaseSha)
    expect(await countRows('comparisons')).toBe(4)
    expect(await countRows('budget_results')).toBe(0)
    expect(logger.error).not.toHaveBeenCalled()
  })
})

async function processEnvelope(envelope: ReturnType<typeof buildEnvelope>, logger = buildLogger()) {
  const normalizeSendSpy = vi.spyOn(env.NORMALIZE_RUN_QUEUE, 'send')
  const deriveSendSpy = vi.spyOn(env.DERIVE_RUN_QUEUE, 'send')
  const scheduleSendSpy = vi.spyOn(env.SCHEDULE_COMPARISONS_QUEUE, 'send')
  const materializeSendSpy = vi.spyOn(env.MATERIALIZE_COMPARISON_QUEUE, 'send')
  normalizeSendSpy.mockClear()
  deriveSendSpy.mockClear()
  scheduleSendSpy.mockClear()
  materializeSendSpy.mockClear()

  const response = await sendUploadRequest(envelope)
  expect(response.status).toBe(202)

  const normalizeMessageBody = normalizeSendSpy.mock.calls.at(-1)?.[0]
  const normalizeMessage = buildQueueMessage(normalizeMessageBody)
  await handleNormalizeRunMessage(normalizeMessage, env, logger)

  const deriveMessageBody = deriveSendSpy.mock.calls.at(-1)?.[0]
  const deriveMessage = buildQueueMessage(deriveMessageBody)
  await handleDeriveRunMessage(deriveMessage, env, logger)

  const scheduleMessageBodies = scheduleSendSpy.mock.calls.map((call) => call[0])

  for (const scheduleMessageBody of scheduleMessageBodies) {
    await handleScheduleComparisonsMessage(buildQueueMessage(scheduleMessageBody), env, logger)
  }

  const materializeMessageBodies = materializeSendSpy.mock.calls.map((call) => call[0])

  for (const materializeMessageBody of materializeMessageBodies) {
    await handleMaterializeComparisonMessage(buildQueueMessage(materializeMessageBody), env, logger)
  }

  return {
    scheduleMessageBodies,
    materializeMessageBodies,
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

function buildEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    artifact: buildSimpleArtifact(),
    repository: {
      githubRepoId: 123,
      owner: 'acme',
      name: 'widget',
      installationId: 456,
    },
    git: {
      commitSha: baseSha,
      branch: 'main',
    },
    scenarioSource: {
      kind: 'fixture-app',
    },
    ci: buildCiContext('999'),
    ...overrides,
  }
}

function buildCiContext(workflowRunId: string) {
  return {
    provider: 'github-actions',
    workflowRunId,
    workflowRunAttempt: 1,
    job: 'build',
    actionVersion: 'v1',
  }
}

function buildSimpleArtifact({
  generatedAt = '2026-04-06T12:00:00.000Z',
  chunkFileName = 'assets/main.js',
  cssFileName = 'assets/main.css',
  chunkSizes = size(123, 45, 38),
  cssSizes = size(10, 8, 6),
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

function buildSplitBaseArtifact() {
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
            file: 'assets/main-old.js',
            src: 'src/main.ts',
            isEntry: true,
            imports: ['chunks/shared-old.js'],
            css: ['assets/main-old.css'],
          },
          'chunks/shared-old.js': {
            file: 'chunks/shared-old.js',
            css: ['assets/shared-old.css'],
          },
        },
        chunks: [
          {
            fileName: 'assets/main-old.js',
            name: 'main',
            isEntry: true,
            isDynamicEntry: false,
            facadeModuleId: '/tmp/repo/src/main.ts',
            imports: ['chunks/shared-old.js'],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: ['assets/main-old.css'],
            importedAssets: [],
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
            fileName: 'chunks/shared-old.js',
            name: 'shared',
            isEntry: false,
            isDynamicEntry: false,
            facadeModuleId: null,
            imports: [],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: ['assets/shared-old.css'],
            importedAssets: [],
            modules: [
              {
                rawId: '/tmp/repo/src/shared/format.ts',
                renderedLength: 60,
                originalLength: 70,
              },
              {
                rawId: '/tmp/repo/src/shared/view.ts',
                renderedLength: 40,
                originalLength: 50,
              },
            ],
            sizes: size(100, 40, 32),
          },
        ],
        assets: [
          {
            fileName: 'assets/main-old.css',
            names: ['main-old.css'],
            needsCodeReference: false,
            sizes: size(10, 8, 6),
          },
          {
            fileName: 'assets/shared-old.css',
            names: ['shared-old.css'],
            needsCodeReference: false,
            sizes: size(30, 10, 8),
          },
        ],
        warnings: [],
      },
    ],
  }
}

function buildSplitHeadArtifact() {
  return {
    schemaVersion: 1,
    pluginVersion: '0.1.0',
    generatedAt: '2026-04-06T12:10:00.000Z',
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
            file: 'assets/main-new.js',
            src: 'src/main.ts',
            isEntry: true,
            imports: ['chunks/route-format.js', 'chunks/route-ui.js'],
            css: ['assets/main-new.css'],
          },
          'chunks/route-format.js': {
            file: 'chunks/route-format.js',
            css: ['assets/route-format.css'],
          },
          'chunks/route-ui.js': {
            file: 'chunks/route-ui.js',
            css: ['assets/route-ui.css'],
          },
        },
        chunks: [
          {
            fileName: 'assets/main-new.js',
            name: 'main',
            isEntry: true,
            isDynamicEntry: false,
            facadeModuleId: '/tmp/repo/src/main.ts',
            imports: ['chunks/route-format.js', 'chunks/route-ui.js'],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: ['assets/main-new.css'],
            importedAssets: [],
            modules: [
              {
                rawId: '/tmp/repo/src/main.ts',
                renderedLength: 150,
                originalLength: 470,
              },
            ],
            sizes: size(150, 56, 46),
          },
          {
            fileName: 'chunks/route-format.js',
            name: 'route-format',
            isEntry: false,
            isDynamicEntry: false,
            facadeModuleId: null,
            imports: [],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: ['assets/route-format.css'],
            importedAssets: [],
            modules: [
              {
                rawId: '/tmp/repo/src/shared/format.ts',
                renderedLength: 60,
                originalLength: 70,
              },
            ],
            sizes: size(60, 24, 18),
          },
          {
            fileName: 'chunks/route-ui.js',
            name: 'route-ui',
            isEntry: false,
            isDynamicEntry: false,
            facadeModuleId: null,
            imports: [],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: ['assets/route-ui.css'],
            importedAssets: [],
            modules: [
              {
                rawId: '/tmp/repo/src/shared/view.ts',
                renderedLength: 40,
                originalLength: 50,
              },
            ],
            sizes: size(40, 16, 12),
          },
        ],
        assets: [
          {
            fileName: 'assets/main-new.css',
            names: ['main-new.css'],
            needsCodeReference: false,
            sizes: size(12, 9, 7),
          },
          {
            fileName: 'assets/route-format.css',
            names: ['route-format.css'],
            needsCodeReference: false,
            sizes: size(18, 7, 5),
          },
          {
            fileName: 'assets/route-ui.css',
            names: ['route-ui.css'],
            needsCodeReference: false,
            sizes: size(12, 5, 4),
          },
        ],
        warnings: [],
      },
    ],
  }
}

function size(raw: number, gzip: number, brotli: number) {
  return { raw, gzip, brotli }
}
