import {
  createExecutionContext,
  introspectWorkflow,
  waitOnExecutionContext,
} from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as githubApi from '../src/github-api.js'
import {
  dispatchQueueMessage,
  TEST_QUEUE_NAMES,
} from './queue-test-helpers.js'

const baseSha = '0123456789abcdef0123456789abcdef01234567'
const prHeadSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GitHub publication worker', () => {
  it('publishes one maintained PR comment and one aggregate check', async () => {
    const harness = createPipelineHarness()

    await seedPrComparison(harness)

    const pullRequest = await getPullRequestRow()
    expect(pullRequest).toBeTruthy()

    const createAccessTokenSpy = vi
      .spyOn(githubApi, 'createGithubInstallationAccessToken')
      .mockResolvedValue('installation-token')
    const requests: Array<{ body: unknown; method: string; url: string }> = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = toRequestUrl(input)
      const method = init?.method ?? 'GET'
      const bodyText = typeof init?.body === 'string' ? init.body : null
      requests.push({
        body: bodyText ? JSON.parse(bodyText) : null,
        method,
        url,
      })

      if (url.endsWith('/issues/42/comments?per_page=100') && method === 'GET') {
        return Response.json([])
      }

      if (url.endsWith('/issues/42/comments') && method === 'POST') {
        return Response.json({
          body: JSON.parse(bodyText ?? '{}').body,
          html_url: 'https://github.com/acme/widget/issues/42#issuecomment-101',
          id: 101,
          node_id: 'IC_kwDOA',
        })
      }

      if (url.endsWith('/check-runs') && method === 'POST') {
        return Response.json({
          html_url: 'https://github.com/acme/widget/runs/202',
          id: 202,
          node_id: 'CR_kwDOA',
        })
      }

      throw new Error(`Unexpected GitHub request: ${method} ${url}`)
    })

    const result = await dispatchQueueMessage(
      TEST_QUEUE_NAMES.publishGithub,
      buildPublishGithubMessage(pullRequest, 'publish-github:initial:v1'),
    )

    expect(result).toBeAcknowledged()
    expect(createAccessTokenSpy).toHaveBeenCalledOnce()
    expect(requests).toHaveLength(3)

    const commentRequest = requests.find((request) => request.url.endsWith('/issues/42/comments'))
    expect(commentRequest).toBeTruthy()
    expect(commentRequest?.body).toEqual(
      expect.objectContaining({
        body: expect.stringContaining('Bundle review: passing'),
      }),
    )
    expect(commentRequest?.body).toEqual(
      expect.objectContaining({
        body: expect.stringContaining('1 regression'),
      }),
    )
    expect(commentRequest?.body).toEqual(
      expect.objectContaining({
        body: expect.stringContaining('[Open PR diff](https://bundle.test/r/acme/widget/compare?pr=42&base=0123456789abcdef0123456789abcdef01234567&head=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)'),
      }),
    )
    expect(commentRequest?.body).toEqual(
      expect.objectContaining({
        body: expect.stringContaining('scenario-pr  [regression]'),
      }),
    )
    expect(commentRequest?.body).toEqual(
      expect.objectContaining({
        body: expect.stringContaining('<!-- bundle-review:pr:'),
      }),
    )

    const checkRequest = requests.find((request) => request.url.endsWith('/check-runs'))
    expect(checkRequest?.body).toEqual(
      expect.objectContaining({
        conclusion: 'success',
        details_url: 'https://bundle.test/r/acme/widget/compare?pr=42&base=0123456789abcdef0123456789abcdef01234567&head=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        name: 'Bundle Review',
        status: 'completed',
      }),
    )

    const publications = await listGithubPublications()
    expect(publications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          external_publication_id: '101',
          status: 'published',
          surface: 'pr-comment',
        }),
        expect.objectContaining({
          external_publication_id: '202',
          status: 'published',
          surface: 'pr-check',
        }),
      ]),
    )
  })

  it('updates the maintained comment and check in place after a rerun changes the summary', async () => {
    const harness = createPipelineHarness()

    await seedPrComparison(harness)

    const pullRequest = await getPullRequestRow()
    expect(pullRequest).toBeTruthy()

    vi.spyOn(githubApi, 'createGithubInstallationAccessToken').mockResolvedValue('installation-token')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    fetchSpy.mockImplementationOnce(async () => Response.json([]))
    fetchSpy.mockImplementationOnce(async (input, init) =>
      Response.json({
        body: JSON.parse(String(init?.body)).body,
        html_url: 'https://github.com/acme/widget/issues/42#issuecomment-101',
        id: 101,
        node_id: 'IC_kwDOA',
      }),
    )
    fetchSpy.mockImplementationOnce(async () =>
      Response.json({
        html_url: 'https://github.com/acme/widget/runs/202',
        id: 202,
        node_id: 'CR_kwDOA',
      }),
    )

    const firstPublish = await dispatchQueueMessage(
      TEST_QUEUE_NAMES.publishGithub,
      buildPublishGithubMessage(pullRequest, 'publish-github:first:v1'),
    )
    expect(firstPublish).toBeAcknowledged()

    fetchSpy.mockClear()

    await harness.acceptUpload(
      buildEnvelope({
        artifact: buildSimpleArtifact({
          scenarioId: 'scenario-pr',
          chunkSizes: size(190, 45, 38),
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
        ci: buildCiContext('5602'),
      }),
    )
    await harness.processAll()

    const patchRequests: Array<{ body: unknown; method: string; url: string }> = []
    fetchSpy.mockImplementation(async (input, init) => {
      const url = toRequestUrl(input)
      const method = init?.method ?? 'GET'
      patchRequests.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        method,
        url,
      })

      if (url.endsWith('/issues/comments/101') && method === 'PATCH') {
        return Response.json({
          body: JSON.parse(String(init?.body)).body,
          html_url: 'https://github.com/acme/widget/issues/42#issuecomment-101',
          id: 101,
          node_id: 'IC_kwDOA',
        })
      }

      if (url.endsWith('/check-runs/202') && method === 'PATCH') {
        return Response.json({
          html_url: 'https://github.com/acme/widget/runs/202',
          id: 202,
          node_id: 'CR_kwDOA',
        })
      }

      throw new Error(`Unexpected GitHub request: ${method} ${url}`)
    })

    const secondPublish = await dispatchQueueMessage(
      TEST_QUEUE_NAMES.publishGithub,
      buildPublishGithubMessage(pullRequest, 'publish-github:second:v1'),
    )
    expect(secondPublish).toBeAcknowledged()
    expect(patchRequests).toHaveLength(2)
    expect(patchRequests[0]).toEqual(
      expect.objectContaining({
        method: 'PATCH',
        url: expect.stringContaining('/issues/comments/101'),
      }),
    )
    expect(patchRequests[1]).toEqual(
      expect.objectContaining({
        method: 'PATCH',
        url: expect.stringContaining('/check-runs/202'),
      }),
    )
  })

  it('persists terminal GitHub publication failures', async () => {
    const harness = createPipelineHarness()

    await seedPrComparison(harness)

    const pullRequest = await getPullRequestRow()
    expect(pullRequest).toBeTruthy()

    vi.spyOn(githubApi, 'createGithubInstallationAccessToken').mockResolvedValue('installation-token')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = toRequestUrl(input)
      const method = init?.method ?? 'GET'

      if (url.endsWith('/issues/42/comments?per_page=100') && method === 'GET') {
        return Response.json([])
      }

      if (url.endsWith('/issues/42/comments') && method === 'POST') {
        return Response.json(
          {
            message: 'Resource not accessible by integration',
          },
          {
            status: 403,
          },
        )
      }

      throw new Error(`Unexpected GitHub request: ${method} ${url}`)
    })

    const result = await dispatchQueueMessage(
      TEST_QUEUE_NAMES.publishGithub,
      buildPublishGithubMessage(pullRequest, 'publish-github:terminal-failure:v1'),
    )

    expect(result).toBeAcknowledged()

    const publications = await listGithubPublications()
    expect(publications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          last_error_code: 'github_api_403',
          status: 'failed',
          surface: 'pr-comment',
        }),
      ]),
    )
  })

  it('publishes an in-progress check while the PR summary is still pending', async () => {
    const harness = createPipelineHarness()

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
        ci: buildCiContext('5800'),
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
        ci: buildCiContext('5801'),
      }),
    )
    await harness.drainRefresh()

    const pullRequest = await getPullRequestRow()
    expect(pullRequest).toBeTruthy()

    vi.spyOn(githubApi, 'createGithubInstallationAccessToken').mockResolvedValue('installation-token')
    const requests: Array<{ body: unknown; method: string; url: string }> = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = toRequestUrl(input)
      const method = init?.method ?? 'GET'
      const bodyText = typeof init?.body === 'string' ? init.body : null
      requests.push({
        body: bodyText ? JSON.parse(bodyText) : null,
        method,
        url,
      })

      if (url.endsWith('/issues/42/comments?per_page=100') && method === 'GET') {
        return Response.json([])
      }

      if (url.endsWith('/issues/42/comments') && method === 'POST') {
        return Response.json({
          body: JSON.parse(bodyText ?? '{}').body,
          html_url: 'https://github.com/acme/widget/issues/42#issuecomment-101',
          id: 101,
          node_id: 'IC_kwDOA',
        })
      }

      if (url.endsWith('/check-runs') && method === 'POST') {
        return Response.json({
          html_url: 'https://github.com/acme/widget/runs/202',
          id: 202,
          node_id: 'CR_kwDOA',
        })
      }

      throw new Error(`Unexpected GitHub request: ${method} ${url}`)
    })

    const result = await dispatchQueueMessage(
      TEST_QUEUE_NAMES.publishGithub,
      buildPublishGithubMessage(pullRequest, 'publish-github:pending-summary:v1'),
    )

    expect(result).toBeAcknowledged()

    const commentRequest = requests.find((request) => request.url.endsWith('/issues/42/comments'))
    expect(commentRequest?.body).toEqual(
      expect.objectContaining({
        body: expect.stringContaining('1 pending scenario'),
      }),
    )

    const checkRequest = requests.find((request) => request.url.endsWith('/check-runs'))
    expect(checkRequest?.body).toEqual(
      expect.objectContaining({
        status: 'in_progress',
      }),
    )
    expect(checkRequest?.body).not.toEqual(expect.objectContaining({ conclusion: expect.anything() }))
  })

  it('retries when the GitHub App private key cannot be parsed', async () => {
    const harness = createPipelineHarness()

    await seedPrComparison(harness)

    const pullRequest = await getPullRequestRow()
    expect(pullRequest).toBeTruthy()

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('fetch should not be called when app key parsing fails')
    })

    const result = await dispatchQueueMessage(
      TEST_QUEUE_NAMES.publishGithub,
      buildPublishGithubMessage(pullRequest, 'publish-github:invalid-private-key:v1'),
    )

    expect(result).toBeRetried()
    expect(await listGithubPublications()).toEqual([])
  })

  it('does not republish unchanged GitHub surfaces', async () => {
    const harness = createPipelineHarness()

    await seedPrComparison(harness)

    const pullRequest = await getPullRequestRow()
    expect(pullRequest).toBeTruthy()

    const createAccessTokenSpy = vi
      .spyOn(githubApi, 'createGithubInstallationAccessToken')
      .mockResolvedValue('installation-token')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    mockInitialCreateGithubResponses(fetchSpy)

    const firstPublish = await dispatchQueueMessage(
      TEST_QUEUE_NAMES.publishGithub,
      buildPublishGithubMessage(pullRequest, 'publish-github:no-op-first:v1'),
    )
    expect(firstPublish).toBeAcknowledged()

    createAccessTokenSpy.mockClear()
    fetchSpy.mockClear()

    const secondPublish = await dispatchQueueMessage(
      TEST_QUEUE_NAMES.publishGithub,
      buildPublishGithubMessage(pullRequest, 'publish-github:no-op-second:v1'),
    )

    expect(secondPublish).toBeAcknowledged()
    expect(createAccessTokenSpy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('retries retryable GitHub failures and records failure state', async () => {
    const harness = createPipelineHarness()

    await seedPrComparison(harness)

    const pullRequest = await getPullRequestRow()
    expect(pullRequest).toBeTruthy()

    vi.spyOn(githubApi, 'createGithubInstallationAccessToken').mockResolvedValue('installation-token')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = toRequestUrl(input)
      const method = init?.method ?? 'GET'

      if (url.endsWith('/issues/42/comments?per_page=100') && method === 'GET') {
        return Response.json([])
      }

      if (url.endsWith('/issues/42/comments') && method === 'POST') {
        return Response.json(
          {
            message: 'GitHub is temporarily unavailable',
          },
          {
            status: 503,
          },
        )
      }

      throw new Error(`Unexpected GitHub request: ${method} ${url}`)
    })

    const result = await dispatchQueueMessage(
      TEST_QUEUE_NAMES.publishGithub,
      buildPublishGithubMessage(pullRequest, 'publish-github:retryable-failure:v1'),
    )

    expect(result).toBeRetried()

    const publications = await listGithubPublications()
    expect(publications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          last_error_code: 'github_api_503',
          status: 'failed',
          surface: 'pr-comment',
        }),
      ]),
    )
  })

  it('recovers a stale comment id by locating the maintained comment marker', async () => {
    const harness = createPipelineHarness()

    await seedPrComparison(harness)

    const pullRequest = await getPullRequestRow()
    expect(pullRequest).toBeTruthy()

    vi.spyOn(githubApi, 'createGithubInstallationAccessToken').mockResolvedValue('installation-token')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    mockInitialCreateGithubResponses(fetchSpy)

    const firstPublish = await dispatchQueueMessage(
      TEST_QUEUE_NAMES.publishGithub,
      buildPublishGithubMessage(pullRequest, 'publish-github:stale-comment-first:v1'),
    )
    expect(firstPublish).toBeAcknowledged()

    await env.DB.prepare(
      `UPDATE github_publications
       SET external_publication_id = ?, payload_hash = ?, updated_at = ?
       WHERE surface = 'pr-comment'`,
    )
      .bind('999', 'stale-hash', '2026-04-06T12:45:00.000Z')
      .run()

    fetchSpy.mockClear()
    const requests: Array<{ method: string; url: string }> = []
    fetchSpy.mockImplementation(async (input, init) => {
      const url = toRequestUrl(input)
      const method = init?.method ?? 'GET'
      requests.push({ method, url })

      if (url.endsWith('/issues/comments/999') && method === 'PATCH') {
        return Response.json({ message: 'Not Found' }, { status: 404 })
      }

      if (url.endsWith('/issues/42/comments?per_page=100') && method === 'GET') {
        return Response.json([
          {
            body: `old body\n\n<!-- bundle-review:pr:${pullRequest?.id} -->`,
            html_url: 'https://github.com/acme/widget/issues/42#issuecomment-101',
            id: 101,
            node_id: 'IC_kwDOA',
          },
        ])
      }

      if (url.endsWith('/issues/comments/101') && method === 'PATCH') {
        return Response.json({
          body: JSON.parse(String(init?.body)).body,
          html_url: 'https://github.com/acme/widget/issues/42#issuecomment-101',
          id: 101,
          node_id: 'IC_kwDOA',
        })
      }

      throw new Error(`Unexpected GitHub request: ${method} ${url}`)
    })

    const secondPublish = await dispatchQueueMessage(
      TEST_QUEUE_NAMES.publishGithub,
      buildPublishGithubMessage(pullRequest, 'publish-github:stale-comment-second:v1'),
    )

    expect(secondPublish).toBeAcknowledged()
    expect(requests).toEqual([
      { method: 'PATCH', url: 'https://api.github.com/repos/acme/widget/issues/comments/999' },
      { method: 'GET', url: 'https://api.github.com/repos/acme/widget/issues/42/comments?per_page=100' },
      { method: 'PATCH', url: 'https://api.github.com/repos/acme/widget/issues/comments/101' },
    ])

    const commentPublication = await getGithubPublication('pr-comment')
    expect(commentPublication?.external_publication_id).toBe('101')
    expect(commentPublication?.status).toBe('published')
  })

  it('recreates a check run when the stored check id is stale', async () => {
    const harness = createPipelineHarness()

    await seedPrComparison(harness)

    const pullRequest = await getPullRequestRow()
    expect(pullRequest).toBeTruthy()

    vi.spyOn(githubApi, 'createGithubInstallationAccessToken').mockResolvedValue('installation-token')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    mockInitialCreateGithubResponses(fetchSpy)

    const firstPublish = await dispatchQueueMessage(
      TEST_QUEUE_NAMES.publishGithub,
      buildPublishGithubMessage(pullRequest, 'publish-github:stale-check-first:v1'),
    )
    expect(firstPublish).toBeAcknowledged()

    await env.DB.prepare(
      `UPDATE github_publications
       SET external_publication_id = ?, payload_hash = ?, updated_at = ?
       WHERE surface = 'pr-check'`,
    )
      .bind('999', 'stale-hash', '2026-04-06T12:45:00.000Z')
      .run()

    fetchSpy.mockClear()
    const requests: Array<{ method: string; url: string }> = []
    fetchSpy.mockImplementation(async (input, init) => {
      const url = toRequestUrl(input)
      const method = init?.method ?? 'GET'
      requests.push({ method, url })

      if (url.endsWith('/check-runs/999') && method === 'PATCH') {
        return Response.json({ message: 'Not Found' }, { status: 404 })
      }

      if (url.endsWith('/check-runs') && method === 'POST') {
        return Response.json({
          html_url: 'https://github.com/acme/widget/runs/303',
          id: 303,
          node_id: 'CR_kwDOB',
        })
      }

      throw new Error(`Unexpected GitHub request: ${method} ${url}`)
    })

    const secondPublish = await dispatchQueueMessage(
      TEST_QUEUE_NAMES.publishGithub,
      buildPublishGithubMessage(pullRequest, 'publish-github:stale-check-second:v1'),
    )

    expect(secondPublish).toBeAcknowledged()
    expect(requests).toEqual([
      { method: 'PATCH', url: 'https://api.github.com/repos/acme/widget/check-runs/999' },
      { method: 'POST', url: 'https://api.github.com/repos/acme/widget/check-runs' },
    ])

    const checkPublication = await getGithubPublication('pr-check')
    expect(checkPublication?.external_publication_id).toBe('303')
    expect(checkPublication?.status).toBe('published')
  })

  it('runs the debounce workflow before enqueueing publish-github', async () => {
    const publishSendSpy = vi.spyOn(env.PUBLISH_GITHUB_QUEUE, 'send')
    publishSendSpy.mockClear()

    await using introspector = await introspectWorkflow(env.PR_PUBLISH_DEBOUNCE_WORKFLOW)
    await introspector.modifyAll(async (modifier) => {
      await modifier.disableSleeps()
    })

    const harness = createPipelineHarness()

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
        ci: buildCiContext('5700'),
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
        ci: buildCiContext('5701'),
      }),
    )
    await harness.drainRefresh()

    const instances = await introspector.get()
    expect(instances).toHaveLength(1)
    await expect(instances[0]?.waitForStatus('complete')).resolves.not.toThrow()
    expect(publishSendSpy).toHaveBeenCalledTimes(1)
    expect(publishSendSpy.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        kind: 'publish-github',
        pullRequestId: expect.any(String),
        repositoryId: expect.any(String),
      }),
    )
  })
})

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
      ci: buildCiContext('5600'),
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
      ci: buildCiContext('5601'),
    }),
  )
  await harness.processAll()
}

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
    drainRefresh,
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
      const result = await dispatchQueueMessage(TEST_QUEUE_NAMES.scheduleComparisons, scheduleMessageBody)
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

async function getPullRequestRow() {
  return env.DB.prepare(
    `SELECT id, repository_id
     FROM pull_requests
     WHERE pr_number = 42
     LIMIT 1`,
  ).first<{
    id: string
    repository_id: string
  }>()
}

async function listGithubPublications() {
  const result = await env.DB.prepare(
    `SELECT surface, status, external_publication_id, last_error_code
     FROM github_publications
     ORDER BY surface ASC`,
  ).all<{
    external_publication_id: string | null
    last_error_code: string | null
    status: string
    surface: string
  }>()

  return result.results
}

async function getGithubPublication(surface: string) {
  return env.DB.prepare(
    `SELECT surface, status, external_publication_id
     FROM github_publications
     WHERE surface = ?
     LIMIT 1`,
  ).bind(surface).first<{
    external_publication_id: string | null
    status: string
    surface: string
  }>()
}

function buildPublishGithubMessage(
  pullRequest: { id: string; repository_id: string } | null | undefined,
  dedupeKey: string,
) {
  return {
    schemaVersion: 1,
    kind: 'publish-github',
    repositoryId: pullRequest?.repository_id ?? '',
    pullRequestId: pullRequest?.id ?? '',
    dedupeKey,
  } as const
}

function mockInitialCreateGithubResponses(fetchSpy: ReturnType<typeof vi.spyOn>) {
  fetchSpy.mockImplementationOnce(async () => Response.json([]))
  fetchSpy.mockImplementationOnce(async (_input: Request | string | URL, init?: RequestInit) =>
    Response.json({
      body: JSON.parse(String(init?.body)).body,
      html_url: 'https://github.com/acme/widget/issues/42#issuecomment-101',
      id: 101,
      node_id: 'IC_kwDOA',
    }),
  )
  fetchSpy.mockImplementationOnce(async () =>
    Response.json({
      html_url: 'https://github.com/acme/widget/runs/202',
      id: 202,
      node_id: 'CR_kwDOA',
    }),
  )
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

function toRequestUrl(input: Request | string | URL) {
  if (typeof input === 'string') {
    return input
  }

  return input instanceof URL ? input.toString() : input.url
}
