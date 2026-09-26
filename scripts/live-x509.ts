import 'dotenv/config';
import assert from 'node:assert/strict';
import { IrisClient } from '../server/upstream';
const {
  IRIS_TEST_USER: user,
  IRIS_TEST_PASSWORD: password,
  IRIS_TEST_CERT: certificate,
} = process.env;
if (!user || !password || !certificate)
  throw new Error(
    'Set IRIS_TEST_USER, IRIS_TEST_PASSWORD and IRIS_TEST_CERT (certificate path inside IRIS).',
  );
const client = new IrisClient(process.env.IRIS_URL ?? 'http://127.0.0.1:52773'),
  auth = 'Basic ' + Buffer.from(user + ':' + password).toString('base64'),
  alias = 'HarborCertTest' + Date.now();
let created = false;
try {
  await client.request(auth, {
    path: '/v2/security/x509-credential',
    method: 'POST',
    query: { alias },
    body: {
      Alias: alias,
      CertificateFile: certificate,
      OwnerList: [user],
      PeerNames: ['harbor.test'],
    },
  });
  created = true;
  const read = await client.request(auth, {
    path: '/v2/security/x509-credential',
    method: 'GET',
    query: { alias },
  });
  assert.deepEqual(read.data.OwnerList, [user]);
  await client.request(auth, {
    path: '/v2/security/x509-credential',
    method: 'PUT',
    query: { alias },
    body: { PeerNames: ['updated.harbor.test'] },
  });
  assert.deepEqual(
    (
      await client.request(auth, {
        path: '/v2/security/x509-credential',
        method: 'GET',
        query: { alias },
      })
    ).data.PeerNames,
    ['updated.harbor.test'],
  );
  console.log('PASS X.509 certificate import, owner restriction, update and read');
} finally {
  if (created)
    await client.request(auth, {
      path: '/v2/security/x509-credential',
      method: 'DELETE',
      query: { alias },
    });
}
