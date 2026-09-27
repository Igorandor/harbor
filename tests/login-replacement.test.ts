import { test } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createApp } from '../server/app';
import { ApiError, type IrisClient } from '../server/upstream';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'harbor-login-boundary-'));
  t.after(async () => {
    const target = resolve(root);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith('harbor-login-boundary-'));
    await rm(target, { recursive: true, force: true });
  });
  let time = 0;
  let entered!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>((done) => {
    entered = done;
  });
  const gate = new Promise<void>((done) => {
    release = done;
  });
  t.after(async () => {
    release();
  });
  const client = {
    async request(auth: string, op: { path: string; method: string }) {
      assert.equal(op.path, '/info');
      assert.equal(op.method, 'GET');
      const [username, password] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
      if (username === 'Held') {
        entered();
        await gate;
      }
      if (password === 'wrong') throw new ApiError(401, 'Invalid credentials.');
      return { data: { apiVersion: 2, username }, status: 200, console: [] };
    },
  } as unknown as IrisClient;
  const app = createApp({
    irisUrl: 'http://synthetic.invalid',
    origin: 'http://portal.test',
    client,
    dataDirectory: root,
    instanceId: 'synthetic-login',
    now: () => time,
  });
  const login = (username: string, cookie?: string, password = 'fixture') => {
    const call = supertest(app).post('/api/login').send({ username, password });
    return cookie ? call.set('Cookie', cookie) : call;
  };
  const session = (cookie: string) => supertest(app).get('/api/session').set('Cookie', cookie);
  const first = await login('Alice').expect(200);
  return {
    app,
    login,
    session,
    first,
    waiting,
    release,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
const cookieOf = (response: { headers: Record<string, any> }) =>
  response.headers['set-cookie'][0].split(';')[0];

test('a held replacement login cannot create a session after acknowledged logout', async (t) => {
  const f = await fixture(t),
    cookie = cookieOf(f.first);
  const pending = f.login('Held', cookie).then((response) => response);
  await f.waiting;
  await supertest(f.app)
    .post('/api/logout')
    .set('Cookie', cookie)
    .set('X-CSRF-Token', f.first.body.csrf)
    .send({})
    .expect(200);
  f.release();
  const late = await pending;
  assert.equal(late.status, 409);
  assert.equal(late.headers['set-cookie'], undefined);
  await f.session(cookie).expect(401);
  await supertest(f.app).get('/api/session').expect(401);
});

test('a held replacement login cannot override a newer successful account switch', async (t) => {
  const f = await fixture(t),
    cookie = cookieOf(f.first);
  const pending = f.login('Held', cookie).then((response) => response);
  await f.waiting;
  const newer = await f.login('Bob', cookie).expect(200);
  f.release();
  const late = await pending;
  assert.equal(late.status, 409);
  assert.equal(late.headers['set-cookie'], undefined);
  await f.session(cookie).expect(401);
  const current = await f.session(cookieOf(newer)).expect(200);
  assert.equal(current.body.info.username, 'Bob');
  assert.equal(current.body.csrf, newer.body.csrf);
});

test('a rejected replacement login preserves the original session and CSRF', async (t) => {
  const f = await fixture(t),
    cookie = cookieOf(f.first);
  const rejected = await f.login('Bob', cookie, 'wrong').expect(401);
  assert.equal(rejected.headers['set-cookie'], undefined);
  const current = await f.session(cookie).expect(200);
  assert.equal(current.body.info.username, 'Alice');
  assert.equal(current.body.csrf, f.first.body.csrf);
});

for (const stale of ['logged out', 'already expired'] as const)
  test('an initially ' + stale + ' cookie still permits an explicit fresh login', async (t) => {
    const f = await fixture(t),
      cookie = cookieOf(f.first);
    if (stale === 'logged out')
      await supertest(f.app)
        .post('/api/logout')
        .set('Cookie', cookie)
        .set('X-CSRF-Token', f.first.body.csrf)
        .send({})
        .expect(200);
    else f.advance(30 * 60000 + 1);
    const fresh = await f.login('Bob', cookie).expect(200);
    const current = await f.session(cookieOf(fresh)).expect(200);
    assert.equal(current.body.info.username, 'Bob');
  });

for (const expiry of ['idle', 'absolute'] as const)
  test(
    'a replacement login whose original session expires while waiting is rejected (' + expiry + ')',
    async (t) => {
      const f = await fixture(t),
        cookie = cookieOf(f.first);
      if (expiry === 'absolute') {
        for (let i = 0; i < 16; i++) {
          f.advance(29 * 60000);
          await f.session(cookie).expect(200);
        }
      }
      const pending = f.login('Held', cookie).then((response) => response);
      await f.waiting;
      f.advance(expiry === 'idle' ? 30 * 60000 + 1 : 17 * 60000);
      f.release();
      const late = await pending;
      assert.equal(late.status, 409);
      assert.equal(late.headers['set-cookie'], undefined);
      await f.session(cookie).expect(401);
    },
  );
