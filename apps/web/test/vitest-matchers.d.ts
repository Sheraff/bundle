import "vitest"

interface QueueResultMatchers<R = unknown> {
  toBeAcknowledged(messageId?: string): R
  toBeRetried(messageId?: string): R
}

declare module "vitest" {
  interface Assertion<T = any> extends QueueResultMatchers<T> {}
  interface AsymmetricMatchersContaining extends QueueResultMatchers {}
}

export {}
