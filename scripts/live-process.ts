import 'dotenv/config';
import assert from 'node:assert/strict';
import { IrisClient, type Operation } from '../server/upstream';
const { IRIS_TEST_USER: user, IRIS_TEST_PASSWORD: password, IRIS_TEST_PID: id } = process.env;
if (!user || !password || !id)
  throw new Error('Set test credentials and IRIS_TEST_PID from iris/start-test-worker.script.');
const client = new IrisClient(process.env.IRIS_URL ?? 'http://127.0.0.1:52773'),
  auth = 'Basic ' + Buffer.from(user + ':' + password).toString('base64');
const call = (path: string, method: Operation['method'] = 'GET') =>
  client.request(auth, { path, method, query: path === '/v2/processes' ? {} : { id } });
const worker = (await call('/v2/processes')).data.find((p: any) => String(p.Pid) === id);
assert.ok(
  worker && String(worker.Routine).includes('Harbor.DemoTask'),
  'Refusing to control anything except the explicitly started Harbor test worker.',
);
try {
  assert.ok(worker.CanBeSuspended && worker.CanBeTerminated);
  await call('/v2/process/suspend', 'POST');
  await call('/v2/process', 'GET');
  await call('/v2/process/resume', 'POST');
  console.log('PASS suspend/resume of disposable worker');
} finally {
  await call('/v2/process/terminate', 'POST');
}
for (let i = 0; i < 10; i++) {
  await new Promise((r) => setTimeout(r, 300));
  const rows = (await call('/v2/processes')).data;
  if (!rows.some((p: any) => String(p.Pid) === id)) {
    console.log('PASS worker termination verified by process list');
    process.exit(0);
  }
}
throw new Error('The worker was still listed after termination.');
