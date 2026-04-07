import { describe, expect, it } from 'vitest'

import {
  groupScenarioRunsByScenarioId,
  hasNewerFailedRun,
  selectActiveRunsByScenarioId,
} from '../src/summaries/active-run-policy.js'

describe('active run policy', () => {
  it('keeps the newest processed run active when a newer rerun has not finished processing', () => {
    const runsByScenarioId = groupScenarioRunsByScenarioId([
      buildScenarioRun({
        id: 'run-failed',
        scenarioId: 'scenario-a',
        status: 'failed',
        uploadedAt: '2026-04-07T12:02:00.000Z',
        createdAt: '2026-04-07T12:02:00.000Z',
      }),
      buildScenarioRun({
        id: 'run-active',
        scenarioId: 'scenario-a',
        status: 'processed',
        uploadedAt: '2026-04-07T12:01:00.000Z',
        createdAt: '2026-04-07T12:01:00.000Z',
      }),
      buildScenarioRun({
        id: 'run-queued',
        scenarioId: 'scenario-a',
        status: 'queued',
        uploadedAt: '2026-04-07T12:03:00.000Z',
        createdAt: '2026-04-07T12:03:00.000Z',
      }),
    ])

    const activeRun = selectActiveRunsByScenarioId(runsByScenarioId).get('scenario-a')

    expect(activeRun?.id).toBe('run-active')
  })

  it('treats a failed rerun with the same upload time but newer creation time as newer', () => {
    const activeRun = buildScenarioRun({
      id: 'run-active',
      status: 'processed',
      uploadedAt: '2026-04-07T12:01:00.000Z',
      createdAt: '2026-04-07T12:01:00.000Z',
    })
    const failedRun = buildScenarioRun({
      id: 'run-failed',
      status: 'failed',
      uploadedAt: '2026-04-07T12:01:00.000Z',
      createdAt: '2026-04-07T12:01:01.000Z',
    })

    expect(hasNewerFailedRun(failedRun, activeRun)).toBe(true)
  })
})

function buildScenarioRun(overrides: Partial<{
  id: string
  scenarioId: string
  scenarioSlug: string
  sourceKind: string
  status: string
  commitGroupId: string
  commitSha: string
  branch: string
  uploadedAt: string
  createdAt: string
  failureCode: string | null
  failureMessage: string | null
}> = {}) {
  return {
    id: overrides.id ?? 'run-default',
    scenarioId: overrides.scenarioId ?? 'scenario-default',
    scenarioSlug: overrides.scenarioSlug ?? 'scenario-default',
    sourceKind: overrides.sourceKind ?? 'fixture-app',
    status: overrides.status ?? 'processed',
    commitGroupId: overrides.commitGroupId ?? 'commit-group-default',
    commitSha: overrides.commitSha ?? '1111111111111111111111111111111111111111',
    branch: overrides.branch ?? 'main',
    uploadedAt: overrides.uploadedAt ?? '2026-04-07T12:00:00.000Z',
    createdAt: overrides.createdAt ?? '2026-04-07T12:00:00.000Z',
    failureCode: overrides.failureCode ?? null,
    failureMessage: overrides.failureMessage ?? null,
  }
}
