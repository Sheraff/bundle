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
  BUNDLE_UPLOAD_TOKEN?: string
  PUBLIC_APP_ORIGIN: string
  GITHUB_APP_ID: string
  GITHUB_APP_CLIENT_ID?: string
  GITHUB_APP_CLIENT_SECRET?: string
  GITHUB_APP_SLUG?: string
  GITHUB_APP_PRIVATE_KEY: string
  GITHUB_WEBHOOK_SECRET?: string
  GITHUB_OIDC_AUDIENCE?: string
  SESSION_SIGNING_SECRET?: string
  AUTH_ENCRYPTION_KEY?: string
  UPLOAD_TOKEN_SIGNING_SECRET?: string
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
