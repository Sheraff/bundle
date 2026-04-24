import * as v from "valibot"

import {
  isoTimestampSchema,
  nonEmptyStringSchema,
  positiveIntegerSchema,
  ulidSchema,
} from "./shared.js"

export const githubActionsUploadTokenRequestV1Schema = v.strictObject({
  token: nonEmptyStringSchema,
})

export const githubActionsUploadTokenResponseV1Schema = v.strictObject({
  token: nonEmptyStringSchema,
  expiresAt: isoTimestampSchema,
  installationId: positiveIntegerSchema,
  repositoryId: ulidSchema,
})

export type GithubActionsUploadTokenRequestV1 = v.InferOutput<
  typeof githubActionsUploadTokenRequestV1Schema
>
export type GithubActionsUploadTokenResponseV1 = v.InferOutput<
  typeof githubActionsUploadTokenResponseV1Schema
>
