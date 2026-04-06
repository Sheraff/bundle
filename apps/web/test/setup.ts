import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, vi } from 'vitest'

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)

  for (const statement of [
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
  vi.restoreAllMocks()
})
