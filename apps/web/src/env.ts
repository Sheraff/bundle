import type {
  CommitGroupSettlementWorkflowInput,
  DeriveRunQueueMessage,
  MaterializeComparisonQueueMessage,
  PrPublishDebounceWorkflowInput,
  NormalizeRunQueueMessage,
  PublishGithubQueueMessage,
  RefreshSummariesQueueMessage,
  ScheduleComparisonsQueueMessage,
} from "@workspace/contracts"

export interface AppBindings {
  BUNDLE_UPLOAD_TOKEN: string
  PUBLIC_APP_ORIGIN: string
  GITHUB_APP_ID: string
  GITHUB_APP_PRIVATE_KEY: string
  DB: D1Database
  RAW_UPLOADS_BUCKET: R2Bucket
  CACHE_BUCKET: R2Bucket
  NORMALIZE_RUN_QUEUE: Queue<NormalizeRunQueueMessage>
  DERIVE_RUN_QUEUE: Queue<DeriveRunQueueMessage>
  SCHEDULE_COMPARISONS_QUEUE: Queue<ScheduleComparisonsQueueMessage>
  MATERIALIZE_COMPARISON_QUEUE: Queue<MaterializeComparisonQueueMessage>
  REFRESH_SUMMARIES_QUEUE: Queue<RefreshSummariesQueueMessage>
  PUBLISH_GITHUB_QUEUE: Queue<PublishGithubQueueMessage>
  COMMIT_GROUP_SETTLEMENT_WORKFLOW: Workflow<CommitGroupSettlementWorkflowInput>
  PR_PUBLISH_DEBOUNCE_WORKFLOW: Workflow<PrPublishDebounceWorkflowInput>
}

export interface AppEnv {
  Bindings: AppBindings
}
