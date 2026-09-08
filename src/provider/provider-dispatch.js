export function renderIncomingOffer(offer, now = Date.now()) {
  if (!offer) return '';
  const serviceLabels={electricity:'Điện',plumbing:'Nước','air-conditioning':'Điều hòa',appliances:'Điện gia dụng'};
  const remaining = Math.max(0, Math.ceil((new Date(offer.expiresAt).getTime() - now) / 1000));
  const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
  const seconds = String(remaining % 60).padStart(2, '0');
  const safe = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
  return `<section class="dispatch-offer" data-dispatch-offer-id="${safe(offer.id)}" role="dialog" aria-modal="true" aria-labelledby="dispatch-title">
    <div class="dispatch-pulse">HOME AI</div><p>NHIỆM VỤ MỚI</p>
    <h1 id="dispatch-title">${safe(offer.serviceLabel ?? serviceLabels[offer.serviceCategory] ?? offer.serviceCategory)}</h1>
    <strong class="dispatch-countdown" data-dispatch-countdown data-expires-at="${safe(offer.expiresAt)}">${minutes}:${seconds}</strong>
    <div class="dispatch-facts"><span>${Number(offer.distanceKm).toFixed(1)} km</span><span>ETA ${offer.etaMinutes} phút</span></div>
    <h2>${safe(offer.approximateAddress)}</h2><p class="dispatch-request">${safe(offer.request)}</p>
    ${offer.indicativeAmount != null ? `<div class="dispatch-price"><small>GIÁ THAM KHẢO</small><strong>${new Intl.NumberFormat('vi-VN').format(offer.indicativeAmount)}${offer.currency === 'VND' || !offer.currency ? 'đ' : ` ${safe(offer.currency)}`}</strong></div>` : ''}
    <button class="dispatch-audio" data-enable-offer-audio>🔊 Chạm để bật âm thanh</button>
    <div class="dispatch-actions"><button data-decline="${safe(offer.id)}">TỪ CHỐI</button><button data-accept="${safe(offer.id)}">NHẬN VIỆC</button></div>
  </section>`;
}

export function createIncomingOfferLayer(root) {
  const doc = root.ownerDocument;
  if (!doc?.createElement || !doc.body) return null;
  const host = doc.createElement('div');
  host.dataset.providerOfferLayer = '';
  doc.body.append(host);
  let currentId = null;
  return {
    host,
    sync(offer) {
      const id = offer?.id ?? null;
      if (id === currentId && (!id || host.firstElementChild)) return;
      currentId = id;
      host.innerHTML = renderIncomingOffer(offer);
    },
    stop() { host.remove(); },
  };
}

export function updateDispatchCountdown(root, now = Date.now()) {
  const element=root?.querySelector?.('[data-dispatch-countdown]');
  if (!element) return null;
  const remaining=Math.max(0,Math.ceil((new Date(element.dataset.expiresAt).getTime()-now)/1000));
  element.textContent=`${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`;
  return remaining;
}

export function createProviderOfferAlert({
  environment = globalThis, repeatMs = 1800,
  scheduleRepeat = environment.setInterval?.bind(environment),
  clearRepeat = environment.clearInterval?.bind(environment),
} = {}) {
  let activeOfferId = null; let timer; let audioContext;
  const pulse = () => {
    try {
      const AudioContext = environment.AudioContext || environment.webkitAudioContext;
      audioContext ??= AudioContext ? new AudioContext() : null;
      if (audioContext?.state !== 'running') return false;
      [784, 988].forEach((frequency, index) => {
        const oscillator=audioContext.createOscillator(); const gain=audioContext.createGain();
        oscillator.frequency.value=frequency; gain.gain.value=0.11;
        oscillator.connect(gain); gain.connect(audioContext.destination);
        oscillator.start(audioContext.currentTime+index*0.2); oscillator.stop(audioContext.currentTime+0.16+index*0.2);
      });
    } catch { /* iOS may keep audio suspended until a user gesture. */ }
    try { environment.navigator?.vibrate?.([240,100,240]); } catch { /* Optional capability. */ }
    return true;
  };
  const stop = (offerId = activeOfferId) => {
    if (offerId && activeOfferId && offerId !== activeOfferId) return false;
    if (timer !== undefined) clearRepeat?.(timer);
    timer=undefined; activeOfferId=null;
    try { environment.navigator?.vibrate?.(0); } catch { /* Optional capability. */ }
    return true;
  };
  const start = (offer) => {
    if (!offer?.id || offer.status && offer.status !== 'pending' || new Date(offer.expiresAt).getTime() <= Date.now()) return false;
    if (activeOfferId === offer.id) return false;
    stop(); activeOfferId=offer.id; pulse();
    timer=scheduleRepeat?.(pulse,repeatMs);
    return true;
  };
  const unlock = async () => {
    try {
      const AudioContext=environment.AudioContext||environment.webkitAudioContext;
      audioContext??=AudioContext?new AudioContext():null;
      await audioContext?.resume?.();
      if(activeOfferId)pulse();
      return audioContext?.state==='running';
    } catch { return false; }
  };
  return Object.freeze({start,stop,unlock,getActiveOfferId:()=>activeOfferId});
}

export function notifyIncomingOffer(environment = globalThis) {
  const alert=createProviderOfferAlert({environment,scheduleRepeat:()=>undefined});
  alert.start({id:'one-shot',status:'pending',expiresAt:new Date(Date.now()+1000).toISOString()});
  alert.stop();
}

export function createProviderDispatchController({
  repository, getState, onState, onOffer = () => {}, onError = () => {},
  scheduleTask = globalThis.setTimeout, clearTask = globalThis.clearTimeout,
  intervalMs = 2500, isPageActive = () => true,
}) {
  let stopped = false; let unsubscribe = () => {}; let pollTimer; let refreshPromise;
  let knownOfferIds = new Set((getState()?.offers ?? []).map(({ id }) => id));
  const performRefresh = async () => {
    try {
      const next = await repository.load();
      const changed = JSON.stringify(next) !== JSON.stringify(getState());
      const incoming = (next.offers ?? []).find(({ id }) => !knownOfferIds.has(id));
      knownOfferIds = new Set((next.offers ?? []).map(({ id }) => id));
      if (!stopped) { if (changed) onState(next); if (incoming) onOffer(incoming); }
    } catch (error) { if (!stopped) onError(error); }
  };
  const refresh = () => {
    if (!refreshPromise) refreshPromise = performRefresh().finally(() => { refreshPromise = undefined; });
    return refreshPromise;
  };
  const poll = async () => {
    if (!isPageActive()) return;
    await refresh();
  };
  const schedulePoll = () => {
    if (stopped) return;
    pollTimer = scheduleTask(async () => { await poll(); schedulePoll(); }, intervalMs);
  };
  const stop = () => {
    stopped = true;
    unsubscribe();
    if (pollTimer !== undefined) clearTask(pollTimer);
  };
  const start = () => {
    if (repository.source !== 'supabase' || typeof repository.subscribeDispatch !== 'function') return () => {};
    unsubscribe = repository.subscribeDispatch(refresh, (status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onError(new Error(`Provider Realtime: ${status}`));
    });
    schedulePoll();
    return stop;
  };
  return Object.freeze({ start, stop, refresh });
}
