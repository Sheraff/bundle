export function renderCatalog(mount, context) {
  const section = context.renderPanel({
    eyebrow: 'Dynamic route',
    title: 'Catalog route',
    description: 'The catalog route hangs off the storefront entry.',
    rows: [
      ['Theme', context.themeTokens.accent],
      ['Flag', context.featureFlags[0]],
      ['Payload', '22kb initial slice'],
    ],
  });

  mount.append(section);
}
