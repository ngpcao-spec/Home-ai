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
    call[method](result => {
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
    call.on('addremotestream', stream => onRemoteStream(stream));
    call.on('signalingstate', event => {
      const state = normalizedState(event);
      onStateChange({ state, missionCall });
      if (state === 'answered' && direction === 'incoming') {
        void syncOnce(`${missionCall.id}:answer`, () => missionCalls.answer(missionCall.id));
      }
      if (state === 'rejected' && direction === 'incoming') {
        void syncOnce(`${missionCall.id}:decline`, () => missionCalls.decline(missionCall.id));
      }
      if (state === 'ended') {
        void syncOnce(`${missionCall.id}:end`, () => missionCalls.end(missionCall.id));
      }
    });
    return active;
  };

  const refreshToken = async () => {
    const issued = await tokens.issue();
    connection = issued;
    client.connect(issued.accessToken);
    return issued;
  };

  const bindClientListeners = () => {
    if (listenersBound) return;
    listenersBound = true;
    client.on('incomingcall', call => {
      incoming = call;
      onIncomingCall();
    });
    client.on('requestnewtoken', () => { void refreshToken().catch(onError); });
  };

  const resolveIncoming = async missionId => {
    if (!incoming) throw new Error('No incoming Stringee call');
    const missionCall = await missionCalls.current(missionId);
    if (!missionCall?.id || missionCall.status !== 'ringing') throw new Error('No authorized ringing mission call');
    const route = await tokens.issue(missionCall.id);
    if (route.participantRole !== 'callee') throw new Error('Only the mission call callee can answer');
    const from = incoming.fromNumber ?? incoming.from ?? '';
    if (from && from !== route.peerUserId) throw new Error('Incoming Stringee identity does not match mission authority');
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
    },
    async answerIncoming(missionId) {
      const context = await resolveIncoming(missionId);
      await sdkAction(context.call, 'answer');
      await syncOnce(`${context.missionCall.id}:answer`, () => missionCalls.answer(context.missionCall.id));
      return context.missionCall;
    },
    async rejectIncoming(missionId) {
      const context = await resolveIncoming(missionId);
      await sdkAction(context.call, 'reject');
      await syncOnce(`${context.missionCall.id}:decline`, () => missionCalls.decline(context.missionCall.id));
      return context.missionCall;
    },
    async hangup() {
      if (!active) return null;
      await sdkAction(active.call, 'hangup');
      return syncOnce(`${active.missionCall.id}:end`, () => missionCalls.end(active.missionCall.id));
    },
    mute(value = true) {
      if (!active?.call || typeof active.call.mute !== 'function') throw new Error('No active Stringee call');
      active.call.mute(Boolean(value));
    },
    disconnect() {
      client.disconnect();
      connection = null;
      active = null;
      incoming = null;
    },
  });
}
