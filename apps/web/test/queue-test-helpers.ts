import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test"
import { env } from "cloudflare:workers"

import worker from "../src/index.js"

export const TEST_QUEUE_NAMES = {
  deriveRun: "bundle-derive-run-test",
  materializeComparison: "bundle-materialize-comparison-test",
  normalizeRun: "bundle-normalize-run-test",
  publishGithub: "bundle-publish-github-test",
  refreshSummaries: "bundle-refresh-summaries-test",
  scheduleComparisons: "bundle-schedule-comparisons-test",
} as const

export async function dispatchQueueMessage<TBody>(
  queueName: string,
  body: TBody,
  {
    attempts = 1,
    id = "message-1",
    timestamp = new Date("2026-04-06T12:00:00.000Z"),
  }: {
    attempts?: number
    id?: string
    timestamp?: Date
  } = {},
) {
  const batch = createMessageBatch(queueName, [
    {
      id,
      timestamp,
      attempts,
      body,
    },
  ])
  const executionContext = createExecutionContext()

  await worker.queue(batch, env, executionContext)

  return getQueueResult(batch, executionContext)
}
