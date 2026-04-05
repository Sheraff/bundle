import './ui/app.css';

const root = document.createElement('main');
root.className = 'rename-shell';
root.innerHTML = '<h1>Rename moves v2</h1>';
document.body.append(root);

Promise.all([
  import('./routes/insights.js').then((module) => module.renderInsights),
  import('./routes/settings.js').then((module) => module.renderSettings),
]).then(([renderInsights, renderSettings]) => {
  root.append(renderInsights());
  root.append(renderSettings());
});
