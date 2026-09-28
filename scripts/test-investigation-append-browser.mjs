import http from 'node:http';
import { build } from 'esbuild';
import { InvestigationService } from '../server/investigation-service.ts';
import { summarizeCase, validStoredCase } from '../shared/investigation.ts';
import { ApiError } from '../server/upstream.ts';
const actor = { owner: 'Synthetic operator', instance: 'synthetic-only', auth: 'synthetic-auth' };
let stored,
  mode,
  writes,
  requests,
  diagnosticReads,
  queue = Promise.resolve();
function reset(value) {
  mode = value;
  writes = diagnosticReads = 0;
  requests = [];
  stored = {
    id: '88888888-8888-4888-8888-888888888888',
    revision: 1,
    version: 1,
    owner: actor.owner,
    instance: actor.instance,
    title: 'Synthetic investigation',
    description: 'Isolated append recovery audit',
    severity: 'minor',
    status: 'open',
    tags: [],
    createdAt: '2026-09-28T12:00:00.000Z',
    updatedAt: '2026-09-28T12:00:00.000Z',
    notes: [],
    captures: [],
    linkedChanges: [],
  };
  if (!validStoredCase(stored)) throw Error('Invalid synthetic investigation');
}
reset('committed503');
const store = {
  read: async () => structuredClone(stored),
  exclusive: (_actor, _kind, _id, fn) => {
    const job = queue.then(fn);
    queue = job.catch(() => {});
    return job;
  },
  write: async (record, _kind, revision) => {
    if (stored.revision !== revision) throw new ApiError(409, 'Synthetic store revision conflict');
    if (!validStoredCase(record)) throw Error('Invalid stored result');
    stored = structuredClone(record);
    writes++;
    return structuredClone(stored);
  },
};
const client = {
  request: async (_auth, input) => {
    if (input.method !== 'GET') throw Error('No native mutation in audit');
    diagnosticReads++;
    return { status: 200, data: { synthetic: true, path: input.path }, console: [] };
  },
};
const service = new InvestigationService(store, client);
const bundle = await build({
  entryPoints: ['tests/browser/investigation-append.jsx'],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"development"' },
});
const server = http
  .createServer(async (req, res) => {
    if (
      req.headers.host !== '127.0.0.1:3432' ||
      (req.headers.origin && req.headers.origin !== 'http://127.0.0.1:3432')
    ) {
      res.writeHead(403).end();
      return;
    }
    const json = (body, status = 200) =>
      res
        .writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(JSON.stringify(body));
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 65536) throw Error('Oversized test body');
      }
      if (req.url === '/_test/result' && req.method === 'POST') {
        const report = JSON.parse(body);
        const passed =
          !report.error &&
          report.results?.length === 28 &&
          report.results.every((item) => item.pass) &&
          report.nativeCalls === 0 &&
          report.durableWrites === 0;
        console.log(JSON.stringify(report, null, 2));
        console.log(passed ? 'PASS28/28' : 'FAIL');
        json({ passed });
        process.exitCode = passed ? 0 : 1;
        server.close();
        clearTimeout(deadline);
        return;
      }
      if (req.url === '/_test/reset' && req.method === 'POST') {
        reset(JSON.parse(body).mode);
        json({ ok: true });
        return;
      }
      if (req.url === '/_test/state') {
        json({
          revision: stored.revision,
          writes,
          noteCount: stored.notes.length,
          captureCount: stored.captures.length,
          diagnosticReads,
          requests,
        });
        return;
      }
      if (req.url.startsWith('/api/'))
        requests.push({
          method: req.method,
          url: req.url,
          ...(body ? { body: JSON.parse(body) } : {}),
        });
      if (req.url === '/api/investigations' && req.method === 'GET') {
        json(
          mode === 'known-save-list503' && writes
            ? { error: 'Synthetic list temporarily unavailable' }
            : { records: [summarizeCase(stored)], unreadable: [], total: 1 },
          mode === 'known-save-list503' && writes ? 503 : 200,
        );
        return;
      }
      if (req.url === '/api/investigations/' + stored.id && req.method === 'GET') {
        json(await service.get(actor, stored.id));
        return;
      }
      if (req.method === 'POST' && req.url.startsWith('/api/investigations/' + stored.id + '/')) {
        const input = JSON.parse(body),
          action = req.url.split('/').at(-1);
        const result =
          action === 'notes'
            ? await service.note(actor, stored.id, input.revision, input.text)
            : action === 'captures'
              ? await service.capture(actor, stored.id, input.revision, input.sources, input.title)
              : undefined;
        if (!result) throw Error('Unexpected action');
        if (mode === 'unreadable200') {
          res.writeHead(200, { 'Content-Type': 'application/json' }).end('unreadable');
          return;
        }
        if (mode === 'committed503') {
          json({ error: 'Synthetic response unavailable after persistence' }, 503);
          return;
        }
        json(result);
        return;
      }
      if (req.method === 'GET' && req.url === '/probe.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(bundle.outputFiles[0].text);
        return;
      }
      if (req.method === 'GET' && req.url === '/') {
        res
          .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          .end(
            '<!doctype html><meta charset="utf-8"><title>Investigation append recovery audit</title><div id="probe"></div><pre id="result">Running…</pre><script src="/probe.js"></script>',
          );
        return;
      }
      res.writeHead(404).end();
    } catch (error) {
      json({ error: error.message }, error.status ?? 500);
    }
  })
  .listen(3432, '127.0.0.1', () =>
    console.log(
      'Actual Investigations + InvestigationService, memory-only store and synthetic diagnostics http://127.0.0.1:3432/',
    ),
  );

const deadline = setTimeout(() => {
  console.error('Browser test deadline elapsed');
  server.close();
  process.exitCode = 1;
}, 600000);
