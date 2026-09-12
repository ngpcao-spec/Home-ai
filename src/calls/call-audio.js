// Audio resources live outside screen rendering. Safari activation remains a
// genuine user gesture; storing a flag would not unlock a new AudioContext.
export function createCallAudio(documentRef, environment = documentRef.defaultView ?? globalThis) {
  const remote = documentRef.createElement('audio');
  remote.autoplay = true; remote.setAttribute('playsinline', '');
  remote.dataset.missionCallAudio = ''; documentRef.body.append(remote);
  let context; let timer; let permissionStream; let playBlocked = false; const oscillators = new Set();
  const stopRinging = () => {
    environment.clearInterval(timer); timer = undefined;
    for (const oscillator of oscillators) { try { oscillator.stop(); } catch { /* Already stopped. */ } }
    oscillators.clear(); environment.navigator?.vibrate?.(0);
  };
  const tone = () => {
    if (context?.state === 'running') {
      const oscillator = context.createOscillator(); const gain = context.createGain();
      oscillator.frequency.value = 880; gain.gain.value = 0.09;
      oscillator.connect(gain); gain.connect(context.destination);
      oscillators.add(oscillator); oscillator.onended = () => oscillators.delete(oscillator);
      oscillator.start(); oscillator.stop(context.currentTime + 0.35);
    }
    environment.navigator?.vibrate?.([200, 100, 200]);
  };
  const activate = async () => {
    const AudioContext = environment.AudioContext ?? environment.webkitAudioContext;
    context ??= AudioContext ? new AudioContext() : null;
    await context?.resume();
    if (context && context.state !== 'running') throw Object.assign(new Error('Audio unavailable'), { name: 'NotAllowedError' });
    if (remote.srcObject) await remote.play();
    playBlocked = false;
  };
  return {
    activate,
    // Invoke from the actual start/answer tap, before awaiting network work.
    async prepareMicrophone() {
      const activation = activate();
      if (!environment.navigator?.mediaDevices?.getUserMedia) throw new Error('Microphone unavailable');
      const permission = environment.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const results = await Promise.allSettled([activation, permission]);
      if (results[1].status === 'fulfilled') {
        permissionStream = results[1].value;
        // The SDK owns its microphone stream. This stream only obtains permission.
        permissionStream.getTracks().forEach(track => track.stop()); permissionStream = null;
      }
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
    },
    ring() { if (timer !== undefined) return; tone(); timer = environment.setInterval(tone, 1800); },
    stopRinging,
    needsActivation: () => !context || context.state !== 'running' || playBlocked,
    async attach(stream) {
      // Discard video tracks defensively: this integration is audio only.
      const tracks = stream?.getAudioTracks?.() ?? [];
      remote.srcObject = environment.MediaStream ? new environment.MediaStream(tracks) : stream;
      try { await remote.play(); playBlocked = false; }
      catch (error) { playBlocked = true; throw error; }
    },
    clear() { stopRinging(); remote.pause(); remote.srcObject = null; },
    dispose() {
      stopRinging(); permissionStream?.getTracks().forEach(track => track.stop());
      remote.pause(); remote.srcObject = null; remote.remove(); void context?.close?.();
    },
  };
}
