export function summarizeVariance(values) {
  const highest = Math.max(...values)
  const lowest = Math.min(...values)
  return `variance ${highest - lowest}`
}
