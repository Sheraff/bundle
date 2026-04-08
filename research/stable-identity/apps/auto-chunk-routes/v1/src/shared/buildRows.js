export function buildRows(base, offset) {
  return [
    ["baseline", base],
    ["delta", base + offset],
    ["ceiling", base + offset + 3],
  ]
}
