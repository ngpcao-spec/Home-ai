const loads = new WeakMap();

// Official audio Call API SDK. Loaded once per application, never per screen.
export function loadStringeeSdk(documentRef = globalThis.document) {
  const environment = documentRef?.defaultView ?? globalThis;
  if (environment.StringeeClient && environment.StringeeCall) return Promise.resolve(environment);
  if (!documentRef?.head) return Promise.reject(new Error('Stringee SDK unavailable'));
  if (loads.has(documentRef)) return loads.get(documentRef);
  const pending = new Promise((resolve, reject) => {
    const script = documentRef.createElement('script');
    script.src = 'https://cdn.stringee.com/sdk/web/latest/stringee-web-sdk.min.js';
    script.async = true;
    const timeout = environment.setTimeout(() => fail(), 15000);
    const fail = () => {
      environment.clearTimeout(timeout);
      script.remove(); loads.delete(documentRef);
      reject(new Error('Stringee SDK unavailable'));
    };
    script.onerror = fail;
    script.onload = () => {
      environment.clearTimeout(timeout);
      if (!environment.StringeeClient || !environment.StringeeCall) return fail();
      resolve(environment);
    };
    documentRef.head.append(script);
  });
  loads.set(documentRef, pending);
  return pending;
}
