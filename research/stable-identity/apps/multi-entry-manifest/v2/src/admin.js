import './styles/admin.css';
import badgeUrl from './assets/admin-badge.svg';
import { renderScaffold } from './shared/platform.js';

renderScaffold({
  mountId: 'admin-fixture',
  title: 'Admin entry',
  summary: 'The entry stays stable while the old shell chunk is intentionally split.',
  badgeUrl,
  loadRoute: () => import('./routes/audit.js').then((module) => module.renderAudit),
});
