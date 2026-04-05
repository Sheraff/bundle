export function renderCells(values) {
  return values.map((value) => `[${value}]`).join(' ');
}
