import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, expect, vi } from 'vitest'

import { noopLogger, setAppLoggerForTesting } from '../src/logger.js'

interface QueueResultLike {
  ackAll: boolean
  retryBatch: {
    retry: boolean
    delaySeconds?: number
  }
  explicitAcks: string[]
  retryMessages: Array<{
    msgId: string
    delaySeconds?: number
  }>
}

expect.extend({
  toBeAcknowledged(this: { isNot: boolean }, received: QueueResultLike, messageId = 'message-1') {
    const pass =
      received.ackAll === false &&
      received.retryBatch.retry === false &&
      received.explicitAcks.length === 1 &&
      received.explicitAcks[0] === messageId &&
      received.retryMessages.length === 0

    return {
      pass,
      message: () =>
        `Expected queue result ${this.isNot ? 'not ' : ''}to acknowledge message ${messageId}.\nReceived: ${JSON.stringify(received)}`,
    }
  },
  toBeRetried(this: { isNot: boolean }, received: QueueResultLike, messageId = 'message-1') {
    const pass =
      received.ackAll === false &&
      received.retryBatch.retry === false &&
      received.explicitAcks.length === 0 &&
      received.retryMessages.length === 1 &&
      received.retryMessages[0]?.msgId === messageId

    return {
      pass,
      message: () =>
        `Expected queue result ${this.isNot ? 'not ' : ''}to retry message ${messageId}.\nReceived: ${JSON.stringify(received)}`,
    }
  },
})

beforeEach(async () => {
  setAppLoggerForTesting(noopLogger)

  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)

  for (const statement of [
    'DELETE FROM github_publications',
    'DELETE FROM pr_review_summaries',
    'DELETE FROM commit_group_summaries',
    'DELETE FROM acknowledgements',
    'DELETE FROM budget_results',
    'DELETE FROM comparisons',
    'DELETE FROM series_points',
    'DELETE FROM series',
    'DELETE FROM scenario_runs',
    'DELETE FROM commit_groups',
    'DELETE FROM pull_requests',
    'DELETE FROM scenarios',
    'DELETE FROM repositories',
  ]) {
    await env.DB.prepare(statement).run()
  }

  const listedObjects = await env.RAW_UPLOADS_BUCKET.list()

  for (const object of listedObjects.objects) {
    await env.RAW_UPLOADS_BUCKET.delete(object.key)
  }

  const listedCacheObjects = await env.CACHE_BUCKET.list()

  for (const object of listedCacheObjects.objects) {
    await env.CACHE_BUCKET.delete(object.key)
  }
})

afterEach(() => {
  setAppLoggerForTesting(null)
  vi.restoreAllMocks()
})
