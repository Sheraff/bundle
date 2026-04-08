export function renderBadge(state) {
  return state === "steady" ? "Within threshold" : "Outside threshold"
}
