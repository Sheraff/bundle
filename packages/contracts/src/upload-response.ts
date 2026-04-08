import * as v from "valibot"

import { SCENARIO_RUN_STATUSES, schemaVersionV1Schema, ulidSchema } from "./shared.js"

export const uploadScenarioRunAcceptedResponseV1Schema = v.strictObject({
  schemaVersion: schemaVersionV1Schema,
  accepted: v.literal(true),
  repositoryId: ulidSchema,
  commitGroupId: ulidSchema,
  scenarioRunId: ulidSchema,
  status: v.union(SCENARIO_RUN_STATUSES.map((status) => v.literal(status))),
})

export type UploadScenarioRunAcceptedResponseV1 = v.InferOutput<
  typeof uploadScenarioRunAcceptedResponseV1Schema
>
