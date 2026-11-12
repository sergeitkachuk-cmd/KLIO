import test from 'node:test';
import assert from 'node:assert/strict';
import { configuration, childEnvironments } from './start.mjs';
const credential = 'fixture-transport-password-at-least-32-chars';

test('transport admits only the three OpenAI TLS endpoints and a fixed WebSocket path', () => {
  const { gost, caddy } = configuration({ PORT: '8081', HIRVI_TRANSPORT_PASSWORD: credential });
  assert.deepEqual(gost.bypasses, [{ name: 'openai-only', whitelist: true, matchers: ['auth.openai.com:443', 'chatgpt.com:443', 'api.openai.com:443'] }]);
  assert.equal(gost.services[0].addr, '127.0.0.1:18082');
  assert.equal(gost.services[0].listener.metadata.path, '/_hirvi/ws');
  assert.equal(gost.services[0].handler.auth.password, credential);
  assert.equal(JSON.stringify(caddy).includes(credential), false);
  assert.equal(caddy.admin.disabled, true);
  const [transport, legacy] = caddy.apps.http.servers.shared.routes;
  assert.deepEqual(transport.match, [{ path: ['/_hirvi/ws'] }]);
  assert.equal(transport.handle[0].upstreams[0].dial, '127.0.0.1:18082');
  assert.equal(legacy.match, undefined);
  assert.equal(legacy.handle[0].upstreams[0].dial, '127.0.0.1:18083');
});

test('invalid credentials and listener conflicts fail closed', () => {
  for (const password of ['', 'short', 'unsafe character password of sufficient length']) {
    assert.throws(() => configuration({ HIRVI_TRANSPORT_PASSWORD: password }));
  }
  for (const PORT of ['0', 'abc', '18081', '18082', '18083', '65536']) {
    assert.throws(() => configuration({ PORT, HIRVI_TRANSPORT_PASSWORD: credential }));
  }
});

test('KLIO credentials never enter Caddy/GOST environment, and transport credential never enters KLIO', () => {
  const { klioEnv, isolatedEnv } = childEnvironments({ OPENAI_API_KEY: 'fixture-key', TELEGRAM_API_HASH: 'fixture-hash', HIRVI_TRANSPORT_PASSWORD: credential, PORT: '8081', PATH: '/usr/bin' }, '/tmp/fixture');
  assert.equal(klioEnv.OPENAI_API_KEY, 'fixture-key');
  assert.equal(klioEnv.TELEGRAM_API_HASH, 'fixture-hash');
  assert.equal(klioEnv.HIRVI_TRANSPORT_PASSWORD, undefined);
  assert.equal(klioEnv.PORT, '18083');
  assert.deepEqual(Object.keys(isolatedEnv).sort(), ['HOME', 'PATH', 'TMPDIR']);
});
