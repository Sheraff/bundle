import './styles/workbench.css';
import { applyChrome } from './shared/applyChrome.js';
import { mountTokens } from './shared/mountTokens.js';
import { renderShowcase } from './shared/renderShowcase.js';

const root = document.createElement('main');
root.className = 'page-shell workbench-shell';
document.body.appendChild(root);

applyChrome(root, {
  eyebrow: 'CSS asset fixture',
  title: 'Workbench entry',
  summary: 'Merged CSS should still be traceable to the two old split CSS assets.',
});
mountTokens(root, ['delta-wave', 'shared-css', 'entry-split']);
renderShowcase(root, [
  ['Surface', 'ops-console'],
  ['Theme', 'blue fabric'],
  ['CSS mode', 'merged fabric'],
]);
