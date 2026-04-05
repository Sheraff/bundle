export function renderAudit(mount, context) {
  const section = context.renderPanel({
    eyebrow: 'Dynamic route',
    title: 'Audit route',
    description: 'The split should be surfaced as split lineage instead of fake rename continuity.',
    rows: [
      ['Theme', context.themeTokens.accent],
      ['Flag', context.featureFlags[1]],
      ['Payload', '16kb audit slice'],
    ],
  });

  mount.append(section);
}
