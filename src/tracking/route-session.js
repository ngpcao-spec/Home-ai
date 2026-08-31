const coordinateKey = (location) => `${location?.id ?? ''}:${location?.latitude}:${location?.longitude}`;

export function createTrackingRouteSession(routingProvider) {
  let key;
  let routePromise;
  return {
    get(origin, destination) {
      const nextKey = `${coordinateKey(origin)}>${coordinateKey(destination)}`;
      if (nextKey !== key || !routePromise) {
        key = nextKey;
        routePromise = Promise.resolve(routingProvider.route(origin, destination)).catch((error) => {
          routePromise = undefined;
          throw error;
        });
      }
      return routePromise;
    },
    reset() {
      key = undefined;
      routePromise = undefined;
    },
  };
}
