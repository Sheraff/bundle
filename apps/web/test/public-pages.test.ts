import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { defaultStringifySearch } from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'

import {
  dispatchQueueMessage,
  TEST_QUEUE_NAMES,
} from './queue-test-helpers.js'

const baseSha = '0123456789abcdef0123456789abcdef01234567'
const headSha = '1111111111111111111111111111111111111111'
const prHeadSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const timestamp = '2026-04-07T12:00:00.000Z'

describe('public pages', () => {
  it('serves repository, scenario, and compare pages through the worker', async () => {
    const harness = createPipelineHarness()

    await harness.acceptUpload(
      buildEnvelope({
        git: {
          commitSha: baseSha,
          branch: 'main',
        },
        ci: buildCiContext('7000'),
      }),
    )
    await harness.processAll()

    await harness.acceptUpload(
      buildEnvelope({
        git: {
          commitSha: headSha,
          branch: 'main',
        },
        ci: buildCiContext('7001'),
      }),
    )
    await harness.processAll()

    const repositoryPage = await fetchPage(
      'https://bundle.test/r/acme/widget?lens=entry-js-direct-css',
    )
    expect(repositoryPage.status).toBe(200)
    expect(repositoryPage.headers.get('content-type')).toContain('text/html')
    expect(await repositoryPage.text()).toContain('Repository overview public page.')

    const scenarioPage = await fetchPage(
      'https://bundle.test/r/acme/widget/scenarios/fixture-app-cost?branch=main&env=all&entrypoint=all&lens=entry-js-direct-css',
    )
    const scenarioPageText = await scenarioPage.text()
    expect(scenarioPage.status).toBe(200)
    expect(scenarioPageText).toContain('Scenario public page.')

    const comparePage = await fetchPage(
      `https://bundle.test/r/acme/widget/compare${defaultStringifySearch({ base: baseSha, head: headSha })}`,
    )
    const comparePageText = await comparePage.text()
    expect(comparePage.status).toBe(200)
    expect(comparePageText).toContain('Compare')
    expect(comparePageText).toContain('fixture-app-cost')
  })

  it('serves the PR-scoped compare page through the worker', async () => {
    const harness = createPipelineHarness()

    await seedPrComparison(harness)

    const comparePage = await fetchPage(
      `https://bundle.test/r/acme/widget/compare${defaultStringifySearch({ pr: 42, base: baseSha, head: prHeadSha })}`,
    )
    const comparePageText = await comparePage.text()

    expect(comparePage.status).toBe(200)
    expect(comparePageText).toContain('PR Compare')
    expect(comparePageText).toContain('scenario-pr')
  })

  it('renders empty states when a repository and scenario exist without branch summaries yet', async () => {
    await insertRepository({
      id: 'repo-empty',
      githubRepoId: 999,
      installationId: 456,
      owner: 'acme',
      name: 'empty-widget',
    })
    await insertScenario({
      id: 'scenario-empty',
      repositoryId: 'repo-empty',
      slug: 'lonely-scenario',
      sourceKind: 'fixture-app',
    })

    const repositoryPage = await fetchPage(
      'https://bundle.test/r/acme/empty-widget?lens=entry-js-direct-css',
    )
    const repositoryPageText = await repositoryPage.text()

    expect(repositoryPage.status).toBe(200)
    expect(repositoryPageText).toContain('No branch data yet')
    expect(repositoryPageText).toContain('No settled branch summary is available yet.')

    const scenarioPage = await fetchPage(
      'https://bundle.test/r/acme/empty-widget/scenarios/lonely-scenario?env=all&entrypoint=all&lens=entry-js-direct-css',
    )
    const scenarioPageText = await scenarioPage.text()

    expect(scenarioPage.status).toBe(200)
    expect(scenarioPageText).toContain('No branch data yet')
    expect(scenarioPageText).toContain('No branch summary is available for this scenario yet.')
  })
})

function createPipelineHarness() {
  const normalizeSendSpy = vi.spyOn(env.NORMALIZE_RUN_QUEUE, 'send')
  const deriveSendSpy = vi.spyOn(env.DERIVE_RUN_QUEUE, 'send')
  const scheduleSendSpy = vi.spyOn(env.SCHEDULE_COMPARISONS_QUEUE, 'send')
  const materializeSendSpy = vi.spyOn(env.MATERIALIZE_COMPARISON_QUEUE, 'send')
  const refreshSendSpy = vi.spyOn(env.REFRESH_SUMMARIES_QUEUE, 'send')
  normalizeSendSpy.mockClear()
  deriveSendSpy.mockClear()
  scheduleSendSpy.mockClear()
  materializeSendSpy.mockClear()
  refreshSendSpy.mockClear()

  let normalizeIndex = 0
  let deriveIndex = 0
  let scheduleIndex = 0
  let materializeIndex = 0
  let refreshIndex = 0

  return {
    acceptUpload,
    processAll,
  }

  async function acceptUpload(envelope: ReturnType<typeof buildEnvelope>) {
    const response = await sendUploadRequest(envelope)
    expect(response.status).toBe(202)
    return response
  }

  async function drainRefresh() {
    while (refreshIndex < refreshSendSpy.mock.calls.length) {
      const refreshMessageBody = refreshSendSpy.mock.calls[refreshIndex]?.[0]
      refreshIndex += 1
      const result = await dispatchQueueMessage(TEST_QUEUE_NAMES.refreshSummaries, refreshMessageBody)
      expect(result).toBeAcknowledged()
    }
  }

  async function drainNormalize() {
    while (normalizeIndex < normalizeSendSpy.mock.calls.length) {
      const normalizeMessageBody = normalizeSendSpy.mock.calls[normalizeIndex]?.[0]
      normalizeIndex += 1
      const result = await dispatchQueueMessage(TEST_QUEUE_NAMES.normalizeRun, normalizeMessageBody)
      expect(result).toBeAcknowledged()
    }
  }

  async function drainDerive() {
    while (deriveIndex < deriveSendSpy.mock.calls.length) {
      const deriveMessageBody = deriveSendSpy.mock.calls[deriveIndex]?.[0]
      deriveIndex += 1
      const result = await dispatchQueueMessage(TEST_QUEUE_NAMES.deriveRun, deriveMessageBody)
      expect(result).toBeAcknowledged()
    }
  }

  async function drainSchedule() {
    while (scheduleIndex < scheduleSendSpy.mock.calls.length) {
      const scheduleMessageBody = scheduleSendSpy.mock.calls[scheduleIndex]?.[0]
      scheduleIndex += 1
      const result = await dispatchQueueMessage(
        TEST_QUEUE_NAMES.scheduleComparisons,
        scheduleMessageBody,
      )
      expect(result).toBeAcknowledged()
    }
  }

  async function drainMaterialize() {
    while (materializeIndex < materializeSendSpy.mock.calls.length) {
      const materializeMessageBody = materializeSendSpy.mock.calls[materializeIndex]?.[0]
      materializeIndex += 1
      const result = await dispatchQueueMessage(
        TEST_QUEUE_NAMES.materializeComparison,
        materializeMessageBody,
      )
      expect(result).toBeAcknowledged()
    }
  }

  async function processAll() {
    await drainRefresh()
    await drainNormalize()
    await drainDerive()
    await drainRefresh()
    await drainSchedule()
    await drainRefresh()
    await drainMaterialize()
    await drainRefresh()
  }
}

async function sendUploadRequest(
  envelope: ReturnType<typeof buildEnvelope>,
  token: string = env.BUNDLE_UPLOAD_TOKEN,
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

async function insertRepository(repository: {
  id: string
  githubRepoId: number
  installationId: number
  owner: string
  name: string
}) {
  await env.DB.prepare(
    `INSERT INTO repositories (id, github_repo_id, owner, name, installation_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      repository.id,
      repository.githubRepoId,
      repository.owner,
      repository.name,
      repository.installationId,
      timestamp,
      timestamp,
    )
    .run()
}

async function insertScenario(scenario: {
  id: string
  repositoryId: string
  slug: string
  sourceKind: string
}) {
  await env.DB.prepare(
    `INSERT INTO scenarios (id, repository_id, slug, source_kind, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(scenario.id, scenario.repositoryId, scenario.slug, scenario.sourceKind, timestamp, timestamp)
    .run()
}

async function fetchPage(url: string) {
  const executionContext = createExecutionContext()
  const worker = (exports as unknown as {
    default: {
      fetch: (request: Request, env: Cloudflare.Env, ctx: ExecutionContext) => Promise<Response>
    }
  }).default

  const response = await worker.fetch(new Request(url), env, executionContext)
  await waitOnExecutionContext(executionContext)
  return response
}

async function seedPrComparison(harness: ReturnType<typeof createPipelineHarness>) {
  await harness.acceptUpload(
    buildEnvelope({
      artifact: buildSimpleArtifact({
        scenarioId: 'scenario-pr',
        chunkSizes: size(123, 45, 38),
        cssSizes: size(10, 8, 6),
      }),
      git: {
        commitSha: baseSha,
        branch: 'main',
      },
      ci: buildCiContext('7600'),
    }),
  )
  await harness.processAll()

  await harness.acceptUpload(
    buildEnvelope({
      artifact: buildSimpleArtifact({
        scenarioId: 'scenario-pr',
        chunkSizes: size(150, 45, 38),
        cssSizes: size(10, 8, 6),
      }),
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
      ci: buildCiContext('7601'),
    }),
  )
  await harness.processAll()
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
      commitSha: headSha,
      branch: 'main',
    },
    scenarioSource: {
      kind: 'fixture-app',
    },
    ci: buildCiContext('7999'),
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
  scenarioId = 'fixture-app-cost',
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
  scenarioId?: string
} = {}) {
  return {
    schemaVersion: 1,
    pluginVersion: '0.1.0',
    generatedAt,
    scenario: {
      id: scenarioId,
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

function size(raw: number, gzip: number, brotli: number) {
  return { raw, gzip, brotli }
}
