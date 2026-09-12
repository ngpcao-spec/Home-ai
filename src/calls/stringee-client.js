const stateNames = new Map([[3, 'answered'], [5, 'rejected'], [6, 'ended']]);

function normalizedState(event) {
  const raw = event?.code ?? event?.state ?? event?.signalingState ?? event;
  if (typeof raw === 'number') return stateNames.get(raw) ?? 'unknown';
  const value = String(raw ?? '').toLowerCase();
  if (value.includes('answer')) return 'answered';
  if (value.includes('busy') || value.includes('reject')) return 'rejected';
  if (value.includes('end')) return 'ended';
  return value || 'unknown';
}

function sdkAction(call, method) {
  return new Promise((resolve, reject) => {
    if (!call || typeof call[method] !== 'function') return reject(new Error(`Stringee ${method} is unavailable`));
    const timer = setTimeout(() => reject(new Error(`Stringee ${method} timeout`)), 15000);
    call[method](result => {
      clearTimeout(timer);
      if (result && typeof result.r === 'number' && result.r !== 0) {
        reject(new Error(`Stringee ${method} failed (${result.r})`));
      } else resolve(result ?? null);
    });
  });
}

export function createStringeeAudioClient({
  sdk,
  missionCalls,
  tokens,
  onIncomingCall = () => {},
  onStateChange = () => {},
  onError = () => {},
  onRemoteStream = () => {},
  waitForAuthentication = false,
}) {
  if (typeof sdk?.StringeeClient !== 'function' || typeof sdk?.StringeeCall !== 'function') {
    throw new TypeError('Stringee Web SDK is required');
  }
  if (!missionCalls || !tokens) throw new TypeError('Call authority and token provider are required');

  const client = new sdk.StringeeClient();
  const synchronized = new Map();
  let connection = null;
  let active = null;
  let incoming = null;
  let listenersBound = false;
  let authenticate;
  let intentionalDisconnect = false;
  const locallyExpired = new Set();
  const earlyRemoteStreams = new WeakMap();
  const incomingMicrophones = new WeakMap();
  const authorizedMicrophones = new WeakSet();
  const boundIncomingCalls = new WeakSet();
  const seenIncomingCalls = new WeakSet();

  const syncOnce = (key, operation) => {
    if (synchronized.has(key)) return synchronized.get(key);
    const pending = Promise.resolve().then(operation).catch(error => {
      synchronized.delete(key);
      onError(error);
      throw error;
    });
    synchronized.set(key, pending);
    return pending;
  };

  const bindCall = (call, missionCall, direction) => {
    if (active?.call === call) return active;
    active = { call, missionCall, direction };
    // StringeeCall.on replaces a handler instead of appending it. Keep the
    // incoming capture/forward handler installed once throughout authorization.
    if (direction === 'incoming') boundIncomingCalls.add(call);
    else call.on('addremotestream', stream => onRemoteStream(stream));
    const earlyStream = earlyRemoteStreams.get(call);
    if (earlyStream) { earlyRemoteStreams.delete(call); onRemoteStream(earlyStream); }
    call.on('error', event => onError(Object.assign(new Error('Stringee audio connection failed'), {
      name: event?.reason === 'GET_USER_MEDIA_ERROR' ? 'NotAllowedError' : 'StringeeError',
    })));
    let answered = missionCall.status === 'active';
    call.on('signalingstate', event => {
      const state = normalizedState(event);
      if (state === 'answered') answered = true;
      onStateChange({ state, missionCall });
      if (state === 'answered' && direction === 'incoming') {
        void syncOnce(`${missionCall.id}:answer`, () => missionCalls.answer(missionCall.id)).catch(() => {});
      }
      if (state === 'rejected' && direction === 'incoming') {
        void syncOnce(`${missionCall.id}:decline`, () => missionCalls.decline(missionCall.id)).catch(() => {});
      }
      if (state === 'ended' && !locallyExpired.has(missionCall.id)
          && (answered || !Number.isFinite(Date.parse(missionCall.expires_at)) || Date.parse(missionCall.expires_at) > Date.now())) {
        void syncOnce(`${missionCall.id}:end`, () => missionCalls.end(missionCall.id)).catch(() => {});
      }
    });
    return active;
  };

  const refreshToken = async () => {
    const issued = await tokens.issue();
    intentionalDisconnect = false;
    let timer;
    const ready = waitForAuthentication ? new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Stringee connection timeout')), 12000);
      authenticate = result => result?.r === 0 ? resolve() : reject(new Error(`Stringee authentication failed (${result?.r ?? 'unknown'})`));
    }) : Promise.resolve();
    connection = issued;
    try { client.connect(issued.accessToken); await ready; }
    catch (error) { connection = null; throw error; }
    finally { clearTimeout(timer); authenticate = null; }
    return issued;
  };

  const bindClientListeners = () => {
    if (listenersBound) return;
    listenersBound = true;
    client.on('incomingcall', call => {
      if (seenIncomingCalls.has(call)) return;
      seenIncomingCalls.add(call);
      incoming = call;
      // The legacy SDK negotiates media before answer. Keep the microphone muted
      // until HOME AI authorizes the callee's explicit answer, and preserve a
      // remote stream that arrives while the participant RPC is in flight.
      call.on('addlocalstream', stream => {
        incomingMicrophones.set(call, stream);
        stream?.getAudioTracks?.().forEach(track => { track.enabled = authorizedMicrophones.has(call); });
      });
      call.on('addremotestream', stream => {
        if (boundIncomingCalls.has(call)) onRemoteStream(stream);
        else earlyRemoteStreams.set(call, stream);
      });
      onIncomingCall();
    });
    client.on('authen', result => authenticate?.(result));
    client.on('disconnect', () => {
      if (!intentionalDisconnect) { connection = null; onError(new Error('Stringee connection lost')); }
    });
    client.on('requestnewtoken', () => { void refreshToken().catch(onError); });
  };

  const resolveIncoming = async missionId => {
    if (!incoming) throw new Error('No incoming Stringee call');
    const candidate = incoming;
    const missionCall = await missionCalls.current(missionId);
    if (!missionCall?.id || missionCall.status !== 'ringing') throw new Error('No authorized ringing mission call');
    const route = await tokens.issue(missionCall.id);
    if (incoming !== candidate) throw new Error('Incoming Stringee call changed during authorization');
    if (route.participantRole !== 'callee') throw new Error('Only the mission call callee can answer');
    const from = incoming.fromNumber ?? incoming.from ?? '';
    if (from !== route.peerUserId) throw new Error('Incoming Stringee identity does not match mission authority');
    if (incoming.custom && incoming.custom !== missionCall.room_name) throw new Error('Incoming Stringee route does not match mission authority');
    if (incoming.isVideoCall === true || incoming.video === true) throw new Error('Video calls are not supported');
    bindCall(incoming, missionCall, 'incoming');
    return { call: incoming, missionCall };
  };

  return Object.freeze({
    async connect() {
      bindClientListeners();
      return refreshToken();
    },
    async startAudioCall(missionId) {
      if (!connection) throw new Error('Stringee client is not connected');
      const missionCall = await missionCalls.start(missionId);
      try {
      const route = await tokens.issue(missionCall.id);
      if (route.participantRole !== 'caller' || route.userId !== connection.userId) {
        await missionCalls.end(missionCall.id);
        throw new Error('Stringee route does not match mission authority');
      }
      const call = new sdk.StringeeCall(client, route.userId, route.peerUserId, false);
      if (!/^call_[0-9a-f]{32}$/.test(missionCall.room_name ?? '')) {
        await missionCalls.end(missionCall.id);
        throw new Error('Mission call routing identity is unavailable');
      }
      call.custom = missionCall.room_name;
      bindCall(call, missionCall, 'outgoing');
      try { await sdkAction(call, 'makeCall'); }
      catch (error) { await syncOnce(`${missionCall.id}:end`, () => missionCalls.end(missionCall.id)); throw error; }
      return missionCall;
      } catch (error) {
        await syncOnce(`${missionCall.id}:end`, () => missionCalls.end(missionCall.id)).catch(() => {});
        throw error;
      }
    },
    async answerIncoming(missionId) {
      const context = await resolveIncoming(missionId);
      await sdkAction(context.call, 'answer');
      const answered = await syncOnce(`${context.missionCall.id}:answer`, () => missionCalls.answer(context.missionCall.id));
      if (answered?.status && answered.status !== 'active') throw new Error('Mission call answer is no longer authorized');
      authorizedMicrophones.add(context.call);
      incomingMicrophones.get(context.call)?.getAudioTracks?.().forEach(track => { track.enabled = true; });
      return answered ?? context.missionCall;
    },
    async rejectIncoming(missionId) {
      const context = await resolveIncoming(missionId);
      await sdkAction(context.call, 'reject');
      await syncOnce(`${context.missionCall.id}:decline`, () => missionCalls.decline(context.missionCall.id));
      return context.missionCall;
    },
    async authorizeIncoming(missionId) {
      return (await resolveIncoming(missionId)).missionCall;
    },
    endAuthority(callId) {
      return syncOnce(`${callId}:end`, () => missionCalls.end(callId));
    },
    async hangup() {
      if (!active) return null;
      const previous = active; active = null; incoming = null;
      try { await sdkAction(previous.call, 'hangup'); }
      finally { await syncOnce(`${previous.missionCall.id}:end`, () => missionCalls.end(previous.missionCall.id)); }
    },
    async expireLocally() {
      if (!active) return;
      const previous = active; active = null; incoming = null;
      locallyExpired.add(previous.missionCall.id);
      await sdkAction(previous.call, 'hangup');
    },
    mute(value = true) {
      if (!active?.call || typeof active.call.mute !== 'function') throw new Error('No active Stringee call');
      active.call.mute(Boolean(value));
    },
    disconnect() {
      intentionalDisconnect = true;
      client.disconnect();
      connection = null;
      active = null;
      incoming = null;
    },
  });
}
