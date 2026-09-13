const liveOptions = Object.freeze({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
const idleOptions = Object.freeze({ enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });

function normalizePosition(position) {
  const latitude = Number(position?.coords?.latitude);
  const longitude = Number(position?.coords?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error('Invalid provider location');
  }
  return Object.freeze({
    latitude,
    longitude,
    accuracy: Number.isFinite(Number(position.coords.accuracy)) ? Number(position.coords.accuracy) : null,
    observedAt: Number.isFinite(Number(position.timestamp)) ? Number(position.timestamp) : Date.now(),
  });
}

function readPosition(geolocation) {
  if (!geolocation?.getCurrentPosition) return Promise.reject(new Error('Geolocation unavailable'));
  return new Promise((resolve, reject) => geolocation.getCurrentPosition(resolve, reject, idleOptions));
}

export function createProviderLocationHeartbeat({
  repository,
  getState,
  geolocation = globalThis.navigator?.geolocation,
  intervalMs = 60000,
  scheduleTask = globalThis.setTimeout,
  clearTask = globalThis.clearTimeout,
  isPageActive = () => !globalThis.document?.hidden,
  onState = () => {},
  onError = () => {},
  onDiagnostic = () => {},
}) {
  let timer;
  let watchId;
  let stopped = false;
  let generation = 0;
  let lastObservedAt = -Infinity;
  let writeQueue = Promise.resolve();

  const stateMode = () => {
    const state = getState();
    if (stopped || repository.source !== 'supabase' || !state?.status?.online || !isPageActive()) return 'off';
    if (state.assignment?.status === 'travelling') return 'tracking';
    if (!state.assignment && state.status.available) return 'idle';
    return 'off';
  };
  const clearTimer = () => {
    if (timer !== undefined) clearTask(timer);
    timer = undefined;
  };
  const clearWatch = () => {
    if (watchId !== undefined) geolocation?.clearWatch?.(watchId);
    watchId = undefined;
    generation += 1;
  };
  const publish = (browserPosition, expectedGeneration = generation, expectedMode = stateMode()) => {
    let position;
    try { position = normalizePosition(browserPosition); }
    catch (error) { onError(error); return Promise.resolve(null); }
    if (position.observedAt <= lastObservedAt) {
      onDiagnostic({ stage: 'provider', outcome: 'stale-ignored' });
      return Promise.resolve(null);
    }
    lastObservedAt = position.observedAt;
    writeQueue = writeQueue.then(async () => {
      if (stopped || expectedGeneration !== generation || stateMode() !== expectedMode) return null;
      const next = await repository.updateLocation({ latitude: position.latitude, longitude: position.longitude });
      onDiagnostic({ stage: 'backend', outcome: 'accepted', observedAt: position.observedAt, accuracy: position.accuracy });
      await onState(next);
      return next;
    }).catch((error) => { onError(error); return null; });
    return writeQueue;
  };
  const scheduleIdle = () => {
    clearTimer();
    if (stateMode() === 'idle') timer = scheduleTask(refresh, intervalMs);
  };
  const refresh = async () => {
    if (stateMode() !== 'idle') return null;
    const expectedGeneration = generation;
    try {
      return await publish(await readPosition(geolocation), expectedGeneration, 'idle');
    } catch (error) {
      onError(error);
      return null;
    } finally {
      scheduleIdle();
    }
  };
  const startTracking = () => {
    if (watchId !== undefined || stateMode() !== 'tracking') return;
    if (!geolocation?.watchPosition) {
      onError(new Error('Continuous geolocation unavailable'));
      return;
    }
    const expectedGeneration = generation;
    watchId = geolocation.watchPosition(
      position => publish(position, expectedGeneration, 'tracking'),
      error => onError(error),
      liveOptions,
    );
    onDiagnostic({ stage: 'provider', outcome: 'watch-started' });
  };
  const sync = () => {
    clearTimer();
    const mode = stateMode();
    if (mode !== 'tracking') clearWatch();
    if (mode === 'tracking') startTracking();
    else if (mode === 'idle') void refresh();
  };
  const stop = () => {
    stopped = true;
    clearTimer();
    clearWatch();
    onDiagnostic({ stage: 'provider', outcome: 'watch-stopped' });
  };

  return Object.freeze({ refresh, sync, stop });
}
