export function renderAudit(mount, context) {
  const section = context.renderPanel({
    eyebrow: 'Dynamic route',
    title: 'Audit route',
    description: 'This route still belongs to the admin entry after the shared chunk merge.',
    rows: [
      ['Theme', context.themeTokens.accent],
      ['Flag', context.featureFlags[1]],
      ['Payload', '15kb audit slice'],
    ],
  });

  mount.append(section);
}
