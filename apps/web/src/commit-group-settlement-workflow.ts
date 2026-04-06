import {
  commitGroupSettlementWorkflowInputSchema,
  type CommitGroupSettlementWorkflowInput,
} from '@workspace/contracts'
import * as v from 'valibot'

import { getDb, schema } from './db/index.js'
import type { AppBindings } from './env.js'
import {
  COMMIT_GROUP_SETTLEMENT_QUIET_WINDOW_MS,
  enqueueRefreshSummaries,
} from './refresh-summaries.js'
import { eq } from 'drizzle-orm'

const WorkflowEntrypointBase = (
  globalThis as unknown as {
    WorkflowEntrypoint?: typeof WorkflowEntrypoint
  }
).WorkflowEntrypoint ??
  (class {
    protected readonly env: AppBindings

    constructor(_ctx: unknown, env: AppBindings) {
      this.env = env
    }
  } as unknown as typeof WorkflowEntrypoint)

const NonRetryableErrorBase = (
  globalThis as unknown as {
    NonRetryableError?: typeof NonRetryableError
  }
).NonRetryableError ?? Error

export class CommitGroupSettlementWorkflow extends WorkflowEntrypointBase<
  AppBindings,
  CommitGroupSettlementWorkflowInput
> {
  async run(
    event: WorkflowEvent<CommitGroupSettlementWorkflowInput>,
    step: WorkflowStep,
  ) {
    const input = await step.do('validate settlement input', async () => {
      const result = v.safeParse(commitGroupSettlementWorkflowInputSchema, event.payload)

      if (!result.success) {
        throw new NonRetryableErrorBase(
          `Invalid commit-group settlement workflow input: ${result.issues
            .map((issue) => issue.message)
            .join('; ')}`,
        )
      }

      return result.output
    })

    const commitGroup = await step.do('load commit group', async () => {
      const loadedCommitGroup = await getDb(this.env)
        .select({
          id: schema.commitGroups.id,
          repositoryId: schema.commitGroups.repositoryId,
          latestUploadAt: schema.commitGroups.latestUploadAt,
        })
        .from(schema.commitGroups)
        .where(eq(schema.commitGroups.id, input.commitGroupId))
        .limit(1)

      const [row] = loadedCommitGroup
      if (!row) {
        return null
      }

      if (row.repositoryId !== input.repositoryId) {
        throw new NonRetryableErrorBase(
          `Commit group ${input.commitGroupId} does not belong to repository ${input.repositoryId}.`,
        )
      }

      return row
    })

    if (!commitGroup) {
      return {
        skipped: true,
      }
    }

    await step.sleepUntil(
      'wait for quiet window',
      new Date(Date.parse(commitGroup.latestUploadAt) + COMMIT_GROUP_SETTLEMENT_QUIET_WINDOW_MS),
    )

    await step.do('enqueue summary refresh', async () => {
      await enqueueRefreshSummaries(
        this.env,
        input.repositoryId,
        input.commitGroupId,
        `workflow-${input.orchestrationKey}`,
      )

      return {
        commitGroupId: input.commitGroupId,
        orchestrationKey: input.orchestrationKey,
      }
    })

    return {
      commitGroupId: input.commitGroupId,
      orchestrationKey: input.orchestrationKey,
    }
  }
}
