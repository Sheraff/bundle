export function buildCards(primaryValue, deltaValue) {
  return [
    { label: 'Primary budget', value: primaryValue },
    { label: 'Monthly delta', value: deltaValue },
    { label: 'Scenario ceiling', value: primaryValue - deltaValue },
  ];
}
