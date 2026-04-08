import "./settings.css"
import { formatCurrency } from "../shared/formatCurrency.js"
import { buildCards } from "../shared/kpiCards.js"
import { RouteShell } from "../shared/routeShell.jsx"
import { trendBadge } from "../shared/trendBadge.js"

export default function Settings() {
  const cards = buildCards(24000, 3200).map((card) => ({
    ...card,
    value: formatCurrency(card.value),
    badge: trendBadge(card.value),
  }))

  return (
    <RouteShell
      caption="Route chunk"
      title="Settings route"
      summary="The split should not create a false one-to-one match against the old shared chunk."
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
