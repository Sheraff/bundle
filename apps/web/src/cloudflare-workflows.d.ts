declare class WorkflowEntrypoint<TEnv = unknown, TPayload = unknown> {
  protected env: TEnv

  run(event: WorkflowEvent<TPayload>, step: WorkflowStep): Promise<unknown>
}

interface WorkflowEvent<T = unknown> {
  payload: Readonly<T>
  timestamp: Date
  instanceId: string
}

interface WorkflowStep {
  do<T>(name: string, callback: () => Promise<T> | T): Promise<T>
  sleep(name: string, duration: string | number): Promise<void>
  sleepUntil(name: string, timestamp: Date | number): Promise<void>
}

declare class NonRetryableError extends Error {}
