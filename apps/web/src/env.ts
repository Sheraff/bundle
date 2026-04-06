import type {
  DeriveRunQueueMessage,
  MaterializeComparisonQueueMessage,
  NormalizeRunQueueMessage,
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
}

export interface AppEnv {
  Bindings: AppBindings
}
