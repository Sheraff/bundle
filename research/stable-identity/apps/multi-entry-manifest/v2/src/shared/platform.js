import '../styles/shared.css';
import { featureFlags } from './featureFlags.js';
import { renderPanel } from './renderPanel.js';
import { themeTokens } from './themeTokens.js';

export async function renderScaffold({ mountId, title, summary, badgeUrl, loadRoute }) {
  const mount = document.createElement('main');
  mount.id = mountId;
  mount.className = 'shell-root';
  document.body.appendChild(mount);

  const hero = document.createElement('section');
  hero.className = 'shell-hero';
  hero.innerHTML = `
    <div>
      <p class="shell-eyebrow">Multi-entry fixture</p>
      <h1>${title}</h1>
      <p>${summary}</p>
    </div>
    <img alt="Fixture badge" class="shell-badge" src="${badgeUrl}">
  `;
  mount.append(hero);

  const routeRenderer = await loadRoute();
  routeRenderer(mount, { featureFlags, renderPanel, themeTokens });
}
