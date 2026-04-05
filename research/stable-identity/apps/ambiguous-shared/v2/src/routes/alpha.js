import { fetchBudget } from '../shared/fetchBudget.js';
import { formatWave } from '../shared/formatWave.js';
import { renderBadge } from '../shared/renderBadge.js';
import { renderCells } from '../shared/renderCells.js';
import { renderSpark } from '../shared/renderSpark.js';
import { summarizeVariance } from '../shared/summarizeVariance.js';

export function renderAlpha() {
  const section = document.createElement('section');
  const budget = fetchBudget('alpha');
  section.dataset.route = 'alpha';
  section.innerHTML = `
    <h2>Alpha</h2>
    <p>${renderBadge('steady')}</p>
    <p>${formatWave(budget)}</p>
    <p>${renderCells(budget)}</p>
    <p>${renderSpark(budget)}</p>
    <p>${summarizeVariance(budget)}</p>
  `;
  return section;
}
