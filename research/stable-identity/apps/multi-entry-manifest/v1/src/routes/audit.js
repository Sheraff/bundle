export function renderAudit(mount, context) {
  const section = context.renderPanel({
    eyebrow: 'Dynamic route',
    title: 'Audit route',
    description: 'The admin entry loads a different dynamic chunk but shares the same shell helpers.',
    rows: [
      ['Theme', context.themeTokens.accent],
      ['Flag', context.featureFlags[1]],
      ['Payload', '18kb audit slice'],
    ],
  });

  mount.append(section);
}
