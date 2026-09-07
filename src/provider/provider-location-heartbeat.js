function readPosition(geolocation) {
  if (!geolocation?.getCurrentPosition) return Promise.reject(new Error('Geolocation unavailable'));
  return new Promise((resolve, reject) => geolocation.getCurrentPosition(
    ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
    reject,
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  ));
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
}) {
  let timer;
  let stopped = false;
  const eligible = () => repository.source === 'supabase'
    && getState()?.status?.online
    && (getState()?.status?.available || Boolean(getState()?.assignment))
    && isPageActive();

  const clear = () => {
    if (timer !== undefined) clearTask(timer);
    timer = undefined;
  };
  const schedule = () => {
    clear();
    if (!stopped && eligible()) {
      timer = scheduleTask(refresh, intervalMs);
    }
  };
  const refresh = async () => {
    if (stopped || !eligible()) return null;
    try {
      const position = await readPosition(geolocation);
      if (stopped || !eligible()) return null;
      const next = await repository.updateLocation(position);
      onState(next);
      return next;
    } catch (error) {
      onError(error);
      return null;
    } finally {
      schedule();
    }
  };
  const sync = () => {
    clear();
    if (!stopped && eligible()) void refresh();
  };
  const stop = () => { stopped = true; clear(); };

  return Object.freeze({ refresh, sync, stop });
}
