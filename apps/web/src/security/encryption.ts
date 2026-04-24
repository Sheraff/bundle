import type { AppBindings } from "../env.js"
import { base64UrlDecodeBytes, base64UrlEncodeBytes } from "./base64url.js"

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export async function encryptSecret(env: Pick<AppBindings, "AUTH_ENCRYPTION_KEY">, value: string) {
  const key = await importEncryptionKey(requireEncryptionKey(env))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { iv, name: "AES-GCM" },
    key,
    textEncoder.encode(value),
  )

  return `v1.${base64UrlEncodeBytes(iv)}.${base64UrlEncodeBytes(new Uint8Array(ciphertext))}`
}

export async function decryptSecret(env: Pick<AppBindings, "AUTH_ENCRYPTION_KEY">, value: string) {
  const [version, encodedIv, encodedCiphertext, extra] = value.split(".")

  if (version !== "v1" || !encodedIv || !encodedCiphertext || extra !== undefined) {
    throw new Error("Encrypted secret is not in a supported format.")
  }

  const key = await importEncryptionKey(requireEncryptionKey(env))
  const plaintext = await crypto.subtle.decrypt(
    { iv: base64UrlDecodeBytes(encodedIv), name: "AES-GCM" },
    key,
    base64UrlDecodeBytes(encodedCiphertext),
  )

  return textDecoder.decode(plaintext)
}

function requireEncryptionKey(env: Pick<AppBindings, "AUTH_ENCRYPTION_KEY">) {
  if (!env.AUTH_ENCRYPTION_KEY) {
    throw new Error("AUTH_ENCRYPTION_KEY is required for GitHub user token storage.")
  }

  return env.AUTH_ENCRYPTION_KEY
}

async function importEncryptionKey(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(secret))

  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt", "encrypt"])
}
