export function renderIncomingOffer(offer, now = Date.now()) {
  if (!offer) return '';
  const remaining = Math.max(0, Math.ceil((new Date(offer.expiresAt).getTime() - now) / 1000));
  const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
  const seconds = String(remaining % 60).padStart(2, '0');
  const safe = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
  return `<section class="dispatch-offer" role="dialog" aria-modal="true" aria-labelledby="dispatch-title">
    <div class="dispatch-pulse">HOME AI</div><p>NHIỆM VỤ MỚI</p>
    <h1 id="dispatch-title">${safe(offer.serviceCategory)}</h1>
    <strong class="dispatch-countdown" data-dispatch-countdown data-expires-at="${safe(offer.expiresAt)}">${minutes}:${seconds}</strong>
    <div class="dispatch-facts"><span>${Number(offer.distanceKm).toFixed(1)} km</span><span>ETA ${offer.etaMinutes} phút</span></div>
    <h2>${safe(offer.approximateAddress)}</h2><p class="dispatch-request">${safe(offer.request)}</p>
    <div class="dispatch-actions"><button data-decline="${safe(offer.id)}">Từ chối</button><button data-accept="${safe(offer.id)}">Chấp nhận</button></div>
  </section>`;
}

export function updateDispatchCountdown(root, now = Date.now()) {
  const element=root?.querySelector?.('[data-dispatch-countdown]');
  if (!element) return null;
  const remaining=Math.max(0,Math.ceil((new Date(element.dataset.expiresAt).getTime()-now)/1000));
  element.textContent=`${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`;
  return remaining;
}

export function notifyIncomingOffer(environment = globalThis) {
  try {
    const AudioContext = environment.AudioContext || environment.webkitAudioContext;
    if (AudioContext) {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 880; gain.gain.value = 0.08;
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(); oscillator.stop(context.currentTime + 0.18);
    }
  } catch { /* Audio requires a prior user gesture on some browsers. */ }
  try { environment.navigator?.vibrate?.([180, 90, 180]); } catch { /* Optional capability. */ }
}

export function createProviderDispatchController({
  repository, getState, onState, onOffer = () => {}, onError = () => {},
}) {
  let stopped = false; let unsubscribe = () => {};
  let knownOfferIds = new Set((getState()?.offers ?? []).map(({ id }) => id));
  const refresh = async () => {
    try {
      const next = await repository.load();
      const incoming = (next.offers ?? []).find(({ id }) => !knownOfferIds.has(id));
      knownOfferIds = new Set((next.offers ?? []).map(({ id }) => id));
      if (!stopped) { onState(next); if (incoming) onOffer(incoming); }
    } catch (error) { if (!stopped) onError(error); }
  };
  const stop = () => {
    stopped = true;
    unsubscribe();
  };
  const start = () => {
    if (repository.source !== 'supabase' || typeof repository.subscribeDispatch !== 'function') return () => {};
    unsubscribe = repository.subscribeDispatch(refresh, (status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onError(new Error(`Provider Realtime: ${status}`));
    });
    return stop;
  };
  return Object.freeze({ start, stop, refresh });
}
