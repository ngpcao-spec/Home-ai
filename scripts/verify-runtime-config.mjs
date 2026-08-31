import { readFile } from 'node:fs/promises';

const runtimeConfigPath = 'dist/src/runtime-config.js';

let source;
try {
  source = await readFile(runtimeConfigPath, 'utf8');
} catch {
  throw new Error('Production runtime configuration file is missing');
}

const assignment = source.match(/AMAZON_LOCATION_API_KEY\s*:\s*("(?:\\.|[^"\\])*")/);
let runtimeKey = '';
try {
  runtimeKey = assignment ? JSON.parse(assignment[1]).trim() : '';
} catch {
  throw new Error('Production runtime configuration is invalid');
}

const expectedKey = process.env.AMAZON_LOCATION_API_KEY?.trim() ?? '';
if (!expectedKey) throw new Error('AMAZON_LOCATION_API_KEY is not configured');
if (!runtimeKey) throw new Error('Production runtime configuration is empty');
if (runtimeKey !== expectedKey) throw new Error('Production runtime configuration does not match the build environment');

console.log('Amazon Location runtime configuration verified (value redacted).');
