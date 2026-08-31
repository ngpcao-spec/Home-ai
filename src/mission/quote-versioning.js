const freezeVersion = (version) => Object.freeze({
  ...version,
  recommendedTasks: version.recommendedTasks ? Object.freeze([...version.recommendedTasks]) : undefined,
  authorizedWork: version.authorizedWork ? Object.freeze([...version.authorizedWork]) : undefined,
});

export const supplementDiscovery = Object.freeze({
  finding: 'Dây điện nguồn bị hư và cần thay thế.',
  additionalPartsAmount: 80000,
  additionalLaborAmount: 20000,
});

export function createInitialQuoteVersion(quote) {
  return freezeVersion({ ...quote, id: 'quote-v1', version: 1, status: 'pending' });
}

export function decideInitialQuoteVersion(version, decision) {
  if (version?.version !== 1 || version.status !== 'pending' || !['accepted', 'declined'].includes(decision)) return version;
  return freezeVersion({ ...version, status: decision });
}

export function createSupplementQuoteVersion(acceptedVersion, discovery = supplementDiscovery) {
  if (acceptedVersion?.version !== 1 || acceptedVersion.status !== 'accepted') return null;
  const supplementAmount = discovery.additionalPartsAmount + discovery.additionalLaborAmount;
  return freezeVersion({
    id: 'quote-v2',
    version: 2,
    status: 'supplement_pending',
    baseVersion: 1,
    finding: discovery.finding,
    authorizedWork: ['Thay dây điện nguồn'],
    additionalPartsAmount: discovery.additionalPartsAmount,
    additionalLaborAmount: discovery.additionalLaborAmount,
    supplementAmount,
    totalAmount: acceptedVersion.totalAmount + supplementAmount,
  });
}

export function decideSupplementQuoteVersion(version, decision) {
  if (version?.version !== 2 || version.status !== 'supplement_pending' || !['accepted', 'rejected'].includes(decision)) return version;
  return freezeVersion({ ...version, status: decision });
}

export function getAuthorizedQuoteTotal(history) {
  return history.filter(({ status }) => status === 'accepted').at(-1)?.totalAmount ?? 0;
}
