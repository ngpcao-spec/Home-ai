const liveOptions = Object.freeze({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
const idleOptions = Object.freeze({ enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });

// Temporary foreground diagnostics; records contain no GPS coordinates or IDs.
const consoleGpsTrace = record => {
  if (typeof globalThis.window !== 'undefined') globalThis.console?.info?.('[HOME AI GPS]', record);
};

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
  onTrace = consoleGpsTrace,
}) {
  let timer;
  let watchId;
  let stopped = false;
  let generation = 0;
  let lastObservedAt = -Infinity;
  let writeQueue = Promise.resolve();
  let lastPublishedPosition = null;
  let lastPublishedAt = -Infinity;
  let lastQueuedPosition = null;
  const trace = (event, details = {}) => {
    try { onTrace({ event, at: new Date().toISOString(), ...details }); } catch { /* Diagnostics cannot interrupt GPS. */ }
  };

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
  const traceStateMode = mode => {
    const state = getState();
    trace('GPS_STATE_MODE', {
      mode, stopped, repositorySource: repository.source,
      online: Boolean(state?.status?.online), assignmentStatus: state?.assignment?.status ?? null,
      documentHidden: Boolean(globalThis.document?.hidden), pageActive: Boolean(isPageActive()),
    });
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
    trace('GPS_CALLBACK');
    traceStateMode(stateMode());
    onDiagnostic({ stage: 'provider', outcome: 'callback', receivedAt: Date.now(), position: browserPosition });
    let position;
    try { position = normalizePosition(browserPosition); }
    catch (error) { traceStateMode(stateMode()); onDiagnostic({ stage: 'provider', outcome: 'rejected', reason: 'invalid-coordinates' }); onError(error); return Promise.resolve(null); }
    if (stopped || expectedGeneration !== generation || stateMode() !== expectedMode) {
      traceStateMode(stateMode());
      onDiagnostic({ stage: 'provider', outcome: 'rejected', reason: 'inactive-watch-or-mission' });
      return Promise.resolve(null);
    }
    if (position.observedAt <= lastObservedAt) {
      traceStateMode(stateMode());
      onDiagnostic({ stage: 'provider', outcome: 'rejected', reason: 'stale-or-equal-timestamp' });
      return Promise.resolve(null);
    }
    lastObservedAt = position.observedAt;
    trace('GPS_ACCEPTED');
    onDiagnostic({ stage: 'provider', outcome: 'position-accepted', position });
    if (expectedMode === 'tracking') onPosition(position);
    const referencePosition = lastQueuedPosition ?? lastPublishedPosition;
    const referenceAt = lastQueuedPosition ? lastQueuedPosition.observedAt : lastPublishedAt;
    const elapsed = position.observedAt - referenceAt;
    const moved = distanceMeters(referencePosition, position);
    if (referencePosition && elapsed < minPublishIntervalMs
        && (elapsed < minAbsolutePublishIntervalMs || moved < minPublishDistanceMeters)) {
      trace('GPS_THROTTLED', { elapsedMs: elapsed, movementThresholdReached: moved >= minPublishDistanceMeters });
      onDiagnostic({ stage: 'backend', outcome: 'send-skipped', reason: 'throttled', elapsed, moved });
      return Promise.resolve(null);
    }
    lastQueuedPosition = position;
    trace('GPS_QUEUE', { outcome: 'enqueued' });
    writeQueue = writeQueue.then(async () => {
      if (stopped || expectedGeneration !== generation || stateMode() !== expectedMode) {
        trace('GPS_QUEUE', { outcome: 'skipped', reason: 'inactive-watch-or-mission' });
        traceStateMode(stateMode());
        onDiagnostic({ stage: 'backend', outcome: 'send-skipped', reason: 'inactive-watch-or-mission' });
        return null;
      }
      trace('GPS_QUEUE', { outcome: 'dequeued' });
      onDiagnostic({ stage: 'backend', outcome: 'sending', position });
      trace('GPS_UPDATELOCATION_CALL');
      let next;
      try {
        next = await repository.updateLocation({ latitude: position.latitude, longitude: position.longitude });
        trace('GPS_UPDATELOCATION_SUCCESS');
      } catch (error) {
        trace('GPS_UPDATELOCATION_ERROR', {
          code: typeof error?.code === 'string' && /^[A-Z0-9_]{1,16}$/.test(error.code) ? error.code : null,
          status: Number.isInteger(error?.status) ? error.status : null,
        });
        throw error;
      }
      lastPublishedPosition = position;
      lastPublishedAt = position.observedAt;
      onDiagnostic({ stage: 'backend', outcome: 'accepted', position, sentAt: Date.now() });
      await onState(next);
      return next;
    }).catch((error) => { onDiagnostic({ stage: 'backend', outcome: 'send-error', reason: error?.code ?? 'location-send-failed' }); onError(error); return null; })
      .finally(() => { if (lastQueuedPosition === position) lastQueuedPosition = null; });
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
      traceStateMode(stateMode());
      onError(new Error('Continuous geolocation unavailable'));
      return;
    }
    const expectedGeneration = generation;
    watchId = geolocation.watchPosition(
      position => publish(position, expectedGeneration, 'tracking'),
      error => { traceStateMode(stateMode()); onDiagnostic({ stage: 'provider', outcome: 'watch-error', reason: `geolocation-${error?.code ?? 'unknown'}` }); onError(error); },
      liveOptions,
    );
    trace('GPS_WATCH_STARTED');
    onDiagnostic({ stage: 'provider', outcome: 'watch-started', watchId, options: liveOptions });
  };
  const sync = () => {
    clearTimer();
    const mode = stateMode();
    traceStateMode(mode);
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
