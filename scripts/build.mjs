import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

await rm('dist', { force: true, recursive: true });
await mkdir('dist/src', { recursive: true });
await cp('index.html', 'dist/index.html');
await cp('src', 'dist/src', { recursive: true });
// Google Maps browser keys are public identifiers: restrict this key in Google
// Cloud by HTTP referrer and allow only Maps JavaScript API. Never inject a
// server secret (OPENAI_API_KEY, Routes service credentials, etc.) here.
const mapsKey = process.env.VITE_GOOGLE_MAPS_API_KEY ?? '';
await writeFile('dist/src/runtime-config.js', `globalThis.__HOME_AI_CONFIG__ = Object.freeze({ VITE_GOOGLE_MAPS_API_KEY: ${JSON.stringify(mapsKey)} });\n`);

console.log('Build terminé dans dist/.');
