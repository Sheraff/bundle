import './styles/admin.css';
import badgeUrl from './assets/admin-badge.svg';
import { renderScaffold } from './shared/platform.js';

renderScaffold({
  mountId: 'admin-fixture',
  title: 'Admin entry',
  summary: 'The admin entry shares the shell but loads a different dynamic route.',
  badgeUrl,
  loadRoute: () => import('./routes/audit.js').then((module) => module.renderAudit),
});
