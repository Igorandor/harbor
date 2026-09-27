import { test } from 'node:test';
import assert from 'node:assert/strict';
import { credentialValues, redact } from '../shared/redaction.js';

const policyFields = ['ChangePassword', 'PasswordNeverExpires', 'HOTPKeyDisplay'];

test('the three exact boolean account policy fields remain readable through nested records', () => {
  for (const enabled of [true, false]) {
    const policy = Object.fromEntries(policyFields.map((key) => [key, enabled]));
    const input = { User: policy, rows: [{ ...policy }] };
    assert.deepEqual(redact(input), input);
  }
});

test('account policy field names with any nonboolean value remain masked', () => {
  for (const value of [
    'true',
    'false',
    'sensitive-value',
    null,
    undefined,
    0,
    1,
    {},
    [],
    { value: true },
  ]) {
    const input = Object.fromEntries(policyFields.map((key) => [key, value]));
    const result = redact(input);
    for (const key of policyFields) assert.equal(result[key], '[redacted]');
  }
  assert.deepEqual(credentialValues({ ChangePassword: 'sensitive-value' }), ['sensitive-value']);
});

test('spelling variations and actual credential fields do not receive the policy exception', () => {
  const names = [
    'changePassword',
    'PasswordNeverExpiresExtra',
    'HOTP_Key_Display',
    'changepassword',
    'Password',
    'HOTPKey',
    'PrivateKey',
    'AccessToken',
    'ClientSecret',
    'WalletSecretConfig',
  ];
  for (const enabled of [true, false]) {
    const result = redact(Object.fromEntries(names.map((key) => [key, enabled])));
    for (const key of names) assert.equal(result[key], '[redacted]');
  }
});

test('a secret-bearing ancestor stays fully masked even when it contains boolean policy fields', () => {
  const flags = { ChangePassword: true, PasswordNeverExpires: false, HOTPKeyDisplay: true };
  const input = {
    Secret: flags,
    Password: [flags],
    ordinary: { PrivateKey: flags },
    Description: 'diagnostic submitted-secret',
    ChangePassword: false,
  };
  assert.deepEqual(redact(input, ['submitted-secret']), {
    Secret: '[redacted]',
    Password: '[redacted]',
    ordinary: { PrivateKey: '[redacted]' },
    Description: 'diagnostic [redacted]',
    ChangePassword: false,
  });
  assert.equal(input.Secret, flags, 'Redaction must not mutate the source record');
});
