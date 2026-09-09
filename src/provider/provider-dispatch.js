export function renderIncomingOffer(offer, now = Date.now()) {
  if (!offer) return '';
  const serviceLabels={electricity:'Điện',plumbing:'Nước','air-conditioning':'Điều hòa',appliances:'Điện gia dụng'};
  const remaining = Math.max(0, Math.ceil((new Date(offer.expiresAt).getTime() - now) / 1000));
  const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
  const seconds = String(remaining % 60).padStart(2, '0');
  const safe = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
  const service = safe(offer.serviceLabel ?? serviceLabels[offer.serviceCategory] ?? offer.serviceCategory);
  return `<section class="dispatch-offer" data-dispatch-offer-id="${safe(offer.id)}" role="dialog" aria-modal="true" aria-labelledby="dispatch-title">
    <header class="dispatch-hero">
      <div class="dispatch-beacon" aria-hidden="true"><i></i><i></i><i></i><div class="dispatch-pulse"><svg viewBox="0 0 48 48"><path d="M24 6a3 3 0 0 1 3 3v1c7 1 11 7 11 15v7l4 5H6l4-5v-7c0-8 4-14 11-15V9a3 3 0 0 1 3-3Z"/><path d="M18 40a6 6 0 0 0 12 0Z"/></svg></div></div>
      <h1 id="dispatch-title">Có nhiệm vụ mới!</h1>
      <p class="dispatch-subtitle">${service} · ${safe(offer.approximateAddress)}</p>
    </header>
    <div class="dispatch-panel">
      <article class="dispatch-card">
        <div class="dispatch-service"><span class="dispatch-service-icon" aria-hidden="true">${offer.serviceCategory==='electricity'?'ϟ':'⚒'}</span><div><h2>${service}</h2><p class="dispatch-request">${safe(offer.request)}</p></div></div>
        <div class="dispatch-location"><span aria-hidden="true">⌖</span><div><small>Khu vực hỗ trợ</small><strong>${safe(offer.approximateAddress)}</strong></div></div>
        <div class="dispatch-facts"><div><small>Khoảng cách</small><strong>${offer.distanceKm!=null?Number(offer.distanceKm).toFixed(1)+' km':'Đang cập nhật'}</strong></div><div><small>Thời gian đến</small><strong>${offer.etaMinutes!=null?'ETA '+safe(offer.etaMinutes)+' phút':'Đang cập nhật'}</strong></div></div>
        ${offer.indicativeAmount != null ? `<div class="dispatch-price"><small>Giá tham khảo</small><strong>${new Intl.NumberFormat('vi-VN').format(offer.indicativeAmount)}${offer.currency === 'VND' || !offer.currency ? 'đ' : ` ${safe(offer.currency)}`}</strong></div>` : ''}
      </article>
      <footer class="dispatch-footer">
        <div class="dispatch-time"><strong class="dispatch-countdown" data-dispatch-countdown data-expires-at="${safe(offer.expiresAt)}">${minutes}:${seconds}</strong><span>Thời gian chấp nhận</span></div>
        <div class="dispatch-actions"><button data-decline="${safe(offer.id)}"><span aria-hidden="true">×</span> TỪ CHỐI</button><button data-accept="${safe(offer.id)}"><span aria-hidden="true">✓</span> NHẬN VIỆC</button></div>
        <button class="dispatch-audio" data-enable-offer-audio>♫ Chạm để bật âm thanh</button>
      </footer>
    </div>
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
  const audioStorageKey='home-ai-provider-audio-unlocked';
  let activeOfferId = null; let timer; let audioContext; let audioError=''; const activeOscillators=new Set();
  const rememberAudioUnlock=()=>{try{environment.sessionStorage?.setItem(audioStorageKey,'true');}catch{/* Storage is optional. */}};
  const formatAudioError=error=>`${error?.name??'AudioError'}${error?.message?`: ${error.message}`:''}`;
  const prepare = () => {
    if(audioContext)return audioContext;
    try{
      const AudioContext=environment.AudioContext||environment.webkitAudioContext;
      audioContext=AudioContext?new AudioContext():null;
      if(!audioContext)audioError='AudioContextUnavailable';
    }catch(error){audioError=formatAudioError(error);}
    return audioContext;
  };
  const playTone = () => {
    if(prepare()?.state!=='running')return false;
    [784,988].forEach((frequency,index)=>{
      const oscillator=audioContext.createOscillator();const gain=audioContext.createGain();
      oscillator.frequency.value=frequency;gain.gain.value=0.11;
      oscillator.connect(gain);gain.connect(audioContext.destination);
      activeOscillators.add(oscillator);oscillator.onended=()=>activeOscillators.delete(oscillator);
      oscillator.start(audioContext.currentTime+index*0.2);oscillator.stop(audioContext.currentTime+0.16+index*0.2);
    });
    audioError='';
    return true;
  };
  const pulse = () => {
    try { playTone(); } catch(error) { audioError=formatAudioError(error); }
    try { environment.navigator?.vibrate?.([240,100,240]); } catch { /* Optional capability. */ }
    return audioContext?.state==='running';
  };
  const stop = (offerId = activeOfferId) => {
    if (offerId && activeOfferId && offerId !== activeOfferId) return false;
    if (timer !== undefined) clearRepeat?.(timer);
    timer=undefined; activeOfferId=null;
    activeOscillators.forEach(oscillator=>{try{oscillator.stop();}catch{/* It may already have ended. */}});activeOscillators.clear();
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
      const context=prepare();
      if(!context)return false;
      await context.resume?.();
      if(context.state!=='running')throw Object.assign(new Error(`AudioContext state: ${context.state}`),{name:'NotAllowedError'});
      rememberAudioUnlock();audioError='';
      if(activeOfferId)playTone();
      return true;
    } catch(error) { audioError=formatAudioError(error);return false; }
  };
  return Object.freeze({
    start,stop,unlock,prepare,
    getActiveOfferId:()=>activeOfferId,
    isAudioEnabled:()=>audioContext?.state==='running',
    needsAudioActivation:()=>audioContext?.state==='suspended'||audioContext?.state==='interrupted',
    getAudioError:()=>audioError,
  });
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
