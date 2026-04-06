import type { NormalizeRunQueueMessage } from '@workspace/contracts'

export interface AppBindings {
  BUNDLE_UPLOAD_TOKEN: string
  DB: D1Database
  RAW_UPLOADS_BUCKET: R2Bucket
  NORMALIZE_RUN_QUEUE: Queue<NormalizeRunQueueMessage>
}

export interface AppEnv {
  Bindings: AppBindings
}
