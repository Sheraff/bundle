import './reports.css';
import { formatCurrency } from '../shared/formatCurrency.js';
import { buildCards } from '../shared/kpiCards.js';
import { RouteShell } from '../shared/routeShell.jsx';
import { trendBadge } from '../shared/trendBadge.js';

export default function Reports() {
  const cards = buildCards(132000, 6400).map((card) => ({
    ...card,
    value: formatCurrency(card.value),
    badge: trendBadge(card.value),
  }));

  return (
    <RouteShell
      caption="Route chunk"
      title="Reports route"
      summary="A merged shared chunk should still preserve the old module identities from both v2 chunks."
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
