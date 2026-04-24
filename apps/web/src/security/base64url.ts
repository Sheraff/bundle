const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function base64UrlEncodeJson(value: unknown) {
  return base64UrlEncodeBytes(textEncoder.encode(JSON.stringify(value)))
}

export function base64UrlDecodeJson(value: string): unknown {
  return JSON.parse(textDecoder.decode(base64UrlDecodeBytes(value)))
}

export function base64UrlEncodeText(value: string) {
  return base64UrlEncodeBytes(textEncoder.encode(value))
}

export function base64UrlDecodeText(value: string) {
  return textDecoder.decode(base64UrlDecodeBytes(value))
}

export function base64UrlEncodeBytes(bytes: Uint8Array) {
  let binary = ""

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "")
}

export function base64UrlDecodeBytes(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/")
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=")
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}
