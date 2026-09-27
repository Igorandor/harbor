import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessChangeImpact } from '../server/change-impact.js';
import type { IrisClient, Operation } from '../server/upstream.js';

const client = {
  async request() {
    throw new Error('Policy impact must not request unrelated native data');
  },
} as unknown as IrisClient;
const edit = (body: Record<string, unknown>): Operation => ({
  path: '/v2/security/user',
  method: 'PUT',
  query: { name: 'PolicyUser' },
  body,
});
const scenarios = [
  {
    field: 'ChangePassword',
    enabled: 'must change their password',
    disabled: 'requirement to change the password',
  },
  {
    field: 'PasswordNeverExpires',
    enabled: 'will no longer expire',
    disabled: 'will follow the normal expiration policy',
  },
  {
    field: 'HOTPKeyDisplay',
    enabled: 'will be shown at the next sign-in',
    disabled: 'will not be shown at the next sign-in',
  },
];

test('boolean password and authenticator policies receive an explicit security impact in either direction', async () => {
  for (const scenario of scenarios)
    for (const enabled of [true, false]) {
      const impact = await assessChangeImpact(
        client,
        'fixture',
        edit({ [scenario.field]: enabled }),
        { [scenario.field]: !enabled },
      );
      assert.equal(impact.level, 'high');
      assert.match(impact.summary, /sign-in or expiration policy/);
      assert.ok(
        impact.consequences.some((message) =>
          message.includes(enabled ? scenario.enabled : scenario.disabled),
        ),
      );
      assert.ok(!impact.summary.includes('metadata'));
    }
});

test('combined access and password policy changes retain both operator consequences', async () => {
  const impact = await assessChangeImpact(
    client,
    'fixture',
    edit({ Enabled: false, ChangePassword: true }),
    { Enabled: true, ChangePassword: false },
  );
  assert.equal(impact.level, 'high');
  assert.match(impact.summary, /access/);
  assert.match(impact.summary, /sign-in or expiration policy/);
  assert.ok(impact.consequences.some((message) => message.includes('Existing sessions')));
  assert.ok(impact.consequences.some((message) => message.includes('must change their password')));
});

test('descriptive edits retain metadata classification and policy messages require exact boolean values', async () => {
  const descriptive = await assessChangeImpact(
    client,
    'fixture',
    edit({ FullName: 'Updated label', Comment: 'Descriptive note' }),
    {},
  );
  assert.equal(descriptive.level, 'low');
  assert.match(descriptive.summary, /descriptive metadata/);
  const malformed = await assessChangeImpact(
    client,
    'fixture',
    edit({
      ChangePassword: 'true',
      PasswordNeverExpires: null,
      HOTPKeyDisplay: {},
      changePassword: true,
    }),
    {},
  );
  assert.equal(malformed.level, 'high');
  assert.match(malformed.summary, /sign-in or expiration policy/);
  assert.ok(malformed.consequences.some((message) => message.includes('unexpected type')));
  assert.ok(
    !malformed.consequences.some((message) => /next sign-in|expiration policy/.test(message)),
  );
});

test('every known policy name stays high-impact with malformed input without exposing the value', async () => {
  const names = [
    'ChangePassword',
    'PasswordNeverExpires',
    'HOTPKeyDisplay',
    'AccountNeverExpires',
    'AutheEnabled',
    'ExpirationDate',
    'PhoneNumber',
    'PhoneProvider',
    'NameSpace',
    'Routine',
  ];
  for (const name of names) {
    const impact = await assessChangeImpact(
      client,
      'fixture',
      edit({ [name]: { private: 'do-not-display' } }),
      {},
    );
    assert.equal(impact.level, 'high', name);
    assert.match(impact.summary, /sign-in or expiration policy/);
    assert.deepEqual(impact.consequences, [
      'The proposed policy value has an unexpected type; review the input before execution.',
    ]);
    assert.ok(!JSON.stringify(impact).includes('do-not-display'));
  }
});

test('account expiration, two-factor and terminal configuration are security policy changes', async () => {
  const settings: Array<[string, unknown, string]> = [
    ['AccountNeverExpires', true, 'account will no longer expire'],
    ['AccountNeverExpires', false, 'account will follow the normal expiration policy'],
    ['AutheEnabled', 0, 'enabled two-factor authentication methods'],
    ['AutheEnabled', 2 ** 20, 'enabled two-factor authentication methods'],
    ['AutheEnabled', 2 ** 21, 'enabled two-factor authentication methods'],
    ['ExpirationDate', '', 'last usable date will be cleared'],
    ['ExpirationDate', '1840-12-31', 'last usable date will be cleared'],
    ['ExpirationDate', '2027-12-31', 'last usable date will change'],
    ['PhoneNumber', '123-456-7890', 'phone number or provider used for two-factor'],
    ['PhoneNumber', '', 'phone number or provider used for two-factor'],
    ['PhoneProvider', 'Fixture provider', 'phone number or provider used for two-factor'],
    ['PhoneProvider', '', 'phone number or provider used for two-factor'],
    ['NameSpace', 'USER', 'terminal sessions will use the configured namespace'],
    ['Routine', 'FixtureStartup', 'terminal sessions will run the configured startup routine'],
    ['Routine', '', 'terminal sessions will start in programmer mode'],
  ];
  for (const [name, value, consequence] of settings) {
    const impact = await assessChangeImpact(client, 'fixture', edit({ [name]: value }), {});
    assert.equal(impact.level, 'high', name);
    assert.match(impact.summary, /sign-in or expiration policy/);
    assert.ok(
      impact.consequences.some((message) => message.includes(consequence)),
      name,
    );
  }
});

test('user deletion retains its removal warning and existing access consequences', async () => {
  const impact = await assessChangeImpact(
    client,
    'fixture',
    {
      ...edit({ ChangePassword: true, AccountNeverExpires: true, AutheEnabled: 0 }),
      method: 'DELETE',
    },
    { Roles: ['FixtureRole'] },
  );
  assert.equal(impact.level, 'high');
  assert.equal(impact.summary, 'The selected record will be removed.');
  assert.ok(
    impact.consequences.some((message) => message.includes('Deletion may leave references')),
  );
  assert.ok(impact.consequences.some((message) => message.includes('Existing sessions')));
  assert.ok(!impact.consequences.some((message) => message.includes('next sign-in')));
  assert.ok(impact.related.some((item) => item.name === 'FixtureRole'));
});
