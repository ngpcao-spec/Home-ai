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
  const doc = root.ownerDocument;
  if (!doc?.body) return () => {};
  const panel = doc.createElement('details');
  panel.dataset.offerDiagnostics = '';
  panel.style.cssText = 'position:fixed;bottom:95px;left:8px;z-index:2147483647;max-width:calc(100vw - 16px);max-height:50vh;overflow:auto;background:white;color:#17342d;border:1px solid #087b61;border-radius:8px;padding:8px;font:12px monospace';
  panel.innerHTML = '<summary>Chẩn đoán thông báo</summary><button type="button">Cập nhật</button><pre style="white-space:pre-wrap"></pre>';
  const update = () => { panel.querySelector('pre').textContent = JSON.stringify(getReport(), null, 2); };
  panel.addEventListener('toggle', update);
  panel.querySelector('button').addEventListener('click', update);
  doc.body.append(panel);
  return () => panel.remove();
}
