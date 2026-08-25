import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ignoredDirectories = new Set(['.git', 'dist', 'node_modules']);
const checkedExtensions = new Set(['.js', '.mjs']);

async function collectJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) {
      files.push(...(await collectJavaScriptFiles(path)));
    }

    if (entry.isFile() && checkedExtensions.has(path.slice(path.lastIndexOf('.')))) {
      files.push(path);
    }
  }

  return files;
}

const files = await collectJavaScriptFiles(process.cwd());

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`${files.length} fichiers JavaScript vérifiés.`);
