export function timingSafeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left)
  const rightBytes = new TextEncoder().encode(right)
  const length = Math.max(leftBytes.length, rightBytes.length)
  let difference = leftBytes.length ^ rightBytes.length

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }

  return difference === 0
}
