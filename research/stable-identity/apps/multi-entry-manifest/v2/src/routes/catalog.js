export function renderCatalog(mount, context) {
  const section = context.renderPanel({
    eyebrow: 'Dynamic route',
    title: 'Catalog route',
    description: 'The same dynamic route should survive output churn and shared chunk splits.',
    rows: [
      ['Theme', context.themeTokens.accent],
      ['Flag', context.featureFlags[0]],
      ['Payload', '20kb initial slice'],
    ],
  });

  mount.append(section);
}
