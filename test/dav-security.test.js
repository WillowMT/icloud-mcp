'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { DAVClient } = require('tsdav');
const { validateDavUrl, createSafeDavFetch } = require('../utils/safe-dav-fetch');

(async () => {
  for (const url of ['https://caldav.icloud.com/', 'https://p42-caldav.icloud.com/a', 'https://p42-contacts.icloud.com/a']) {
    assert.ok(validateDavUrl(url));
  }
  for (const url of ['http://caldav.icloud.com/', 'https://caldav.icloud.com.evil.test/', 'https://evil.test/', 'https://caldav.icloud.com@evil.test/', 'https://u:p@caldav.icloud.com/', 'https://caldav.icloud.com:444/', 'file:///etc/passwd']) {
    assert.throws(() => validateDavUrl(url));
  }
  const calls = [];
  const safeFetch = createSafeDavFetch(async (url, options) => {
    calls.push({ url, options });
    return { status: 302, headers: new Headers({ location: 'https://evil.test/steal' }) };
  });
  await assert.rejects(safeFetch('https://caldav.icloud.com/', { headers: { authorization: 'Basic test' } }), /Untrusted/);
  assert.equal(calls.length, 1, 'never send redirect request to attacker');
  assert.equal(calls[0].options.redirect, 'manual');
  const manual = await safeFetch('https://caldav.icloud.com/', { redirect: 'manual' });
  assert.equal(manual.status, 302, 'discovery must receive manual redirects');
  assert.equal(calls.length, 2, 'manual discovery must not follow redirect');
  await assert.rejects(safeFetch('https://evil.test/'), /Untrusted/);
  assert.equal(calls.length, 2);
  let hop = 0;
  const allowed = createSafeDavFetch(async () => ++hop === 1
    ? { status: 307, headers: new Headers({ location: 'https://p42-caldav.icloud.com/a' }) }
    : { status: 200, headers: new Headers() });
  assert.equal((await allowed('https://caldav.icloud.com/')).status, 200);
  assert.equal(hop, 2);

  // Exercise the real locked dependency's authenticated delete path.
  const client = new DAVClient({ serverUrl: 'https://caldav.icloud.com', credentials: { username: 'test', password: 'test' }, authMethod: 'Basic', fetch: safeFetch });
  client.authHeaders = { authorization: 'Basic test' };
  await assert.rejects(client.deleteCalendarObject({ calendarObject: { url: 'https://evil.test/steal' } }), /Untrusted/);
  await assert.rejects(client.deleteVCard({ vCard: { url: 'https://evil.test/steal' } }), /Untrusted/);
  assert.equal(calls.length, 2);

  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'delete-contact', arguments: { contactUrl: 'https://evil.test/' } } }
  ].map(JSON.stringify).join('\n') + '\n';
  for (const enabled of [false, true]) {
    const env = { ...process.env, USE_LOCAL_MODE: 'false', ICLOUD_EMAIL: '', ICLOUD_APP_PASSWORD: '', ICLOUD_ALLOW_WRITES: enabled ? 'true' : 'false' };
    const result = spawnSync(process.execPath, ['index.js'], { input: requests, encoding: 'utf8', env, timeout: 20000 });
    assert.equal(result.status, 0, result.stderr);
    const response = result.stdout.trim().split('\n').map(JSON.parse).find(r => r.id === 2);
    const tools = response.result.tools;
    assert.ok(tools.some(t => t.name === 'about'));
    assert.equal(tools.some(t => t.name === 'delete-contact'), enabled);
    if (!enabled) {
      assert.ok(tools.every(t => t.annotations.readOnlyHint === true));
      const denied = result.stdout.trim().split('\n').map(JSON.parse).find(r => r.id === 3);
      assert.ok(denied.error || denied.result?.isError, 'direct call to disabled tool must fail');
    }
  }
  console.log('DAV security and read-only server tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
