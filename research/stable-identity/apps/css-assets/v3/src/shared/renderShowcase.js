export function renderShowcase(root, rows) {
  const panel = document.createElement('section');
  panel.className = 'showcase-panel';
  panel.innerHTML = rows
    .map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`)
    .join('');
  root.append(panel);
}
