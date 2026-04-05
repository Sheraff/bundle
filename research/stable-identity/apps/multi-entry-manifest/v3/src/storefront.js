import './styles/storefront.css';
import badgeUrl from './assets/storefront-badge.svg';
import { renderScaffold } from './shared/platform.js';

renderScaffold({
  mountId: 'storefront-fixture',
  title: 'Storefront entry',
  summary: 'Version three merges the split shell back into one shared chunk with a new output layout.',
  badgeUrl,
  loadRoute: () => import('./routes/catalog.js').then((module) => module.renderCatalog),
});
