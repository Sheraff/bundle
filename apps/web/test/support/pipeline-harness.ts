import { env } from 'cloudflare:workers'
import type { UploadScenarioRunEnvelopeV1 } from '@workspace/contracts'
import { expect, vi } from 'vitest'

import {
  dispatchQueueMessage,
  TEST_QUEUE_NAMES,
} from '../queue-test-helpers.js'
import { sendUploadRequest } from './request-helpers.js'

export function createPipelineHarness() {
  const normalizeSendSpy = vi.spyOn(env.NORMALIZE_RUN_QUEUE, 'send')
  const deriveSendSpy = vi.spyOn(env.DERIVE_RUN_QUEUE, 'send')
  const scheduleSendSpy = vi.spyOn(env.SCHEDULE_COMPARISONS_QUEUE, 'send')
  const materializeSendSpy = vi.spyOn(env.MATERIALIZE_COMPARISON_QUEUE, 'send')
  const publishSendSpy = vi.spyOn(env.PUBLISH_GITHUB_QUEUE, 'send')
  const refreshSendSpy = vi.spyOn(env.REFRESH_SUMMARIES_QUEUE, 'send')
  normalizeSendSpy.mockClear()
  deriveSendSpy.mockClear()
  scheduleSendSpy.mockClear()
  materializeSendSpy.mockClear()
  publishSendSpy.mockClear()
  refreshSendSpy.mockClear()

  const normalizeIndex = { value: 0 }
  const deriveIndex = { value: 0 }
  const scheduleIndex = { value: 0 }
  const materializeIndex = { value: 0 }
  const publishIndex = { value: 0 }
  const refreshIndex = { value: 0 }

  return {
    acceptUpload,
    drainDerive,
    drainMaterialize,
    drainNormalize,
    drainPublish,
    drainRefresh,
    drainSchedule,
    processUploadPipeline,
  }

  async function acceptUpload(envelope: UploadScenarioRunEnvelopeV1) {
    const response = await sendUploadRequest(envelope)
    expect(response.status).toBe(202)
    return response
  }

  async function drainRefresh() {
    await drainQueuedMessages(refreshSendSpy, refreshIndex, TEST_QUEUE_NAMES.refreshSummaries)
  }

  async function drainNormalize() {
    await drainQueuedMessages(normalizeSendSpy, normalizeIndex, TEST_QUEUE_NAMES.normalizeRun)
  }

  async function drainDerive() {
    await drainQueuedMessages(deriveSendSpy, deriveIndex, TEST_QUEUE_NAMES.deriveRun)
  }

  async function drainSchedule() {
    await drainQueuedMessages(
      scheduleSendSpy,
      scheduleIndex,
      TEST_QUEUE_NAMES.scheduleComparisons,
    )
  }

  async function drainMaterialize() {
    await drainQueuedMessages(
      materializeSendSpy,
      materializeIndex,
      TEST_QUEUE_NAMES.materializeComparison,
    )
  }

  async function drainPublish() {
    await drainQueuedMessages(publishSendSpy, publishIndex, TEST_QUEUE_NAMES.publishGithub)
  }

  async function processUploadPipeline() {
    // Upload acceptance only covers queue-based ingest work. PR publishing is scheduled later via workflow.
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

async function drainQueuedMessages(
  sendSpy: { mock: { calls: unknown[][] } },
  index: { value: number },
  queueName: string,
) {
  while (index.value < sendSpy.mock.calls.length) {
    const messageBody = sendSpy.mock.calls[index.value]?.[0]
    index.value += 1
    const result = await dispatchQueueMessage(queueName, messageBody)
    expect(result).toBeAcknowledged()
  }
}
