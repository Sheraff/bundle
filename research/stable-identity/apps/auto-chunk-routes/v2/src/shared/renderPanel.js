export function renderPanel(title, rows) {
  const section = document.createElement('section');
  section.className = 'panel';
  section.innerHTML = `<h2>${title}</h2>${rows
    .map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`)
    .join('')}`;
  return section;
}
