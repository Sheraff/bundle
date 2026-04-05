export function renderCatalog(mount, context) {
  const section = context.renderPanel({
    eyebrow: 'Dynamic route',
    title: 'Catalog route',
    description: 'The catalog route stays stable while the old shared chunks merge again.',
    rows: [
      ['Theme', context.themeTokens.accent],
      ['Flag', context.featureFlags[0]],
      ['Payload', '19kb initial slice'],
    ],
  });

  mount.append(section);
}
