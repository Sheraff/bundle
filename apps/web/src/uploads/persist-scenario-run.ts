import type {
  PullRequestContext,
  RepositoryContext,
  UploadScenarioRunEnvelopeV1,
} from '@workspace/contracts'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'

import { getDb, schema } from '../db/index.js'
import { selectOne } from '../db/select-one.js'

import type { StoredUploadTexts } from './raw-upload-storage.js'

type AppDb = ReturnType<typeof getDb>

export async function persistScenarioRun(
  db: AppDb,
  options: {
    envelope: UploadScenarioRunEnvelopeV1
    rawArtifactR2Key: string
    rawEnvelopeR2Key: string
    scenarioRunId: string
    storedTexts: StoredUploadTexts
    timestamp: string
    uploadDedupeKey: string
  },
) {
  const repository = await upsertRepository(db, options.envelope.repository, options.timestamp)
  const scenario = await upsertScenario(db, repository.id, options.envelope, options.timestamp)
  const pullRequest = options.envelope.pullRequest
    ? await upsertPullRequest(db, repository.id, options.envelope.pullRequest, options.timestamp)
    : null
  const commitGroup = await upsertCommitGroup(
    db,
    repository.id,
    pullRequest?.id ?? null,
    options.envelope.git.commitSha,
    options.envelope.git.branch,
    options.timestamp,
  )

  await db
    .insert(schema.scenarioRuns)
    .values({
      id: options.scenarioRunId,
      repositoryId: repository.id,
      scenarioId: scenario.id,
      commitGroupId: commitGroup.id,
      pullRequestId: pullRequest?.id ?? null,
      commitSha: options.envelope.git.commitSha,
      branch: options.envelope.git.branch,
      status: 'queued',
      scenarioSourceKind: options.envelope.scenarioSource.kind,
      artifactScenarioKind: options.envelope.artifact.scenario.kind,
      uploadDedupeKey: options.uploadDedupeKey,
      rawArtifactR2Key: options.rawArtifactR2Key,
      rawEnvelopeR2Key: options.rawEnvelopeR2Key,
      artifactSha256: options.storedTexts.artifactSha256,
      envelopeSha256: options.storedTexts.envelopeSha256,
      artifactSizeBytes: options.storedTexts.artifactSizeBytes,
      envelopeSizeBytes: options.storedTexts.envelopeSizeBytes,
      artifactSchemaVersion: options.envelope.artifact.schemaVersion,
      uploadSchemaVersion: options.envelope.schemaVersion,
      ciProvider: options.envelope.ci.provider,
      ciWorkflowRunId: options.envelope.ci.workflowRunId,
      ciWorkflowRunAttempt: options.envelope.ci.workflowRunAttempt ?? null,
      ciJob: options.envelope.ci.job ?? null,
      ciActionVersion: options.envelope.ci.actionVersion ?? null,
      uploadedAt: options.timestamp,
      createdAt: options.timestamp,
      updatedAt: options.timestamp,
    })
    .onConflictDoNothing({ target: schema.scenarioRuns.uploadDedupeKey })
}

async function upsertRepository(
  db: AppDb,
  repository: RepositoryContext,
  timestamp: string,
) {
  const existingRepository = await selectOne(
    db
      .select({ id: schema.repositories.id })
      .from(schema.repositories)
      .where(eq(schema.repositories.githubRepoId, repository.githubRepoId))
      .limit(1),
  )

  if (existingRepository) {
    await db
      .update(schema.repositories)
      .set({
        owner: repository.owner,
        name: repository.name,
        installationId: repository.installationId,
        updatedAt: timestamp,
      })
      .where(eq(schema.repositories.id, existingRepository.id))

    return existingRepository
  }

  const createdRepositoryId = ulid()

  try {
    await db.insert(schema.repositories).values({
      id: createdRepositoryId,
      githubRepoId: repository.githubRepoId,
      owner: repository.owner,
      name: repository.name,
      installationId: repository.installationId,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  } catch {
    const concurrentRepository = await selectOne(
      db
        .select({ id: schema.repositories.id })
        .from(schema.repositories)
        .where(eq(schema.repositories.githubRepoId, repository.githubRepoId))
        .limit(1),
    )

    if (concurrentRepository) {
      return concurrentRepository
    }

    throw new Error('Could not create the repository row for this upload.')
  }

  return {
    id: createdRepositoryId,
  }
}

async function upsertScenario(
  db: AppDb,
  repositoryId: string,
  envelope: UploadScenarioRunEnvelopeV1,
  timestamp: string,
) {
  const existingScenario = await selectOne(
    db
      .select({ id: schema.scenarios.id })
      .from(schema.scenarios)
      .where(
        and(
          eq(schema.scenarios.repositoryId, repositoryId),
          eq(schema.scenarios.slug, envelope.artifact.scenario.id),
        ),
      )
      .limit(1),
  )

  if (existingScenario) {
    await db
      .update(schema.scenarios)
      .set({
        sourceKind: envelope.scenarioSource.kind,
        updatedAt: timestamp,
      })
      .where(eq(schema.scenarios.id, existingScenario.id))

    return existingScenario
  }

  const createdScenarioId = ulid()

  try {
    await db.insert(schema.scenarios).values({
      id: createdScenarioId,
      repositoryId,
      slug: envelope.artifact.scenario.id,
      sourceKind: envelope.scenarioSource.kind,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  } catch {
    const concurrentScenario = await selectOne(
      db
        .select({ id: schema.scenarios.id })
        .from(schema.scenarios)
        .where(
          and(
            eq(schema.scenarios.repositoryId, repositoryId),
            eq(schema.scenarios.slug, envelope.artifact.scenario.id),
          ),
        )
        .limit(1),
    )

    if (concurrentScenario) {
      return concurrentScenario
    }

    throw new Error('Could not create the scenario row for this upload.')
  }

  return {
    id: createdScenarioId,
  }
}

async function upsertPullRequest(
  db: AppDb,
  repositoryId: string,
  pullRequest: PullRequestContext,
  timestamp: string,
) {
  const existingPullRequest = await selectOne(
    db
      .select({ id: schema.pullRequests.id })
      .from(schema.pullRequests)
      .where(
        and(
          eq(schema.pullRequests.repositoryId, repositoryId),
          eq(schema.pullRequests.prNumber, pullRequest.number),
        ),
      )
      .limit(1),
  )

  if (existingPullRequest) {
    await db
      .update(schema.pullRequests)
      .set({
        baseSha: pullRequest.baseSha,
        baseRef: pullRequest.baseRef,
        headSha: pullRequest.headSha,
        headRef: pullRequest.headRef,
        updatedAt: timestamp,
      })
      .where(eq(schema.pullRequests.id, existingPullRequest.id))

    return existingPullRequest
  }

  const createdPullRequestId = ulid()

  try {
    await db.insert(schema.pullRequests).values({
      id: createdPullRequestId,
      repositoryId,
      prNumber: pullRequest.number,
      baseSha: pullRequest.baseSha,
      baseRef: pullRequest.baseRef,
      headSha: pullRequest.headSha,
      headRef: pullRequest.headRef,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  } catch {
    const concurrentPullRequest = await selectOne(
      db
        .select({ id: schema.pullRequests.id })
        .from(schema.pullRequests)
        .where(
          and(
            eq(schema.pullRequests.repositoryId, repositoryId),
            eq(schema.pullRequests.prNumber, pullRequest.number),
          ),
        )
        .limit(1),
    )

    if (concurrentPullRequest) {
      return concurrentPullRequest
    }

    throw new Error('Could not create the pull request row for this upload.')
  }

  return {
    id: createdPullRequestId,
  }
}

async function upsertCommitGroup(
  db: AppDb,
  repositoryId: string,
  pullRequestId: string | null,
  commitSha: string,
  branch: string,
  timestamp: string,
) {
  const existingCommitGroup = await selectOne(
    db
      .select({
        id: schema.commitGroups.id,
        pullRequestId: schema.commitGroups.pullRequestId,
      })
      .from(schema.commitGroups)
      .where(
        and(
          eq(schema.commitGroups.repositoryId, repositoryId),
          eq(schema.commitGroups.commitSha, commitSha),
        ),
      )
      .limit(1),
  )

  if (existingCommitGroup) {
    await db
      .update(schema.commitGroups)
      .set({
        branch,
        pullRequestId: pullRequestId ?? existingCommitGroup.pullRequestId ?? null,
        status: 'pending',
        latestUploadAt: timestamp,
        updatedAt: timestamp,
      })
      .where(eq(schema.commitGroups.id, existingCommitGroup.id))

    return {
      id: existingCommitGroup.id,
    }
  }

  const createdCommitGroupId = ulid()

  try {
    await db.insert(schema.commitGroups).values({
      id: createdCommitGroupId,
      repositoryId,
      pullRequestId,
      commitSha,
      branch,
      status: 'pending',
      latestUploadAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  } catch {
    const concurrentCommitGroup = await selectOne(
      db
        .select({ id: schema.commitGroups.id })
        .from(schema.commitGroups)
        .where(
          and(
            eq(schema.commitGroups.repositoryId, repositoryId),
            eq(schema.commitGroups.commitSha, commitSha),
          ),
        )
        .limit(1),
    )

    if (concurrentCommitGroup) {
      return concurrentCommitGroup
    }

    throw new Error('Could not create the commit-group row for this upload.')
  }

  return {
    id: createdCommitGroupId,
  }
}
