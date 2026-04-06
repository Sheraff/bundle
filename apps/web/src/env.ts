import type {
  CommitGroupSettlementWorkflowInput,
  DeriveRunQueueMessage,
  MaterializeComparisonQueueMessage,
  NormalizeRunQueueMessage,
  RefreshSummariesQueueMessage,
  ScheduleComparisonsQueueMessage,
} from '@workspace/contracts'

export interface AppBindings {
  BUNDLE_UPLOAD_TOKEN: string
  DB: D1Database
  RAW_UPLOADS_BUCKET: R2Bucket
  CACHE_BUCKET: R2Bucket
  NORMALIZE_RUN_QUEUE: Queue<NormalizeRunQueueMessage>
  DERIVE_RUN_QUEUE: Queue<DeriveRunQueueMessage>
  SCHEDULE_COMPARISONS_QUEUE: Queue<ScheduleComparisonsQueueMessage>
  MATERIALIZE_COMPARISON_QUEUE: Queue<MaterializeComparisonQueueMessage>
  REFRESH_SUMMARIES_QUEUE: Queue<RefreshSummariesQueueMessage>
  COMMIT_GROUP_SETTLEMENT_WORKFLOW: Workflow<CommitGroupSettlementWorkflowInput>
}

export interface AppEnv {
  Bindings: AppBindings
}
