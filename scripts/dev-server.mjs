import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 5173);
const root = process.cwd();

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
]);

function resolveRequestPath(url) {
  const pathname = new URL(url, `http://${host}:${port}`).pathname;
  const safePath = normalize(decodeURIComponent(pathname)).replace(/^\.\.(?:[/\\]|$)/, '');
  const filePath = join(root, safePath === '/' ? 'index.html' : safePath);

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    return filePath;
  }

  return join(root, 'index.html');
}

createServer((request, response) => {
  const filePath = resolveRequestPath(request.url ?? '/');
  const contentType = contentTypes.get(extname(filePath)) ?? 'application/octet-stream';

  response.writeHead(200, { 'Content-Type': contentType });
  createReadStream(filePath).pipe(response);
}).listen(port, host, () => {
  console.log(`Home-ai est disponible sur http://localhost:${port}`);
});
