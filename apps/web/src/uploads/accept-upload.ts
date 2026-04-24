import {
  SCHEMA_VERSION_V1,
  normalizeRunQueueMessageSchema,
  type UploadScenarioRunAcceptedResponseV1,
  type UploadScenarioRunEnvelopeV1,
} from "@workspace/contracts"
import { eq } from "drizzle-orm"
import * as v from "valibot"
import { ulid } from "ulid"

import { getDb, schema } from "../db/index.js"
import { selectOne } from "../db/select-one.js"
import type { AppBindings } from "../env.js"
import { getAppLogger } from "../logger.js"
import { enqueueRefreshSummaries } from "../summaries/refresh-queue.js"
import { formatIssues } from "../shared/format-issues.js"
import { sha256Hex } from "../shared/sha256-hex.js"

import { buildAcceptedResponse, type AcceptedScenarioRun } from "./accepted-response.js"
import { persistScenarioRun } from "./persist-scenario-run.js"
import {
  buildStoredUploadTexts,
  deleteRawUploadObjects,
  persistRawUploadObjects,
} from "./raw-upload-storage.js"

type AppDb = ReturnType<typeof getDb>

export type AcceptUploadResult =
  | {
      ok: true
      response: UploadScenarioRunAcceptedResponseV1
    }
  | {
      ok: false
      code:
        | "normalize_queue_unavailable"
        | "raw_upload_storage_unavailable"
        | "upload_persistence_failed"
      message: string
    }

export async function acceptUpload(
  env: AppBindings,
  envelope: UploadScenarioRunEnvelopeV1,
  rawRequestBody: string,
): Promise<AcceptUploadResult> {
  const db = getDb(env)
  const logger = getAppLogger()
  const uploadDedupeKey = await sha256Hex(stableStringify(envelope))
  const existingScenarioRun = await getScenarioRunByDedupeKey(db, uploadDedupeKey)

  if (existingScenarioRun) {
    return {
      ok: true,
      response: buildAcceptedResponse(existingScenarioRun),
    }
  }

  const timestamp = new Date().toISOString()
  const storedTexts = await buildStoredUploadTexts(envelope, rawRequestBody)
  const scenarioRunId = ulid()
  const rawArtifactR2Key = `raw/scenario-runs/${scenarioRunId}/artifact.json`
  const rawEnvelopeR2Key = `raw/scenario-runs/${scenarioRunId}/envelope.json`
  let persistedScenarioRun: AcceptedScenarioRun | null = null

  try {
    await persistRawUploadObjects(env, {
      artifactSchemaVersion: envelope.artifact.schemaVersion,
      envelopeSchemaVersion: envelope.schemaVersion,
      rawArtifactR2Key,
      rawEnvelopeR2Key,
      storedTexts,
    })
  } catch (error) {
    await deleteRawUploadObjects(env, rawArtifactR2Key, rawEnvelopeR2Key)
    logger.error(
      "Failed to persist raw upload objects",
      {
        rawArtifactR2Key,
        rawEnvelopeR2Key,
        scenarioRunId,
        uploadDedupeKey,
      },
      error,
    )

    return {
      ok: false,
      code: "raw_upload_storage_unavailable",
      message: "The upload could not be accepted because raw evidence could not be persisted.",
    }
  }

  try {
    await persistScenarioRun(db, {
      envelope,
      rawArtifactR2Key,
      rawEnvelopeR2Key,
      scenarioRunId,
      storedTexts,
      timestamp,
      uploadDedupeKey,
    })
    persistedScenarioRun = await getScenarioRunByDedupeKey(db, uploadDedupeKey)
  } catch (error) {
    await rollbackScenarioRunInsert(
      db,
      env,
      logger,
      {
        rawArtifactR2Key,
        rawEnvelopeR2Key,
        scenarioRunId,
        uploadDedupeKey,
      },
    )
    logger.error(
      "Failed to persist upload metadata",
      {
        rawArtifactR2Key,
        rawEnvelopeR2Key,
        scenarioRunId,
        uploadDedupeKey,
      },
      error,
    )

    return {
      ok: false,
      code: "upload_persistence_failed",
      message: "The upload could not be accepted because upload metadata could not be persisted.",
    }
  }

  if (!persistedScenarioRun) {
    const error = new Error("Upload metadata persisted without a recoverable scenario run row.")
    await rollbackScenarioRunInsert(
      db,
      env,
      logger,
      {
        rawArtifactR2Key,
        rawEnvelopeR2Key,
        scenarioRunId,
        uploadDedupeKey,
      },
    )
    logger.error(
      "Failed to persist upload metadata",
      {
        rawArtifactR2Key,
        rawEnvelopeR2Key,
        scenarioRunId,
        uploadDedupeKey,
      },
      error,
    )

    return {
      ok: false,
      code: "upload_persistence_failed",
      message: "The upload could not be accepted because upload metadata could not be persisted.",
    }
  }

  if (persistedScenarioRun.id !== scenarioRunId) {
    await deleteRawUploadObjects(env, rawArtifactR2Key, rawEnvelopeR2Key)

    return {
      ok: true,
      response: buildAcceptedResponse(persistedScenarioRun),
    }
  }

  try {
    await enqueueNormalizeRun(env, persistedScenarioRun.repositoryId, scenarioRunId)
    await enqueueRefreshSummaries(
      env,
      persistedScenarioRun.repositoryId,
      persistedScenarioRun.commitGroupId,
      "upload-accepted",
    )
  } catch (error) {
    await rollbackScenarioRunInsert(
      db,
      env,
      logger,
      {
        commitGroupId: persistedScenarioRun.commitGroupId,
        rawArtifactR2Key,
        rawEnvelopeR2Key,
        repositoryId: persistedScenarioRun.repositoryId,
        scenarioRunId,
        uploadDedupeKey,
      },
    )
    logger.error(
      "Failed to schedule follow-up upload processing",
      {
        commitGroupId: persistedScenarioRun.commitGroupId,
        rawArtifactR2Key,
        rawEnvelopeR2Key,
        repositoryId: persistedScenarioRun.repositoryId,
        scenarioRunId,
        uploadDedupeKey,
      },
      error,
    )

    return {
      ok: false,
      code: "normalize_queue_unavailable",
      message:
        "The upload could not be accepted because follow-up processing could not be scheduled.",
    }
  }

  return {
    ok: true,
    response: buildAcceptedResponse(persistedScenarioRun),
  }
}

async function enqueueNormalizeRun(env: AppBindings, repositoryId: string, scenarioRunId: string) {
  const messageResult = v.safeParse(normalizeRunQueueMessageSchema, {
    schemaVersion: SCHEMA_VERSION_V1,
    kind: "normalize-run",
    repositoryId,
    scenarioRunId,
    dedupeKey: `normalize-run:${scenarioRunId}:v1`,
  })

  if (!messageResult.success) {
    throw new Error(
      `Generated normalize-run message is invalid: ${formatIssues(messageResult.issues)}`,
    )
  }

  await env.NORMALIZE_RUN_QUEUE.send(messageResult.output, {
    contentType: "json",
  })
}

async function getScenarioRunByDedupeKey(db: AppDb, uploadDedupeKey: string) {
  return selectOne(
    db
      .select({
        id: schema.scenarioRuns.id,
        repositoryId: schema.scenarioRuns.repositoryId,
        commitGroupId: schema.scenarioRuns.commitGroupId,
        status: schema.scenarioRuns.status,
      })
      .from(schema.scenarioRuns)
      .where(eq(schema.scenarioRuns.uploadDedupeKey, uploadDedupeKey))
      .limit(1),
  )
}

async function rollbackScenarioRunInsert(
  db: AppDb,
  env: AppBindings,
  logger: ReturnType<typeof getAppLogger>,
  context: {
    commitGroupId?: string
    rawArtifactR2Key: string
    rawEnvelopeR2Key: string
    repositoryId?: string
    scenarioRunId: string
    uploadDedupeKey: string
  },
) {
  const results = await Promise.allSettled([
    db.delete(schema.scenarioRuns).where(eq(schema.scenarioRuns.id, context.scenarioRunId)),
    deleteRawUploadObjects(env, context.rawArtifactR2Key, context.rawEnvelopeR2Key),
  ])
  const operations = ["delete_scenario_run", "delete_raw_upload_objects"] as const

  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      logger.error(
        "Failed to roll back accepted upload state",
        {
          ...context,
          operation: operations[index],
        },
        result.reason,
      )
    }
  }
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`
  }

  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(",")}}`
}
