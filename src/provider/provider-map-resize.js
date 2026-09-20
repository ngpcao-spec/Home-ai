const normalHeight = view => view.matchMedia?.('(max-width: 420px)').matches || view.innerWidth <= 420 ? 238 : 270;

export function mountProviderMapResizeGesture({ card, mapElement, navigation, expanded = false, onExpandedChange = () => {}, view = mapElement?.ownerDocument?.defaultView }) {
  const handle = card?.querySelector('[data-provider-map-resize-handle]');
  if (!handle || !mapElement || !navigation?.map || !view) return () => {};
  const body = mapElement.ownerDocument.body;
  let pointerId = null;
  let startY = 0;
  let startHeight = 0;
  let lastY = 0;
  let lastTime = 0;
  let velocity = 0;
  let startExpanded = expanded;
  let frame = null;
  let finalTimer = null;
  let previousOverflow = '';
  const requestFrame = view.requestAnimationFrame?.bind(view) ?? (callback => view.setTimeout(callback, 16));
  const cancelFrame = view.cancelAnimationFrame?.bind(view) ?? view.clearTimeout.bind(view);
  const resize = () => navigation.map.resize?.();
  const scheduleResize = () => {
    if (frame != null) return;
    frame = requestFrame(() => { frame = null; resize(); });
  };
  const expandedHeight = () => Math.max(normalHeight(view), (view.visualViewport?.height ?? view.innerHeight) * .72);
  const releaseScroll = () => {
    if (pointerId == null) return;
    pointerId = null;
    body.style.overflow = previousOverflow;
    card.classList.remove('is-map-dragging');
  };
  const snap = next => {
    expanded = next;
    card.classList.toggle('is-map-expanded', expanded);
    mapElement.style.height = '';
    onExpandedChange(expanded);
    scheduleResize();
    if (finalTimer != null) view.clearTimeout(finalTimer);
    finalTimer = view.setTimeout(() => { finalTimer = null; resize(); }, 260);
  };
  const onPointerDown = event => {
    if (pointerId != null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    pointerId = event.pointerId;
    startY = lastY = event.clientY;
    lastTime = event.timeStamp;
    velocity = 0;
    startExpanded = expanded;
    startHeight = mapElement.getBoundingClientRect().height || (expanded ? expandedHeight() : normalHeight(view));
    previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    card.classList.add('is-map-dragging');
    handle.setPointerCapture?.(pointerId);
    event.preventDefault?.();
  };
  const onPointerMove = event => {
    if (event.pointerId !== pointerId) return;
    const elapsed = Math.max(1, event.timeStamp - lastTime);
    velocity = (event.clientY - lastY) / elapsed;
    lastY = event.clientY;
    lastTime = event.timeStamp;
    const height = Math.min(expandedHeight(), Math.max(normalHeight(view), startHeight + event.clientY - startY));
    mapElement.style.height = `${height}px`;
    scheduleResize();
    event.preventDefault?.();
  };
  const onPointerEnd = event => {
    if (event.pointerId !== pointerId) return;
    const height = Number.parseFloat(mapElement.style.height) || startHeight;
    const next = event.type === 'pointercancel' || Math.abs(startY - lastY) < 5
      ? startExpanded
      : velocity > .35 || (velocity >= -.35 && height >= (normalHeight(view) + expandedHeight()) / 2);
    releaseScroll();
    snap(next);
  };
  const onKeyDown = event => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    snap(event.key === 'ArrowDown');
  };
  const onTransitionEnd = event => {
    if (event.target !== mapElement || event.propertyName !== 'height') return;
    if (finalTimer != null) view.clearTimeout(finalTimer);
    finalTimer = null;
    resize();
  };
  card.classList.toggle('is-map-expanded', expanded);
  handle.addEventListener('pointerdown', onPointerDown);
  view.addEventListener('pointermove', onPointerMove, { passive: false });
  view.addEventListener('pointerup', onPointerEnd);
  view.addEventListener('pointercancel', onPointerEnd);
  handle.addEventListener('keydown', onKeyDown);
  mapElement.addEventListener('transitionend', onTransitionEnd);
  return () => {
    releaseScroll();
    if (frame != null) cancelFrame(frame);
    if (finalTimer != null) view.clearTimeout(finalTimer);
    handle.removeEventListener('pointerdown', onPointerDown);
    view.removeEventListener('pointermove', onPointerMove);
    view.removeEventListener('pointerup', onPointerEnd);
    view.removeEventListener('pointercancel', onPointerEnd);
    handle.removeEventListener('keydown', onKeyDown);
    mapElement.removeEventListener('transitionend', onTransitionEnd);
  };
}
