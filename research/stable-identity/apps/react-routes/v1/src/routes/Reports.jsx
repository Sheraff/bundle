import "./reports.css"
import { formatCurrency } from "../shared/formatCurrency.js"
import { buildCards } from "../shared/kpiCards.js"
import { RouteShell } from "../shared/routeShell.jsx"

export default function Reports() {
  const cards = buildCards(124000, 9800).map((card) => ({
    ...card,
    value: formatCurrency(card.value),
  }))

  return (
    <RouteShell
      caption="Route chunk"
      title="Reports route"
      summary="This route shares UI and number formatting helpers with Settings."
    >
      <ul className="kpi-grid">
        {cards.map((card) => (
          <li key={card.label}>
            <strong>{card.value}</strong>
            <span>{card.label}</span>
          </li>
        ))}
      </ul>
    </RouteShell>
  )
}
