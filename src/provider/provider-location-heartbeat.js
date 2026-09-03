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
  onState = () => {},
  onError = () => {},
}) {
  let timer;
  let stopped = false;

  const clear = () => {
    if (timer !== undefined) clearTask(timer);
    timer = undefined;
  };
  const schedule = () => {
    clear();
    if (!stopped && repository.source === 'supabase' && getState()?.status?.online) {
      timer = scheduleTask(refresh, intervalMs);
    }
  };
  const refresh = async () => {
    if (stopped || repository.source !== 'supabase' || !getState()?.status?.online) return null;
    try {
      const position = await readPosition(geolocation);
      const current = getState();
      const next = await repository.setAvailability({
        online: true,
        available: Boolean(current.status.available),
        ...position,
      });
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
    if (!stopped && repository.source === 'supabase' && getState()?.status?.online) void refresh();
  };
  const stop = () => { stopped = true; clear(); };

  return Object.freeze({ refresh, sync, stop });
}
