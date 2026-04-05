export function RouteShell({ caption, title, summary, children }) {
  return (
    <section className="route-panel">
      <p className="eyebrow">{caption}</p>
      <h2>{title}</h2>
      <p>{summary}</p>
      {children}
    </section>
  );
}
