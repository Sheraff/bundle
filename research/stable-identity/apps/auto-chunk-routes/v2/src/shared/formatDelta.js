export function formatDelta(value) {
  return `${value > 0 ? '+' : ''}${value}kb`;
}
