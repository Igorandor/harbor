import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const port = 3436;
const origin = `http://127.0.0.1:${port}`;
const expected = 12;
const label = 'investigation creation fields';
const bundle = await build({
  entryPoints: [
    fileURLToPath(new URL('../tests/browser/investigation-creation.jsx', import.meta.url)),
  ],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'esm',
  outfile: 'probe.js',
  loader: { '.woff2': 'dataurl', '.woff': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"development"' },
});
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/probe.css"><title>Harbor ${label} regression</title><h1>Harbor ${label} regression</h1><p>Actual component; synthetic responses; no IRIS connection.</p><div id="probe"></div><pre id="result">Running…</pre><script type="module" src="/probe.js"></script>`;
const server = http.createServer(async (request, response) => {
  if (
    request.headers.host !== `127.0.0.1:${port}` ||
    (request.headers.origin && request.headers.origin !== origin)
  ) {
    response.writeHead(403).end();
    return;
  }
  if (
    request.method === 'GET' &&
    [
      '/',
      '/?manual',
      '/?manual&profile',
      '/mobile-profile.html',
      '/mobile.html',
      '/probe.js',
      '/probe.css',
    ].includes(request.url)
  ) {
    response.writeHead(200, {
      'Content-Type':
        request.url === '/probe.js'
          ? 'text/javascript'
          : request.url === '/probe.css'
            ? 'text/css'
            : 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(
      request.url === '/probe.js'
        ? bundle.outputFiles.find((f) => f.path.endsWith('.js')).text
        : request.url === '/probe.css'
          ? bundle.outputFiles.find((f) => f.path.endsWith('.css')).text
          : ['/mobile.html', '/mobile-profile.html'].includes(request.url)
            ? '<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><iframe title="Phone preview" src="/?manual' +
              (request.url === '/mobile-profile.html' ? '&profile' : '') +
              '" style="width:390px;height:844px;border:0"></iframe>'
            : html,
    );
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
      report.results?.length === expected &&
      report.results.every((result) => result.pass === true) &&
      report.nativeCalls === 0 &&
      report.appliedWrites === 0;
    console.log(JSON.stringify(report, null, 2));
    console.log(
      passed ? `PASS: ${expected}/${expected} ${label} checks.` : `FAIL: ${label} checks.`,
    );
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ passed }));
    process.exitCode = passed ? 0 : 1;
    clearTimeout(deadline);
    if (!process.argv.includes('--manual')) server.close();
  } catch (error) {
    response.writeHead(400).end(error.message);
  }
});
const deadline = setTimeout(
  () => {
    console.error('FAIL: browser did not complete within 10 minutes.');
    process.exitCode = 1;
    server.closeAllConnections();
    server.close();
  },
  process.argv.includes('--manual') ? 3600000 : 600000,
);
server.on('error', (error) => {
  console.error(error);
  clearTimeout(deadline);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () =>
  console.log(`Open ${origin}/ for ${expected} actual-component checks.`),
);
