import { env } from "cloudflare:workers"

const DEFAULT_TIMESTAMP = "2026-04-07T12:00:00.000Z"

export async function countRows(tableName: string) {
  const result = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).first<{
    count: number
  }>()

  return result?.count ?? 0
}

export async function insertRepository(
  repository: {
    id: string
    githubRepoId: number
    installationId: number
    owner: string
    name: string
  },
  timestamp = DEFAULT_TIMESTAMP,
) {
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

export async function insertScenario(
  scenario: {
    id: string
    repositoryId: string
    slug: string
    sourceKind: string
  },
  timestamp = DEFAULT_TIMESTAMP,
) {
  await env.DB.prepare(
    `INSERT INTO scenarios (id, repository_id, slug, source_kind, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      scenario.id,
      scenario.repositoryId,
      scenario.slug,
      scenario.sourceKind,
      timestamp,
      timestamp,
    )
    .run()
}
