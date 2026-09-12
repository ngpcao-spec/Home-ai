import { createStringeeAudioClient } from './stringee-client.js';
import { loadStringeeSdk } from './stringee-sdk.js';
import { createCallAudio } from './call-audio.js';

export const callableMissionStatuses = Object.freeze([
  'accepted', 'travelling', 'arrived', 'quote_pending', 'in_progress',
  'supplement_pending', 'completed_pending_payment',
]);
export const missionAllowsCalls = mission => Boolean(mission?.id && callableMissionStatuses.includes(mission.status));
export function createMissionCallButton(mission, role, enabled = true) {
  return enabled && missionAllowsCalls(mission)
    ? `<button type="button" class="mission-call-start" data-mission-call-start>${role === 'provider' ? 'Gọi khách hàng' : 'Gọi cho thợ'}</button>` : '';
}
const managers = new WeakMap();
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const serviceLabels = { electricity: 'Thợ điện', plumbing: 'Thợ sửa ống nước', 'air-conditioning': 'Thợ điều hòa', appliances: 'Thợ sửa điện gia dụng' };
const isOpen = call => ['ringing', 'active'].includes(call?.status);
function errorMessage(error) {
  if (['NotAllowedError', 'PermissionDeniedError'].includes(error?.name)) return 'Không có quyền sử dụng micro. Vui lòng cho phép micro trong Safari rồi thử lại.';
  if (error?.name === 'NotFoundError') return 'Không tìm thấy micro. Vui lòng kiểm tra thiết bị.';
  if (String(error?.message).includes('connection')) return 'Kết nối cuộc gọi bị gián đoạn. Vui lòng thử lại.';
  return 'Không thể kết nối cuộc gọi. Vui lòng thử lại.';
}

// One manager per application document. Neither a GPS tick nor screen navigation
// owns these resources. Existing mission dispatch polling supplies observe().
export function getGlobalCallManager(options) {
  const documentRef = options.documentRef ?? globalThis.document;
  if (!managers.has(documentRef)) managers.set(documentRef, createCallManager({ ...options, documentRef }));
  return managers.get(documentRef);
}

export function createCallManager({
  documentRef = globalThis.document, userId, role, missionCalls, tokens,
  sdkLoader = loadStringeeSdk, transportFactory = createStringeeAudioClient,
  audio = createCallAudio(documentRef), now = Date.now,
  scheduleInterval = setInterval, clearIntervalTask = clearInterval,
}) {
  if (!userId || !missionCalls || !tokens) throw new TypeError('Authenticated call services are required');
  if (!documentRef.querySelector('[data-mission-call-styles]')) {
    const link = documentRef.createElement('link'); link.rel = 'stylesheet';
    link.href = new URL('./mission-call.css', import.meta.url).href;
    link.dataset.missionCallStyles = ''; documentRef.head.append(link);
  }
  const host = documentRef.createElement('div'); host.dataset.missionCallLayer = '';
  host.style.position='relative';host.style.zIndex='2147483647';
  documentRef.body.append(host);
  let context = null; let call = null; let transport; let connecting; let phase = null;
  let muted = false; let busy = false; let error = ''; let timer; let startedAt = null; let disposed = false;
  let transportReady = false; let acceptingSdk = false;
  let remoteStream = null;
  let attachedRemoteStream = null;
  const closedIds = new Set();
  const showError = message => {
    error = message;
    if (!phase) { host.innerHTML = `<p class="mission-call-notice" role="alert">${escape(error)}</p>`; return; }
    const element = host.querySelector('[data-call-error]');
    if (element) { element.textContent = error; element.hidden = false; }
  };
  const updateControls = () => {
    host.querySelectorAll('[data-call-action]').forEach(button => { button.disabled = busy; });
    const activation = host.querySelector('[data-call-action="audio"]');
    if (activation) activation.hidden = !audio.needsActivation();
    const mute = host.querySelector('[data-call-action="mute"]');
    if (mute) { mute.textContent = muted ? 'Bật micro' : 'Tắt micro'; mute.setAttribute('aria-pressed', String(muted)); }
    const notice = host.querySelector('[data-call-error]');
    if (notice) { notice.textContent = error; notice.hidden = !error; }
    documentRef.querySelectorAll('[data-mission-call-start]').forEach(button => { button.disabled = busy || isOpen(call); });
  };
  const clearScreen = status => {
    if (call?.id) closedIds.add(call.id);
    call = null; phase = null; startedAt = null; muted = false; busy = false;
    remoteStream = null;
    attachedRemoteStream = null;
    clearIntervalTask(timer); timer = undefined; audio.clear(); host.replaceChildren();
    if (status === 'declined') showError('Cuộc gọi đã bị từ chối. Bạn có thể gọi lại.');
    if (status === 'missed') showError('Cuộc gọi nhỡ. Bạn có thể gọi lại.');
    updateControls();
  };
  const render = nextPhase => {
    if (phase === nextPhase && host.querySelector('.mission-call-screen')) { updateControls(); return; }
    phase = nextPhase;
    // Only a new call/phase moves the host, above the Provider offer layer.
    documentRef.body.append(host);
    const peer = context?.peer ?? {};
    const name = peer.name || (role === 'provider' ? 'Khách hàng HOME AI' : 'Thợ HOME AI');
    const avatarUrl = /^https?:\/\//.test(peer.avatarUrl ?? '') ? peer.avatarUrl : null;
    const avatar = avatarUrl ? `<img src="${escape(avatarUrl)}" alt="${escape(name)}">` : escape(name.split(/\s+/).filter(Boolean).slice(-2).map(part => part[0]).join(''));
    const title = phase === 'incoming' ? (role === 'provider' ? 'Khách hàng đang gọi' : 'Thợ đang gọi') : phase === 'outgoing' ? 'Đang gọi…' : 'Đang gọi';
    host.innerHTML = `<section class="mission-call-screen" data-phase="${phase}" role="dialog" aria-modal="true" aria-labelledby="mission-call-title">
      <p id="mission-call-title">${title}</p><div class="mission-call-avatar">${avatar}</div><h2>${escape(name)}</h2>
      <p>${escape(serviceLabels[context?.mission?.serviceCategory] ?? 'Dịch vụ HOME AI')}</p>
      <p class="mission-call-duration" data-call-duration ${phase === 'active' ? '' : 'hidden'}>00:00</p>
      <p class="mission-call-error" data-call-error role="alert" ${error ? '' : 'hidden'}>${escape(error)}</p>
      ${phase === 'active' ? '<button data-call-action="mute" aria-pressed="false">Tắt micro</button>' : ''}
      <div class="mission-call-actions">${phase === 'incoming' ? '<button data-call-action="decline">Từ chối</button><button data-call-action="answer">Nghe máy</button>' : '<button data-call-action="end">Kết thúc</button>'}</div>
      <button data-call-action="audio">Chạm để bật âm thanh</button></section>`;
    updateControls();
  };
  const closeTransportCall = async (expired = false) => {
    try { if (expired) await transport?.expireLocally(); else await transport?.hangup(); } catch { /* Backend termination still applies. */ }
  };
  const finish = async ({ disconnect = false, status = 'ended' } = {}) => {
    const previous = call;
    clearScreen(status); // Audio and overlay stop immediately, before network work.
    const authorityEnd = previous?.id && !['missed', 'declined'].includes(status)
      ? (transport?.endAuthority ? transport.endAuthority(previous.id) : missionCalls.end(previous.id)).catch(() => {}) : Promise.resolve();
    await closeTransportCall(status === 'missed');
    await authorityEnd;
    if (disconnect) { transport?.disconnect(); transportReady = false; }
  };
  const tick = () => {
    if (phase === 'active') {
      const seconds = Math.max(0, Math.floor((now() - startedAt) / 1000));
      const duration = host.querySelector('[data-call-duration]');
      if (duration) duration.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    } else if (call?.status === 'ringing' && Date.parse(call.expires_at) <= now()) {
      // The existing server cron expires ringing calls. Never turn an unanswered
      // expired call into "ended" merely by closing local SDK media.
      const missionId = context?.mission?.id;
      clearScreen('missed'); void closeTransportCall(true);
      if (missionId) void missionCalls.current(missionId).catch(() => {});
    }
  };
  const keepTimer = () => { timer ??= scheduleInterval(tick, 1000); };
  const playRemoteStream = () => {
    if (!remoteStream || phase !== 'active' || attachedRemoteStream === remoteStream) return;
    attachedRemoteStream = remoteStream;
    void audio.attach(remoteStream).catch(() => {
      showError('Không thể phát âm thanh. Chạm để bật âm thanh.');updateControls();
    });
  };
  const stateChanged = ({ state, missionCall }) => {
    if (closedIds.has(missionCall.id) || context?.mission?.id !== missionCall.mission_id) return;
    call = { ...missionCall, ...call };
    if (state === 'answered') {
      audio.stopRinging(); call = { ...call, status: 'active' };
      startedAt ??= now(); render('active'); playRemoteStream(); keepTimer();
    } else if (['rejected', 'ended'].includes(state)) {
      clearScreen(state === 'rejected' ? 'declined' : call.status === 'ringing' && Date.parse(call.expires_at) <= now() ? 'missed' : 'ended');
      // Callee-only decline is synchronized by the SDK adapter/answering app.
    }
  };
  const incoming = async () => {
    if (acceptingSdk || !missionAllowsCalls(context?.mission)) return;
    acceptingSdk = true;
    try {
      const authorized = await transport.authorizeIncoming(context.mission.id);
      if (disposed || !missionAllowsCalls(context?.mission) || closedIds.has(authorized.id)) { await closeTransportCall(); return; }
      call = authorized; error = ''; render('incoming'); audio.ring(); keepTimer();
    } catch { showError('Cuộc gọi không còn khả dụng.'); }
    finally { acceptingSdk = false; }
  };
  const ensureConnection = () => {
    if (transportReady) return Promise.resolve();
    if (connecting) return connecting;
    connecting = (async () => {
      if (!transport) transport = transportFactory({
        sdk: await sdkLoader(documentRef), missionCalls, tokens, waitForAuthentication: true,
        onIncomingCall: () => { void incoming(); }, onStateChange: stateChanged,
        onRemoteStream: stream => { remoteStream=stream;playRemoteStream(); },
        onError: failure => { void finish({ disconnect: true }).then(() => showError(errorMessage(failure))); },
      });
      await transport.connect(); transportReady = true;
      if (disposed || !missionAllowsCalls(context?.mission)) { transport.disconnect(); transportReady = false; }
    })().finally(() => { connecting = null; });
    return connecting;
  };
  const observe = ({ mission, peer = null, currentCall = null, callLoaded = false, callEvent = null }) => {
    if (context?.mission?.id && context.mission.id !== mission?.id && call) void finish({disconnect:true});
    context = { mission: mission ? { id: mission.id, status: mission.status, serviceCategory: mission.serviceCategory } : null,
      // Intentionally project just the public fields needed by the call UI.
      peer: peer ? { name: peer.name, avatarUrl: peer.avatarUrl } : null };
    if (!missionAllowsCalls(mission)) {
      if (call || transportReady) void finish({ disconnect: true });
      updateControls(); return;
    }
    if (callLoaded && !currentCall && call && !busy) {
      const status = callEvent?.status ?? (call.status === 'ringing' && Date.parse(call.expires_at) <= now() ? 'missed' : 'ended');
      void finish({status});
    }
    // Foreground callees must already be connected to receive incomingcall.
    void ensureConnection().catch(() => showError('Không thể kết nối cuộc gọi. Vui lòng thử lại.'));
    if (currentCall && currentCall.mission_id === mission.id && !closedIds.has(currentCall.id)) {
      if (!isOpen(currentCall)) { if (call?.id === currentCall.id) void finish({ status: currentCall.status }); }
      else {
        if (![currentCall.caller_user_id, currentCall.callee_user_id].includes(userId)) return;
        if (call?.id !== currentCall.id) error = '';
        call = currentCall;
        if (currentCall.status === 'active') { audio.stopRinging(); startedAt ??= Date.parse(currentCall.answered_at) || now(); render('active');playRemoteStream(); }
        else if (currentCall.callee_user_id === userId) { render('incoming'); audio.ring(); }
        else render('outgoing');
        keepTimer();
      }
    }
    updateControls();
  };
  const start = async () => {
    if (busy || isOpen(call) || !missionAllowsCalls(context?.mission)) return;
    const missionId = context.mission.id; busy = true; error = ''; updateControls();
    // This Promise starts microphone activation synchronously in the tap handler.
    const microphone = audio.prepareMicrophone();
    try {
      await microphone; await ensureConnection();
      if (context?.mission?.id !== missionId || !missionAllowsCalls(context.mission)) return;
      const started = await transport.startAudioCall(missionId);
      if (disposed || context?.mission?.id !== missionId || !missionAllowsCalls(context.mission)) { call = started; await finish({ disconnect: true }); return; }
      if (!closedIds.has(started.id)) { call = { ...started, ...call }; render(call.status === 'active' ? 'active' : 'outgoing'); keepTimer(); }
    } catch (failure) { showError(errorMessage(failure)); }
    finally { busy = false; updateControls(); }
  };
  const action = async value => {
    if (busy && value !== 'end') return;
    if (value === 'audio') { try { await audio.activate(); error = ''; } catch { showError('Safari chưa cho phép âm thanh. Vui lòng chạm để thử lại.'); } updateControls(); return; }
    if (!call || !missionAllowsCalls(context?.mission)) return;
    if (value === 'mute') { try { transport.mute(!muted); muted = !muted; updateControls(); } catch { showError('Không thể thay đổi micro.'); } return; }
    if (value === 'end') { await finish(); return; }
    if (value === 'answer') {
      busy = true; updateControls();
      const microphone = audio.prepareMicrophone();
      try { await microphone; await ensureConnection(); await transport.answerIncoming(context.mission.id); audio.stopRinging(); }
      catch (failure) { await finish(); showError(errorMessage(failure)); }
      finally { busy = false; updateControls(); }
    } else if (value === 'decline') {
      const previous = call; clearScreen('declined');
      try { await transport.rejectIncoming(context.mission.id); }
      catch { await missionCalls.decline(previous.id).catch(() => showError('Không thể từ chối cuộc gọi. Vui lòng thử lại.')); await closeTransportCall(); }
    }
  };
  const click = event => {
    const startButton = event.target.closest?.('[data-mission-call-start]');
    if (startButton) void start();
    const control = event.target.closest?.('[data-call-action]');
    if (control && host.contains(control)) void action(control.dataset.callAction);
    else if (!startButton) void audio.activate().then(updateControls).catch(() => {});
  };
  documentRef.addEventListener('click', click);
  const dispose = () => {
    if (disposed) return; disposed = true; void finish({ disconnect: true });
    documentRef.removeEventListener('click', click); audio.dispose(); host.remove(); managers.delete(documentRef);
  };
  documentRef.defaultView?.addEventListener('pagehide', dispose, { once: true });
  return Object.freeze({ observe, start, action, dispose, host, reportError:showError,
    getState: () => ({ phase, muted, busy, callId: call?.id ?? null, connected:transportReady }) });
}
