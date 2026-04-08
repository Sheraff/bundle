import {
  prPublishDebounceWorkflowInputSchema,
  type PrPublishDebounceWorkflowInput,
} from "@workspace/contracts"
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { NonRetryableError } from "cloudflare:workflows"
import * as v from "valibot"

import type { AppBindings } from "./env.js"
import { enqueuePublishGithub } from "./github/publish-queue.js"

export const PR_PUBLISH_DEBOUNCE_WINDOW_MS = 10_000

export class PrPublishDebounceWorkflow extends WorkflowEntrypoint<
  AppBindings,
  PrPublishDebounceWorkflowInput
> {
  async run(event: WorkflowEvent<PrPublishDebounceWorkflowInput>, step: WorkflowStep) {
    const input = await step.do("validate publish input", async () => {
      const result = v.safeParse(prPublishDebounceWorkflowInputSchema, event.payload)

      if (!result.success) {
        throw new NonRetryableError(
          `Invalid PR publish workflow input: ${result.issues.map((issue) => issue.message).join("; ")}`,
        )
      }

      return result.output
    })

    await step.sleep("wait for publish debounce", PR_PUBLISH_DEBOUNCE_WINDOW_MS)

    await step.do("enqueue github publish", async () => {
      await enqueuePublishGithub(
        this.env,
        input.repositoryId,
        input.pullRequestId,
        `workflow-${input.orchestrationKey}`,
      )

      return {
        orchestrationKey: input.orchestrationKey,
        pullRequestId: input.pullRequestId,
      }
    })

    return {
      orchestrationKey: input.orchestrationKey,
      pullRequestId: input.pullRequestId,
    }
  }
}
