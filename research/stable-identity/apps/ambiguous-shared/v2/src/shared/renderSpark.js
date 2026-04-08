export function renderSpark(values) {
  return values.map((value) => (value > 20 ? "up" : "flat")).join(", ")
}
