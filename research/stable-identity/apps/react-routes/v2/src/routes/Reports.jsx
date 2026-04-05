import './reports.css';
import { formatCurrency } from '../shared/formatCurrency.js';
import { buildCards } from '../shared/kpiCards.js';
import { RouteShell } from '../shared/routeShell.jsx';
import { trendBadge } from '../shared/trendBadge.js';

export default function Reports() {
  const cards = buildCards(128000, 7600).map((card) => ({
    ...card,
    value: formatCurrency(card.value),
    badge: trendBadge(card.value),
  }));

  return (
    <RouteShell
      caption="Route chunk"
      title="Reports route"
      summary="Formatting helpers moved into a second shared chunk without changing route identities."
    >
      <ul className="kpi-grid">
        {cards.map((card) => (
          <li key={card.label}>
            <strong>{card.value}</strong>
            <span>{card.label}</span>
            <em>{card.badge}</em>
          </li>
        ))}
      </ul>
    </RouteShell>
  );
}
