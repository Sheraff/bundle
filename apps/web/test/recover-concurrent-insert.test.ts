import { describe, expect, it, vi } from "vitest"

import { recoverConcurrentInsert } from "../src/shared/recover-concurrent-insert.js"

describe("recoverConcurrentInsert", () => {
  it("returns created when insert succeeds", async () => {
    const create = vi.fn(async () => {})
    const recover = vi.fn(async () => ({ id: "recovered" }))

    await expect(
      recoverConcurrentInsert({
        create,
        recover,
        createErrorMessage: "create failed",
        recoverErrorMessage: "recover failed",
      }),
    ).resolves.toEqual({ status: "created" })

    expect(create).toHaveBeenCalledTimes(1)
    expect(recover).not.toHaveBeenCalled()
  })

  it("returns the recovered value when insert fails and recovery succeeds", async () => {
    const insertError = new Error("duplicate key")
    const recoveredValue = { id: "series-1" }

    await expect(
      recoverConcurrentInsert({
        create: async () => {
          throw insertError
        },
        recover: async () => recoveredValue,
        createErrorMessage: "create failed",
        recoverErrorMessage: "recover failed",
      }),
    ).resolves.toEqual({
      status: "recovered",
      value: recoveredValue,
    })
  })

  it("keeps the insert error as the cause when recovery returns null", async () => {
    const insertError = new Error("duplicate key")

    await expect(
      recoverConcurrentInsert({
        create: async () => {
          throw insertError
        },
        recover: async () => null,
        createErrorMessage: "create failed",
        recoverErrorMessage: "recover failed",
      }),
    ).rejects.toMatchObject({
      cause: insertError,
      message: "create failed",
    })
  })

  it("throws AggregateError when recovery fails", async () => {
    const insertError = new Error("duplicate key")
    const recoverError = new Error("db unavailable")

    await expect(
      recoverConcurrentInsert({
        create: async () => {
          throw insertError
        },
        recover: async () => {
          throw recoverError
        },
        createErrorMessage: "create failed",
        recoverErrorMessage: "recover failed",
      }),
    ).rejects.toMatchObject({
      errors: [insertError, recoverError],
      message: "recover failed",
      name: "AggregateError",
    })
  })

  it("throws AggregateError when reconciliation fails", async () => {
    const insertError = new Error("duplicate key")
    const reconcileError = new Error("update unavailable")
    const recoveredValue = { id: "series-point-1" }

    await expect(
      recoverConcurrentInsert({
        create: async () => {
          throw insertError
        },
        recover: async () => recoveredValue,
        onRecovered: async () => {
          throw reconcileError
        },
        createErrorMessage: "create failed",
        recoverErrorMessage: "recover failed",
        reconcileErrorMessage: "reconcile failed",
      }),
    ).rejects.toMatchObject({
      errors: [insertError, reconcileError],
      message: "reconcile failed",
      name: "AggregateError",
    })
  })
})
