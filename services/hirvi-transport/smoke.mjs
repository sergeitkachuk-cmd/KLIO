import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:18090';
let ready = false;
for (let n = 0; n < 30; n++) {
  try { if ((await fetch(base + '/health')).status === 200) { ready = true; break; } } catch {}
  await new Promise(r => setTimeout(r, 500));
}
assert.ok(ready, 'Shared HTTP listener ready');
assert.equal((await fetch(base + '/health/telegram')).status, 200);
assert.equal((await fetch(base + '/responses', { method: 'POST', body: '{}' })).status, 401);
const body = 'payload=КЛИО&value=' + 'x'.repeat(20000);
const response = await fetch(base + '/bot123:fixture/sendDocument?value=keep%2Fthis', {
  method: 'POST', headers: { Authorization: 'Bearer must-not-reach-telegram', 'Content-Type': 'application/x-www-form-urlencoded' }, body,
});
assert.equal(response.status, 200);
const forwarded = await response.json();
assert.equal(forwarded.method, 'POST');
assert.equal(forwarded.path, '/bot123:fixture/sendDocument?value=keep%2Fthis');
assert.equal(forwarded.body, body);
assert.equal(forwarded.authorization, null);
console.log('KLIO routes, authentication, method, query and body preserved');
