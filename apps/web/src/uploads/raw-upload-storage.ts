import type { UploadScenarioRunEnvelopeV1 } from "@workspace/contracts"

import type { AppBindings } from "../env.js"
import { sha256Hex } from "../shared/sha256-hex.js"

const textEncoder = new TextEncoder()

export interface StoredUploadTexts {
  artifactSha256: string
  artifactSizeBytes: number
  artifactText: string
  envelopeSha256: string
  envelopeSizeBytes: number
  envelopeText: string
}

export async function buildStoredUploadTexts(
  envelope: UploadScenarioRunEnvelopeV1,
  rawRequestBody: string,
): Promise<StoredUploadTexts> {
  const artifactText = `${JSON.stringify(envelope.artifact, null, 2)}\n`
  const envelopeText = ensureTrailingNewline(rawRequestBody)

  return {
    artifactText,
    artifactSha256: await sha256Hex(artifactText),
    artifactSizeBytes: textEncoder.encode(artifactText).byteLength,
    envelopeText,
    envelopeSha256: await sha256Hex(envelopeText),
    envelopeSizeBytes: textEncoder.encode(envelopeText).byteLength,
  }
}

export async function persistRawUploadObjects(
  env: AppBindings,
  options: {
    artifactSchemaVersion: number
    envelopeSchemaVersion: number
    rawArtifactR2Key: string
    rawEnvelopeR2Key: string
    storedTexts: StoredUploadTexts
  },
) {
  await putRawUploadObject(
    env,
    options.rawArtifactR2Key,
    options.storedTexts.artifactText,
    options.storedTexts.artifactSha256,
    options.artifactSchemaVersion,
  )
  await putRawUploadObject(
    env,
    options.rawEnvelopeR2Key,
    options.storedTexts.envelopeText,
    options.storedTexts.envelopeSha256,
    options.envelopeSchemaVersion,
  )
}

export async function deleteRawUploadObjects(
  env: AppBindings,
  rawArtifactR2Key: string,
  rawEnvelopeR2Key: string,
) {
  await Promise.allSettled([
    env.RAW_UPLOADS_BUCKET.delete(rawArtifactR2Key),
    env.RAW_UPLOADS_BUCKET.delete(rawEnvelopeR2Key),
  ])
}

async function putRawUploadObject(
  env: AppBindings,
  key: string,
  value: string,
  sha256: string,
  schemaVersion: number,
) {
  await env.RAW_UPLOADS_BUCKET.put(key, value, {
    httpMetadata: {
      contentType: "application/json",
    },
    customMetadata: {
      schemaVersion: String(schemaVersion),
      sha256,
    },
  })
}

function ensureTrailingNewline(value: string) {
  return value.endsWith("\n") ? value : `${value}\n`
}
