// Deliberately excludes tokens, customer details and GPS coordinates.
export function readOfferDiagnostics({ document, source, busy, offers = [], buildId }) {
  const overlay = document?.querySelector('.dispatch-offer');
  const style = overlay ? document.defaultView?.getComputedStyle(overlay) : null;
  const bounds = overlay?.getBoundingClientRect();
  const now = Date.now();
  return {
    build: buildId ?? 'unknown', source, busy,
    visibility: document?.visibilityState, hidden: document?.hidden,
    deviceTime: new Date(now).toISOString(),
    offers: offers.map(offer => ({ id: offer.id, status: offer.status ?? 'not supplied',
      expiresAt: offer.expiresAt ?? null,
      remainingSeconds: Number.isFinite(Date.parse(offer.expiresAt)) ? Math.ceil((Date.parse(offer.expiresAt) - now) / 1000) : null })),
    overlay: overlay ? { id: overlay.dataset.dispatchOfferId, parent: overlay.parentElement?.tagName,
      display: style?.display, visibility: style?.visibility, position: style?.position, zIndex: style?.zIndex,
      width: bounds?.width, height: bounds?.height } : null,
  };
}

export function mountOfferDiagnostics(root, getReport) {
  void root;void getReport;
  // Compatibility export for a previously cached Provider entry module.
  // Production diagnostics must never mount user-facing UI.
  return () => {};
}
