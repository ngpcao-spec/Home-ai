// TEMPORARY TEST ONLY: local, in-memory GPS inspection. Never log or persist it.
export function createProviderGpsDiagnostics(documentRef, { enabled, isTravelling, getMapPosition, getMarkerState = () => null }) {
  if (!enabled || !documentRef?.body) return { sync() {}, record() {}, stop() {} };
  const host = documentRef.createElement('aside');
  host.dataset.providerGpsDiagnostics = '';
  host.style.cssText = 'position:fixed;z-index:900;right:8px;left:8px;bottom:90px;max-height:45vh;overflow:auto;background:#fff;color:#143f36;border:2px solid #087b61;border-radius:12px;padding:10px;font:12px/1.5 monospace;box-shadow:0 4px 20px #0003';
  const button = documentRef.createElement('button');
  button.type = 'button'; button.textContent = 'TEST — GPS diagnostic';
  const content = documentRef.createElement('pre');
  content.style.cssText = 'white-space:pre-wrap;margin:8px 0 0'; content.hidden = true;
  host.append(button, content); documentRef.body.append(host);
  const data = { watch: false, callbacks: 0, accepted: 0, rejected: 0, reason: '—', permission: 'unknown' };
  const coordinates = p => p ? `${p.latitude ?? '—'} / ${p.longitude ?? '—'}` : '—';
  const time = value => Number.isFinite(value) ? new Date(value).toLocaleTimeString() : '—';
  const sync = () => {
    host.hidden = !isTravelling();
    const position = data.position;
    const marker = getMarkerState();
    content.textContent = [
      `GPS watch: ${data.watch ? 'ACTIF' : 'INACTIF'} (id: ${data.watchId ?? '—'})`,
      `Permission: ${data.permission}`,
      `Foreground: ${!documentRef.hidden}`,
      'Options: highAccuracy=true; maximumAge=0; timeout=15000',
      `Latitude / Longitude: ${coordinates(position)}`,
      `Accuracy: ${position?.accuracy ?? '—'} m`,
      `Timestamp GPS: ${time(position?.observedAt)}`,
      `Dernière réception GPS: ${data.receivedAt ? Math.max(0, Math.floor((Date.now()-data.receivedAt)/1000)) : '—'} s`,
      `Callbacks: ${data.callbacks} | Accepted: ${data.accepted} | Rejected: ${data.rejected}`,
      `Dernier rejet/erreur: ${data.reason}`,
      `Dernière position envoyée: ${coordinates(data.sentPosition)}`,
      `Heure dernier envoi réussi: ${time(data.sentAt)}`,
      `Publication: ${data.sendStatus ?? '—'}`,
      `Position carte: ${coordinates(getMapPosition())}`,
      `Position marker: ${coordinates(marker?.position)}`,
      `Dernière mise à jour marker: ${time(marker?.updatedAt)}`,
      `Déplacements marker: ${marker?.moves ?? 0}`,
      `Markers Provider présents: ${marker?.markerCount ?? 0}`,
      `Objet marker/carte: ${marker ? `#${marker.instanceId} / #${marker.mapInstanceId} · ${marker.attached ? 'attaché' : 'détaché'}` : '—'}`,
    ].join('\n');
  };
  const record = event => {
    if (event.outcome === 'watch-started') { data.watch = true; data.watchId = event.watchId; }
    if (event.outcome === 'watch-stopped') data.watch = false;
    if (isTravelling()) {
      if (event.outcome === 'callback') {
        data.callbacks++; data.receivedAt = event.receivedAt;
        const p = event.position;
        data.position = { latitude:p?.coords?.latitude,longitude:p?.coords?.longitude,accuracy:p?.coords?.accuracy,observedAt:p?.timestamp };
      }
      if (event.outcome === 'position-accepted') data.accepted++;
      if (event.outcome === 'rejected') { data.rejected++; data.reason = event.reason; }
      if (event.outcome === 'watch-error') data.reason = event.reason;
      if (event.stage === 'backend') {
        data.sendStatus = event.outcome;
        if (event.outcome === 'accepted') { data.sentPosition = event.position; data.sentAt = event.sentAt; }
        if (event.reason) data.reason = event.reason;
      }
    }
    sync();
  };
  button.addEventListener('click', () => { content.hidden = !content.hidden; sync(); });
  const timer = globalThis.setInterval(sync, 1000);
  globalThis.navigator?.permissions?.query({name:'geolocation'}).then(status => {
    data.permission = status.state; sync();
  }).catch(() => {});
  sync();
  return { sync, record, stop() { clearInterval(timer); host.remove(); } };
}
