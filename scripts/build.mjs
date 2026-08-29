import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

await rm('dist', { force: true, recursive: true });
await mkdir('dist/src', { recursive: true });
await cp('index.html', 'dist/index.html');
await cp('src', 'dist/src', { recursive: true });
// Amazon Location browser API keys are public identifiers, but must be restricted
// by HTTP referrer and allowed actions. Never print the value or inject server secrets.
const mapsKey = process.env.AMAZON_LOCATION_API_KEY ?? '';
if (process.env.CI && !mapsKey.trim()) throw new Error('AMAZON_LOCATION_API_KEY is required for the production build');
await writeFile('dist/src/runtime-config.js', `globalThis.__HOME_AI_CONFIG__ = Object.freeze({ AMAZON_LOCATION_API_KEY: ${JSON.stringify(mapsKey)} });\n`);

console.log(`Build terminé dans dist/ (Amazon Location: ${mapsKey.trim() ? 'configured' : 'not configured'}).`);
