import type { DeriveRunQueueMessage, NormalizeRunQueueMessage } from '@workspace/contracts'

export interface AppBindings {
  BUNDLE_UPLOAD_TOKEN: string
  DB: D1Database
  RAW_UPLOADS_BUCKET: R2Bucket
  CACHE_BUCKET: R2Bucket
  NORMALIZE_RUN_QUEUE: Queue<NormalizeRunQueueMessage>
  DERIVE_RUN_QUEUE: Queue<DeriveRunQueueMessage>
}

export interface AppEnv {
  Bindings: AppBindings
}
