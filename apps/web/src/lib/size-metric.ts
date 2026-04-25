export const sizeMetrics = ["raw", "gzip", "brotli"] as const

export type SizeMetric = (typeof sizeMetrics)[number]

export const defaultSizeMetric = "gzip" satisfies SizeMetric

export function parseSizeMetric(value: string | undefined): SizeMetric {
  return sizeMetrics.includes(value as SizeMetric) ? (value as SizeMetric) : defaultSizeMetric
}

export function formatMetricLabel(metric: SizeMetric) {
  if (metric === "raw") return "Raw"
  if (metric === "gzip") return "Gzip"
  return "Brotli"
}

export function metricValue(
  sizes: { raw?: number | null; gzip?: number | null; brotli?: number | null },
  metric: SizeMetric,
) {
  return sizes[metric] ?? 0
}

export function metricPointValue(
  point: { totalRawBytes: number; totalGzipBytes: number; totalBrotliBytes: number },
  metric: SizeMetric,
) {
  if (metric === "raw") return point.totalRawBytes
  if (metric === "gzip") return point.totalGzipBytes
  return point.totalBrotliBytes
}
