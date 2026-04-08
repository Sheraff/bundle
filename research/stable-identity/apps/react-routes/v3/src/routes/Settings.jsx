import "./settings.css"
import { formatCurrency } from "../shared/formatCurrency.js"
import { buildCards } from "../shared/kpiCards.js"
import { RouteShell } from "../shared/routeShell.jsx"
import { trendBadge } from "../shared/trendBadge.js"

export default function Settings() {
  const cards = buildCards(26000, 2100).map((card) => ({
    ...card,
    value: formatCurrency(card.value),
    badge: trendBadge(card.value),
  }))

  return (
    <RouteShell
      caption="Route chunk"
      title="Settings route"
      summary="The chunk merge should not look like an add/remove pair when module continuity is still obvious."
    >
      <ul className="settings-list">
        {cards.map((card) => (
          <li key={card.label}>
            <span>
              {card.label}
              <em>{card.badge}</em>
            </span>
            <strong>{card.value}</strong>
          </li>
        ))}
      </ul>
    </RouteShell>
  )
}
