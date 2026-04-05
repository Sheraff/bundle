export function trendBadge(value) {
  if (value >= 120000) {
    return 'Ahead of budget';
  }

  if (value >= 24000) {
    return 'Within budget';
  }

  return 'Watch budget';
}
