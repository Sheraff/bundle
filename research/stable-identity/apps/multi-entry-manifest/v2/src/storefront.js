import './styles/storefront.css';
import badgeUrl from './assets/storefront-badge.svg';
import { renderScaffold } from './shared/platform.js';

renderScaffold({
  mountId: 'storefront-fixture',
  title: 'Storefront entry',
  summary: 'Version two splits the shared shell into core and theme chunks.',
  badgeUrl,
  loadRoute: () => import('./routes/catalog.js').then((module) => module.renderCatalog),
});
