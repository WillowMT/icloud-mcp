'use strict';
const assert = require('node:assert/strict');
process.env.ICLOUD_EMAIL = 'dummy@example.test';
process.env.ICLOUD_APP_PASSWORD = 'dummy';
process.env.USE_LOCAL_MODE = 'false';
const { DAVClient } = require('tsdav');
let response = { ok: true, status: 204 };
DAVClient.prototype.login = async function () {};
DAVClient.prototype.fetchCalendars = async function () { return [{ url: 'https://p42-caldav.icloud.com/test/', displayName: 'Test' }]; };
DAVClient.prototype.fetchCalendarObjects = async function () { return [{ data: 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Original\r\nEND:VEVENT\r\nEND:VCALENDAR', etag: '"test"' }]; };
DAVClient.prototype.createCalendarObject = async function () { return response; };
DAVClient.prototype.updateCalendarObject = async function () { return response; };
DAVClient.prototype.deleteCalendarObject = async function () { return response; };
const calendar = require('../calendar/caldav-client');
const url = 'https://p42-caldav.icloud.com/test/event.ics';
const operations = [
  () => calendar.createEvent({ summary: 'Test', start: '2030-01-01T10:00:00Z', end: '2030-01-01T11:00:00Z' }),
  () => calendar.updateEvent(url, { summary: 'Changed' }),
  () => calendar.deleteEvent(url)
];
(async () => {
  for (const op of operations) {
    response = { ok: true, status: 204 };
    assert.equal((await op()).success, true);
    response = { ok: false, status: 403 };
    await assert.rejects(op(), /failed \(HTTP 403\)/);
    response = { ok: false, status: 412 };
    await assert.rejects(op(), /failed \(HTTP 412\)/);
  }
  console.log('Calendar write response tests passed (mock DAV; no live changes)');
})().catch(error => { console.error(error); process.exitCode = 1; });
