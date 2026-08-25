import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { force: true, recursive: true });
await mkdir('dist/src', { recursive: true });
await cp('index.html', 'dist/index.html');
await cp('src', 'dist/src', { recursive: true });

console.log('Build terminé dans dist/.');
