const liveOptions = Object.freeze({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
const idleOptions = Object.freeze({ enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });

function normalizePosition(position) {
  const latitude = position?.coords?.latitude;
  const longitude = position?.coords?.longitude;
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
  minAbsolutePublishIntervalMs = 2000,
  minPublishIntervalMs = 5000,
  minPublishDistanceMeters = 20,
  scheduleTask = globalThis.setTimeout,
  clearTask = globalThis.clearTimeout,
  isPageActive = () => !globalThis.document?.hidden,
  onState = () => {},
  onError = () => {},
  onDiagnostic = () => {},
  onPosition = () => {},
}) {
  let timer;
  let watchId;
  let stopped = false;
  let generation = 0;
  let lastObservedAt = -Infinity;
  let writeQueue = Promise.resolve();
  let lastPublishedPosition = null;
  let lastPublishedAt = -Infinity;

  const distanceMeters = (left, right) => {
    if (!left || !right) return Infinity;
    const radians = value => value * Math.PI / 180;
    const latitudeDelta = radians(right.latitude - left.latitude);
    const longitudeDelta = radians(right.longitude - left.longitude);
    const a = Math.sin(latitudeDelta / 2) ** 2
      + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude))
      * Math.sin(longitudeDelta / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

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
    if (watchId !== undefined) {
      geolocation?.clearWatch?.(watchId);
      onDiagnostic({ stage: 'provider', outcome: 'watch-stopped' });
    }
    watchId = undefined;
    generation += 1;
  };
  const publish = (browserPosition, expectedGeneration = generation, expectedMode = stateMode()) => {
    onDiagnostic({ stage: 'provider', outcome: 'callback', receivedAt: Date.now(), position: browserPosition });
    let position;
    try { position = normalizePosition(browserPosition); }
    catch (error) { onDiagnostic({ stage: 'provider', outcome: 'rejected', reason: 'invalid-coordinates' }); onError(error); return Promise.resolve(null); }
    if (stopped || expectedGeneration !== generation || stateMode() !== expectedMode) {
      onDiagnostic({ stage: 'provider', outcome: 'rejected', reason: 'inactive-watch-or-mission' });
      return Promise.resolve(null);
    }
    if (position.observedAt <= lastObservedAt) {
      onDiagnostic({ stage: 'provider', outcome: 'rejected', reason: 'stale-or-equal-timestamp' });
      return Promise.resolve(null);
    }
    lastObservedAt = position.observedAt;
    onDiagnostic({ stage: 'provider', outcome: 'position-accepted', position });
    if (expectedMode === 'tracking') onPosition(position);
    const elapsed = position.observedAt - lastPublishedAt;
    const moved = distanceMeters(lastPublishedPosition, position);
    if (lastPublishedPosition && elapsed < minPublishIntervalMs
        && (elapsed < minAbsolutePublishIntervalMs || moved < minPublishDistanceMeters)) {
      onDiagnostic({ stage: 'backend', outcome: 'send-skipped', reason: 'throttled', elapsed, moved });
      return Promise.resolve(null);
    }
    lastPublishedPosition = position;
    lastPublishedAt = position.observedAt;
    writeQueue = writeQueue.then(async () => {
      if (stopped || expectedGeneration !== generation || stateMode() !== expectedMode) {
        onDiagnostic({ stage: 'backend', outcome: 'send-skipped', reason: 'inactive-watch-or-mission' });
        return null;
      }
      onDiagnostic({ stage: 'backend', outcome: 'sending', position });
      const next = await repository.updateLocation({ latitude: position.latitude, longitude: position.longitude });
      onDiagnostic({ stage: 'backend', outcome: 'accepted', position, sentAt: Date.now() });
      await onState(next);
      return next;
    }).catch((error) => { onDiagnostic({ stage: 'backend', outcome: 'send-error', reason: error?.code ?? 'location-send-failed' }); onError(error); return null; });
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
      error => { onDiagnostic({ stage: 'provider', outcome: 'watch-error', reason: `geolocation-${error?.code ?? 'unknown'}` }); onError(error); },
      liveOptions,
    );
    onDiagnostic({ stage: 'provider', outcome: 'watch-started', watchId, options: liveOptions });
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
