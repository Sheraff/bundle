import {
  SCHEMA_VERSION_V1,
  uploadScenarioRunAcceptedResponseV1Schema,
  type ScenarioRunStatus,
  type UploadScenarioRunAcceptedResponseV1,
} from "@workspace/contracts"
import * as v from "valibot"

import { schema } from "../db/index.js"
import { formatIssues } from "../shared/format-issues.js"

export type AcceptedScenarioRun = Pick<
  typeof schema.scenarioRuns.$inferSelect,
  "id" | "repositoryId" | "commitGroupId" | "status"
>

export function buildAcceptedResponse(
  scenarioRun: AcceptedScenarioRun,
): UploadScenarioRunAcceptedResponseV1 {
  const responseResult = v.safeParse(uploadScenarioRunAcceptedResponseV1Schema, {
    schemaVersion: SCHEMA_VERSION_V1,
    accepted: true,
    repositoryId: scenarioRun.repositoryId,
    commitGroupId: scenarioRun.commitGroupId,
    scenarioRunId: scenarioRun.id,
    status: scenarioRun.status as ScenarioRunStatus,
  })

  if (!responseResult.success) {
    throw new Error(`Generated upload response is invalid: ${formatIssues(responseResult.issues)}`)
  }

  return responseResult.output
}
