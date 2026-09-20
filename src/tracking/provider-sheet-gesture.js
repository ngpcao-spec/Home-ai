export function mountTrackingProviderSheet(sheet, view = sheet?.ownerDocument?.defaultView) {
  const handle = sheet?.querySelector('[data-tracking-sheet-handle]');
  if (!handle || !view) return () => {};
  let pointerId = null;
  let startY = 0;
  let startHeight = 0;
  let lastY = 0;
  let lastTime = 0;
  let velocity = 0;
  let wasExpanded = false;

  const heights = () => {
    const viewport = view.visualViewport?.height ?? view.innerHeight;
    const available = sheet.parentElement?.getBoundingClientRect().height || viewport - 174;
    return { compact: Math.min(viewport * (viewport <= 700 ? .42 : .46), available - 64), expanded: Math.min(viewport * .72, available - 12) };
  };
  const setExpanded = expanded => {
    sheet.classList.toggle('is-expanded', expanded);
    sheet.style.height = '';
    handle.setAttribute('aria-expanded', String(expanded));
  };
  const onPointerDown = event => {
    if (pointerId !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    pointerId = event.pointerId;
    startY = lastY = event.clientY;
    lastTime = event.timeStamp;
    velocity = 0;
    wasExpanded = sheet.classList.contains('is-expanded');
    const limits = heights();
    startHeight = sheet.getBoundingClientRect().height || (wasExpanded ? limits.expanded : limits.compact);
    sheet.classList.add('is-dragging');
    handle.setPointerCapture?.(pointerId);
    event.preventDefault();
  };
  const onPointerMove = event => {
    if (event.pointerId !== pointerId) return;
    velocity = (event.clientY - lastY) / Math.max(1, event.timeStamp - lastTime);
    lastY = event.clientY;
    lastTime = event.timeStamp;
    const limits = heights();
    sheet.style.height = `${Math.min(limits.expanded, Math.max(limits.compact, startHeight + startY - event.clientY))}px`;
    event.preventDefault();
  };
  const onPointerEnd = event => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    sheet.classList.remove('is-dragging');
    if (event.type === 'pointercancel' || Math.abs(lastY - startY) < 5) return setExpanded(wasExpanded);
    const limits = heights();
    const height = Number.parseFloat(sheet.style.height) || startHeight;
    setExpanded(velocity < -.35 || (velocity <= .35 && height >= (limits.compact + limits.expanded) / 2));
  };
  const onKeyDown = event => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    setExpanded(event.key === 'ArrowUp');
  };
  handle.addEventListener('pointerdown', onPointerDown);
  view.addEventListener('pointermove', onPointerMove, { passive: false });
  view.addEventListener('pointerup', onPointerEnd);
  view.addEventListener('pointercancel', onPointerEnd);
  handle.addEventListener('keydown', onKeyDown);
  return () => {
    pointerId = null;
    sheet.classList.remove('is-dragging');
    handle.removeEventListener('pointerdown', onPointerDown);
    view.removeEventListener('pointermove', onPointerMove);
    view.removeEventListener('pointerup', onPointerEnd);
    view.removeEventListener('pointercancel', onPointerEnd);
    handle.removeEventListener('keydown', onKeyDown);
  };
}
