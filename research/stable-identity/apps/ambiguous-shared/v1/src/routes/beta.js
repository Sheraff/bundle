import { fetchBudget } from "../shared/fetchBudget.js"
import { formatWave } from "../shared/formatWave.js"
import { linkRows } from "../shared/linkRows.js"
import { renderBadge } from "../shared/renderBadge.js"
import { renderCells } from "../shared/renderCells.js"

export function renderBeta() {
  const section = document.createElement("section")
  const budget = fetchBudget("beta")
  section.dataset.route = "beta"
  section.innerHTML = `
    <h2>Beta</h2>
    <p>${renderBadge("steady")}</p>
    <p>${formatWave(budget)}</p>
    <p>${renderCells(budget)}</p>
    <p>${linkRows(["trace-core", "shared-lens"])}</p>
  `
  return section
}
