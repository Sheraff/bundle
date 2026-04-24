import * as v from "valibot"

import { base64UrlDecodeJson, base64UrlEncodeBytes, base64UrlEncodeJson } from "./base64url.js"
import { timingSafeEqual } from "./constant-time.js"

const textEncoder = new TextEncoder()

export interface ExpiringTokenPayload {
  exp: number
  kind: string
}

export async function createSignedToken(payload: ExpiringTokenPayload, secret: string) {
  const encodedPayload = base64UrlEncodeJson(payload)
  const signature = await sign(encodedPayload, secret)

  return `${encodedPayload}.${signature}`
}

export async function verifySignedToken<TPayload extends ExpiringTokenPayload>(
  token: string,
  secret: string,
  expectedKind: string,
  payloadSchema: v.GenericSchema<unknown, TPayload>,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const [encodedPayload, signature, extra] = token.split(".")

  if (!encodedPayload || !signature || extra !== undefined) {
    return null
  }

  const expectedSignature = await sign(encodedPayload, secret)

  if (!timingSafeEqual(signature, expectedSignature)) {
    return null
  }

  let rawPayload: unknown

  try {
    rawPayload = base64UrlDecodeJson(encodedPayload)
  } catch {
    return null
  }

  const payloadResult = v.safeParse(payloadSchema, rawPayload)

  if (!payloadResult.success) {
    return null
  }

  const payload = payloadResult.output

  if (payload.kind !== expectedKind || payload.exp <= nowSeconds) {
    return null
  }

  return payload
}

async function sign(encodedPayload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(encodedPayload))

  return base64UrlEncodeBytes(new Uint8Array(signature))
}
