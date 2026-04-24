export type RecoverConcurrentInsertResult<TRecovered> =
  | {
      status: "created"
    }
  | {
      status: "recovered"
      value: TRecovered
    }

type Awaitable<T> = PromiseLike<T> | T

export async function recoverConcurrentInsert<TRecovered>(options: {
  create: () => Awaitable<unknown>
  recover: () => Awaitable<TRecovered | null>
  onRecovered?: (value: TRecovered) => Awaitable<void>
  createErrorMessage: string
  recoverErrorMessage: string
  reconcileErrorMessage?: string
}): Promise<RecoverConcurrentInsertResult<TRecovered>> {
  try {
    await options.create()
    return { status: "created" }
  } catch (insertError) {
    let recoveredValue: TRecovered | null

    try {
      recoveredValue = await options.recover()
    } catch (recoverError) {
      throw new AggregateError([insertError, recoverError], options.recoverErrorMessage)
    }

    if (!recoveredValue) {
      throw new Error(options.createErrorMessage, { cause: insertError })
    }

    if (options.onRecovered) {
      try {
        await options.onRecovered(recoveredValue)
      } catch (reconcileError) {
        throw new AggregateError(
          [insertError, reconcileError],
          options.reconcileErrorMessage ?? options.recoverErrorMessage,
        )
      }
    }

    return {
      status: "recovered",
      value: recoveredValue,
    }
  }
}
