import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const port = 3430;
const origin = `http://127.0.0.1:${port}`;
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../tests/browser/profile-access.jsx', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'esm',
  loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"development"' },
});
const html =
  '<!doctype html><meta charset="utf-8"><title>Harbor saved profile access regression</title><h1>Harbor saved profile access regression</h1><p>Actual component; synthetic captures; no IRIS connection.</p><div id="probe"></div><pre id="result">Running…</pre><script type="module" src="/probe.js"></script>';
const server = http.createServer(async (request, response) => {
  if (
    request.headers.host !== `127.0.0.1:${port}` ||
    (request.headers.origin && request.headers.origin !== origin)
  ) {
    response.writeHead(403).end();
    return;
  }
  if (request.method === 'GET' && ['/', '/probe.js'].includes(request.url)) {
    response.writeHead(200, {
      'Content-Type': request.url === '/' ? 'text/html; charset=utf-8' : 'text/javascript',
      'Cache-Control': 'no-store',
    });
    response.end(request.url === '/' ? html : bundle.outputFiles[0].text);
    return;
  }
  if (request.method !== 'POST' || request.url !== '/_test/result') {
    response.writeHead(404).end();
    return;
  }
  try {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (Buffer.byteLength(body) > 65536) throw new Error('Result exceeds 64 KiB.');
    }
    const report = JSON.parse(body);
    const passed =
      !report.error &&
      report.results?.length === 23 &&
      report.results.every((result) => result.pass === true) &&
      report.nativeCalls === 0 &&
      report.appliedWrites === 0;
    console.log(JSON.stringify(report, null, 2));
    console.log(
      passed ? 'PASS: 23/23 saved profile access checks.' : 'FAIL: saved profile access checks.',
    );
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ passed }));
    process.exitCode = passed ? 0 : 1;
    clearTimeout(deadline);
    server.close();
  } catch (error) {
    response.writeHead(400).end(error.message);
  }
});
const deadline = setTimeout(() => {
  console.error('FAIL: browser did not complete within 10 minutes.');
  process.exitCode = 1;
  server.closeAllConnections();
  server.close();
}, 600000);
server.on('error', (error) => {
  console.error(error);
  clearTimeout(deadline);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () =>
  console.log(`Open ${origin}/ for 23 actual-component checks.`),
);
