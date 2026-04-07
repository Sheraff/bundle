import { env } from 'cloudflare:workers'
import { normalizedSnapshotV1Schema } from '@workspace/contracts'
import { describe, expect, it, vi } from 'vitest'
import * as v from 'valibot'

import {
  dispatchQueueMessage,
  TEST_QUEUE_NAMES,
} from './queue-test-helpers.js'
import {
  buildArtifact,
  buildCiContext,
  type BuildEnvelopeOverrides,
  buildEnvelope as buildBaseEnvelope,
} from './support/builders.js'
import { sendUploadRequest } from './support/request-helpers.js'

const sha = '0123456789abcdef0123456789abcdef01234567'

describe('normalize-run queue handling', () => {
  it('writes a normalized snapshot and updates scenario-run metadata', async () => {
    const sendSpy = vi.spyOn(env.NORMALIZE_RUN_QUEUE, 'send')
    const deriveSendSpy = vi.spyOn(env.DERIVE_RUN_QUEUE, 'send')
    const response = await sendUploadRequest(buildEnvelope())

    expect(response.status).toBe(202)

    const result = await dispatchQueueMessage(TEST_QUEUE_NAMES.normalizeRun, sendSpy.mock.calls[0]?.[0])
    expect(result).toBeAcknowledged()

    const scenarioRun = await env.DB.prepare(
      `SELECT
        status,
        normalized_snapshot_r2_key,
        normalized_schema_version,
        normalization_started_at,
        normalized_at,
        failure_code,
        failure_message
      FROM scenario_runs
      LIMIT 1`,
    ).first<{
      failure_code: string | null
      failure_message: string | null
      normalization_started_at: string | null
      normalized_at: string | null
      normalized_schema_version: number | null
      normalized_snapshot_r2_key: string | null
      status: string
    }>()

    expect(scenarioRun).toBeTruthy()
    expect(scenarioRun?.status).toBe('processing')
    expect(scenarioRun?.normalized_schema_version).toBe(1)
    expect(scenarioRun?.normalization_started_at).toBeTruthy()
    expect(scenarioRun?.normalized_at).toBeTruthy()
    expect(scenarioRun?.normalized_snapshot_r2_key).toBeTruthy()
    expect(scenarioRun?.failure_code).toBeNull()
    expect(scenarioRun?.failure_message).toBeNull()

    const snapshotObject = await env.CACHE_BUCKET.get(scenarioRun!.normalized_snapshot_r2_key!)
    const snapshotText = await snapshotObject?.text()
    const snapshotResult = v.safeParse(
      normalizedSnapshotV1Schema,
      snapshotText ? JSON.parse(snapshotText) : null,
    )

    expect(snapshotResult.success).toBe(true)
    expect(snapshotObject?.httpMetadata?.contentType).toBe('application/json')
    expect(snapshotObject?.customMetadata?.schemaVersion).toBe('1')
    expect(snapshotObject?.customMetadata?.scenarioRunId).toBeTruthy()
    expect(deriveSendSpy).toHaveBeenCalledTimes(1)
    if (snapshotResult.success) {
      expect(snapshotResult.output.environments[0]?.entrypoints[0]?.key).toBe('src/main.ts')
      expect(snapshotResult.output.environments[0]?.assets[0]?.ownerRoots).toEqual(['src/main.ts'])
    }
  })

  it('synthesizes manifest-only entrypoints and propagates their owner roots', async () => {
    const sendSpy = vi.spyOn(env.NORMALIZE_RUN_QUEUE, 'send')
    const response = await sendUploadRequest(
      buildEnvelope({
        artifact: buildArtifact({
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
                  sizes: {
                    raw: 123,
                    gzip: 45,
                    brotli: 38,
                  },
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
                  sizes: {
                    raw: 45,
                    gzip: 20,
                    brotli: 18,
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
                {
                  fileName: 'assets/logo.svg',
                  names: ['logo.svg'],
                  needsCodeReference: false,
                  sizes: {
                    raw: 12,
                    gzip: 10,
                    brotli: 8,
                  },
                },
              ],
              warnings: [],
            },
          ],
        }),
      }),
    )

    expect(response.status).toBe(202)

    const result = await dispatchQueueMessage(TEST_QUEUE_NAMES.normalizeRun, sendSpy.mock.calls[0]?.[0])
    expect(result).toBeAcknowledged()

    const scenarioRun = await env.DB.prepare(
      'SELECT normalized_snapshot_r2_key FROM scenario_runs LIMIT 1',
    ).first<{
      normalized_snapshot_r2_key: string | null
    }>()

    const snapshotObject = await env.CACHE_BUCKET.get(scenarioRun!.normalized_snapshot_r2_key!)
    const snapshotText = await snapshotObject?.text()
    const snapshotResult = v.safeParse(
      normalizedSnapshotV1Schema,
      snapshotText ? JSON.parse(snapshotText) : null,
    )

    expect(snapshotResult.success).toBe(true)
    if (!snapshotResult.success) {
      return
    }

    const environment = snapshotResult.output.environments[0]!
    const entrypoint = environment.entrypoints.find((currentEntrypoint) => currentEntrypoint.key === 'index.html')
    const mainChunk = environment.chunks.find((chunk) => chunk.fileName === 'assets/main.js')
    const sharedChunk = environment.chunks.find((chunk) => chunk.fileName === 'assets/shared.js')
    const cssAsset = environment.assets.find((asset) => asset.fileName === 'assets/main.css')
    const logoAsset = environment.assets.find((asset) => asset.fileName === 'assets/logo.svg')

    expect(entrypoint).toEqual({
      key: 'index.html',
      kind: 'entry',
      chunkFileName: 'index.html',
      manifestSourceKeys: ['index.html'],
      facadeModule: null,
      importedCss: ['assets/main.css'],
      importedAssets: ['assets/logo.svg'],
      staticImportedChunkFileNames: ['assets/main.js'],
      dynamicImportedChunkFileNames: [],
    })
    expect(mainChunk?.ownerRoots).toEqual(['index.html'])
    expect(sharedChunk?.ownerRoots).toEqual(['index.html'])
    expect(cssAsset?.ownerRoots).toEqual(['index.html'])
    expect(logoAsset?.ownerRoots).toEqual(['index.html'])
  })

  it('marks the scenario run as failed when the raw artifact becomes invalid', async () => {
    const sendSpy = vi.spyOn(env.NORMALIZE_RUN_QUEUE, 'send')
    const response = await sendUploadRequest(buildEnvelope())

    expect(response.status).toBe(202)

    const scenarioRun = await env.DB.prepare(
      'SELECT raw_artifact_r2_key FROM scenario_runs LIMIT 1',
    ).first<{
      raw_artifact_r2_key: string
    }>()

    await env.RAW_UPLOADS_BUCKET.put(scenarioRun!.raw_artifact_r2_key, '{}', {
      httpMetadata: {
        contentType: 'application/json',
      },
    })

    const result = await dispatchQueueMessage(TEST_QUEUE_NAMES.normalizeRun, sendSpy.mock.calls[0]?.[0])
    expect(result).toBeAcknowledged()

    const failedRun = await env.DB.prepare(
      `SELECT status, failure_code, normalized_snapshot_r2_key, normalized_at
       FROM scenario_runs
       LIMIT 1`,
    ).first<{
      failure_code: string | null
      normalized_at: string | null
      normalized_snapshot_r2_key: string | null
      status: string
    }>()

    expect(failedRun).toEqual({
      status: 'failed',
      failure_code: 'invalid_raw_artifact',
      normalized_snapshot_r2_key: null,
      normalized_at: null,
    })
    expect((await env.CACHE_BUCKET.list()).objects).toHaveLength(0)
  })

  it('retries transient cache write failures and succeeds on a later run', async () => {
    const sendSpy = vi.spyOn(env.NORMALIZE_RUN_QUEUE, 'send')
    const response = await sendUploadRequest(buildEnvelope())

    expect(response.status).toBe(202)

    vi.spyOn(env.CACHE_BUCKET, 'put').mockRejectedValueOnce(new Error('cache unavailable'))

    const firstResult = await dispatchQueueMessage(TEST_QUEUE_NAMES.normalizeRun, sendSpy.mock.calls[0]?.[0])
    expect(firstResult).toBeRetried()

    const afterRetryRun = await env.DB.prepare(
      `SELECT status, failure_code, normalized_snapshot_r2_key, normalized_at
       FROM scenario_runs
       LIMIT 1`,
    ).first<{
      failure_code: string | null
      normalized_at: string | null
      normalized_snapshot_r2_key: string | null
      status: string
    }>()

    expect(afterRetryRun).toEqual({
      status: 'processing',
      failure_code: null,
      normalized_snapshot_r2_key: null,
      normalized_at: null,
    })

    const secondResult = await dispatchQueueMessage(TEST_QUEUE_NAMES.normalizeRun, sendSpy.mock.calls[0]?.[0])
    expect(secondResult).toBeAcknowledged()

    const normalizedRun = await env.DB.prepare(
      'SELECT normalized_snapshot_r2_key, normalized_at FROM scenario_runs LIMIT 1',
    ).first<{
      normalized_at: string | null
      normalized_snapshot_r2_key: string | null
    }>()

    expect(normalizedRun?.normalized_snapshot_r2_key).toBeTruthy()
    expect(normalizedRun?.normalized_at).toBeTruthy()
  })

  it('retries transient derive-queue failures without rewriting the snapshot', async () => {
    const sendSpy = vi.spyOn(env.NORMALIZE_RUN_QUEUE, 'send')
    const deriveSendSpy = vi
      .spyOn(env.DERIVE_RUN_QUEUE, 'send')
      .mockRejectedValueOnce(new Error('queue unavailable'))
    const response = await sendUploadRequest(buildEnvelope())

    expect(response.status).toBe(202)

    const firstResult = await dispatchQueueMessage(TEST_QUEUE_NAMES.normalizeRun, sendSpy.mock.calls[0]?.[0])
    expect(firstResult).toBeRetried()

    const afterRetryRun = await env.DB.prepare(
      `SELECT status, normalized_snapshot_r2_key, normalized_at
       FROM scenario_runs
       LIMIT 1`,
    ).first<{
      normalized_at: string | null
      normalized_snapshot_r2_key: string | null
      status: string
    }>()

    expect(afterRetryRun).toEqual({
      status: 'processing',
      normalized_snapshot_r2_key: expect.any(String),
      normalized_at: expect.any(String),
    })

    const putSpy = vi.spyOn(env.CACHE_BUCKET, 'put')
    putSpy.mockClear()

    const secondResult = await dispatchQueueMessage(TEST_QUEUE_NAMES.normalizeRun, sendSpy.mock.calls[0]?.[0])
    expect(secondResult).toBeAcknowledged()
    expect(deriveSendSpy).toHaveBeenCalledTimes(2)
    expect(putSpy).not.toHaveBeenCalled()
  })

  it('treats an already-normalized run as idempotent', async () => {
    const sendSpy = vi.spyOn(env.NORMALIZE_RUN_QUEUE, 'send')
    const response = await sendUploadRequest(buildEnvelope())

    expect(response.status).toBe(202)

    const initialResult = await dispatchQueueMessage(TEST_QUEUE_NAMES.normalizeRun, sendSpy.mock.calls[0]?.[0])
    expect(initialResult).toBeAcknowledged()

    const putSpy = vi.spyOn(env.CACHE_BUCKET, 'put')
    putSpy.mockClear()

    const secondResult = await dispatchQueueMessage(TEST_QUEUE_NAMES.normalizeRun, sendSpy.mock.calls[0]?.[0])
    expect(secondResult).toBeAcknowledged()
    expect(putSpy).not.toHaveBeenCalled()
  })

  it('acks invalid queue messages instead of retrying them', async () => {
    const result = await dispatchQueueMessage(TEST_QUEUE_NAMES.normalizeRun, {
      schemaVersion: 1,
      kind: 'normalize-run',
      repositoryId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      dedupeKey: 'normalize-run:test:v1',
    })
    expect(result).toBeAcknowledged()
  })
})

function buildEnvelope(overrides: BuildEnvelopeOverrides = {}) {
  return buildBaseEnvelope({
    git: {
      commitSha: sha,
      branch: 'main',
    },
    ci: buildCiContext('999', { workflowRunAttempt: 2 }),
    ...overrides,
  })
}
