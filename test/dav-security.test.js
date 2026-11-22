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
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'delete-contact', arguments: { contactUrl: 'https://evil.test/' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'send-email', arguments: { to: 'test@example.test', subject: 'test', body: 'test' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'create-event', arguments: { summary: 'test', start: '2030-01-01T10:00:00Z', end: '2030-01-01T11:00:00Z' } } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'update-event', arguments: { eventUrl: 'https://evil.test/event', summary: 'test' } } },
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'delete-event', arguments: { eventUrl: 'https://evil.test/event' } } }
  ].map(JSON.stringify).join('\n') + '\n';
  for (const mode of ['readonly', 'calendar', 'all']) {
    const env = { ...process.env, USE_LOCAL_MODE: 'false', ICLOUD_EMAIL: '', ICLOUD_APP_PASSWORD: '', ICLOUD_ALLOW_WRITES: mode === 'all' ? 'true' : 'false', ICLOUD_ALLOW_CALENDAR_WRITES: mode === 'calendar' ? 'true' : 'false' };
    const result = spawnSync(process.execPath, ['index.js'], { input: requests, encoding: 'utf8', env, timeout: 20000 });
    assert.equal(result.status, 0, result.stderr);
    const responses = result.stdout.trim().split('\n').map(JSON.parse);
    const response = responses.find(r => r.id === 2);
    const tools = response.result.tools;
    assert.ok(tools.some(t => t.name === 'about'));
    for (const name of ['create-event', 'update-event', 'delete-event']) {
      assert.equal(tools.some(t => t.name === name), mode !== 'readonly', `${mode}: ${name}`);
    }
    for (const name of ['delete-contact', 'create-contact', 'send-email', 'send-message', 'create-note', 'set-mode']) {
      assert.equal(tools.some(t => t.name === name), mode === 'all', `${mode}: ${name}`);
    }
    if (mode === 'readonly') {
      assert.ok(tools.every(t => t.annotations.readOnlyHint === true));
    }
    if (mode !== 'all') {
      for (const id of [3, 4]) {
        const denied = responses.find(r => r.id === id);
        assert.match(denied.error?.message || '', /not found/i, 'disabled non-calendar tool must not be registered');
      }
    }
    for (const id of [5, 6, 7]) {
      const call = responses.find(r => r.id === id);
      assert.ok(call.error || call.result?.isError, 'test credentials must not allow writes');
      if (mode !== 'readonly') assert.match(JSON.stringify(call), /Authentication failed|UNAUTHORIZED/i, 'enabled calendar calls reach handler');
      else assert.match(call.error?.message || '', /not found/i, 'calendar writes must be unregistered by default');
    }
  }
  console.log('DAV security and tool access mode tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
