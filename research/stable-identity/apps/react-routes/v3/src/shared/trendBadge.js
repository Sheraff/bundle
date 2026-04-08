export function trendBadge(value) {
  if (value >= 130000) {
    return "Ahead of budget"
  }

  if (value >= 26000) {
    return "Within budget"
  }

  return "Watch budget"
}
