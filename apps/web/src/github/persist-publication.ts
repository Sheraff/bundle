import { and, eq } from "drizzle-orm"
import { ulid } from "ulid"

import { schema } from "../db/index.js"
import { selectOne } from "../db/select-one.js"
import * as githubApi from "../github-api.js"

import type { DbClient } from "../summaries/types.js"

import type { GithubPublicationRow } from "./types.js"

export function shouldPublishSurface(
  publication: GithubPublicationRow | null,
  payloadHash: string,
  publishedHeadSha: string,
) {
  return !(
    publication &&
    publication.status === "published" &&
    publication.externalPublicationId &&
    publication.payloadHash === payloadHash &&
    publication.publishedHeadSha === publishedHeadSha
  )
}

export async function selectCommentPublication(db: DbClient, pullRequestId: string) {
  return selectOne(
    db
      .select()
      .from(schema.githubPublications)
      .where(
        and(
          eq(schema.githubPublications.pullRequestId, pullRequestId),
          eq(schema.githubPublications.surface, "pr-comment"),
        ),
      )
      .limit(1),
  )
}

export async function selectCheckPublication(db: DbClient, commitGroupId: string) {
  return selectOne(
    db
      .select()
      .from(schema.githubPublications)
      .where(
        and(
          eq(schema.githubPublications.commitGroupId, commitGroupId),
          eq(schema.githubPublications.surface, "pr-check"),
        ),
      )
      .limit(1),
  )
}

export async function upsertPublicationSuccess(
  db: DbClient,
  options: {
    commitGroupId: string
    existingPublication: GithubPublicationRow | null
    externalPublicationId: string
    externalPublicationNodeId: string
    externalUrl: string
    payloadHash: string
    publishedHeadSha: string
    pullRequestId: string
    repositoryId: string
    surface: string
  },
) {
  const timestamp = new Date().toISOString()
  await upsertPublicationRow(db, options.existingPublication, {
    commitGroupId: options.commitGroupId,
    externalPublicationId: options.externalPublicationId,
    externalPublicationNodeId: options.externalPublicationNodeId,
    externalUrl: options.externalUrl,
    lastAttemptedAt: timestamp,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastPublishedAt: timestamp,
    payloadHash: options.payloadHash,
    publishedHeadSha: options.publishedHeadSha,
    pullRequestId: options.pullRequestId,
    repositoryId: options.repositoryId,
    status: "published",
    surface: options.surface,
    updatedAt: timestamp,
  })
}

export async function upsertPublicationFailure(
  db: DbClient,
  options: {
    commitGroupId: string
    error: unknown
    existingPublication: GithubPublicationRow | null
    payloadHash: string
    publishedHeadSha: string
    pullRequestId: string
    repositoryId: string
    surface: string
  },
) {
  const timestamp = new Date().toISOString()
  const existingPublication = options.existingPublication
  const errorCode =
    options.error instanceof githubApi.GithubApiError ? options.error.code : "github_publish_failed"
  const errorMessage =
    options.error instanceof Error ? options.error.message : "GitHub publication failed."

  await upsertPublicationRow(db, existingPublication, {
    commitGroupId: options.commitGroupId,
    externalPublicationId: existingPublication?.externalPublicationId ?? null,
    externalPublicationNodeId: existingPublication?.externalPublicationNodeId ?? null,
    externalUrl: existingPublication?.externalUrl ?? null,
    lastAttemptedAt: timestamp,
    lastErrorCode: errorCode,
    lastErrorMessage: errorMessage,
    lastPublishedAt: existingPublication?.lastPublishedAt ?? null,
    payloadHash: options.payloadHash,
    publishedHeadSha: options.publishedHeadSha,
    pullRequestId: options.pullRequestId,
    repositoryId: options.repositoryId,
    status: "failed",
    surface: options.surface,
    updatedAt: timestamp,
  })
}

async function upsertPublicationRow(
  db: DbClient,
  existingPublication: GithubPublicationRow | null,
  values: Omit<typeof schema.githubPublications.$inferInsert, "createdAt" | "id"> & {
    updatedAt: string
  },
) {
  if (existingPublication) {
    await db
      .update(schema.githubPublications)
      .set(values)
      .where(eq(schema.githubPublications.id, existingPublication.id))

    return existingPublication.id
  }

  const createdPublicationId = ulid()
  await db.insert(schema.githubPublications).values({
    id: createdPublicationId,
    ...values,
    createdAt: values.updatedAt,
  })
  return createdPublicationId
}
