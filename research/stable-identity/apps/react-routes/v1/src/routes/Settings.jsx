import './settings.css';
import { formatCurrency } from '../shared/formatCurrency.js';
import { buildCards } from '../shared/kpiCards.js';
import { RouteShell } from '../shared/routeShell.jsx';

export default function Settings() {
  const cards = buildCards(18000, 2600).map((card) => ({
    ...card,
    value: formatCurrency(card.value),
  }));

  return (
    <RouteShell
      caption="Route chunk"
      title="Settings route"
      summary="The same shared helpers should keep module identity stable even when chunking changes."
    >
      <ul className="settings-list">
        {cards.map((card) => (
          <li key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </li>
        ))}
      </ul>
    </RouteShell>
  );
}
