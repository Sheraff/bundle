import { defaultStringifySearch } from "@tanstack/react-router"

export function buildPrCompareUrl(
  origin: string,
  owner: string,
  repository: string,
  pullRequestNumber: number,
  searchParams: Record<string, string>,
) {
  const url = new URL(
    `/r/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/compare${defaultStringifySearch({ pr: pullRequestNumber, ...searchParams })}`,
    origin,
  )

  return url.toString()
}

export function formatBytes(value: number) {
  return formatMagnitude(value)
}

export function formatSignedBytes(value: number) {
  return `${value >= 0 ? "+" : "-"}${formatMagnitude(Math.abs(value))}`
}

export function formatSignedPercentage(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`
}

export function formatCount(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`
}

function formatMagnitude(value: number) {
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`
  }

  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} kB`
  }

  return `${value} B`
}
