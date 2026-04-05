import './ui/app.css';

const root = document.createElement('main');
root.className = 'rename-shell';
root.innerHTML = '<h1>Rename moves v3</h1>';
document.body.append(root);

Promise.all([
  import('./routes/insights.js').then((module) => module.renderInsights),
  import('./routes/preferences.js').then((module) => module.renderPreferences),
]).then(([renderInsights, renderPreferences]) => {
  root.append(renderInsights());
  root.append(renderPreferences());
});
