'use strict';
const assert = require('node:assert/strict');
process.env.USE_LOCAL_MODE = 'false';
process.env.ICLOUD_EMAIL = '';
process.env.ICLOUD_APP_PASSWORD = '';
const calendar = require('../calendar/caldav-client');
const cloud = require('../reminders/caldav-client');
const { remindersTools } = require('../reminders');
const todo = (uid, name, status, due, body = '') => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:${uid}\r\nSUMMARY:${name}\r\nSTATUS:${status}\r\n${due ? `DUE;VALUE=DATE:${due}\r\n` : ''}DESCRIPTION:${body}\r\nEND:VTODO\r\nEND:VCALENDAR`;
let fail = false;
let filterSeen = false;
calendar.getClient = async () => ({
  fetchCalendars: async () => [
    { displayName: 'Work', url: 'https://p42-caldav.icloud.com/work/', components: ['VEVENT'] },
    { displayName: 'Tasks', url: 'https://p42-caldav.icloud.com/tasks/', components: ['VTODO'] }
  ],
  fetchCalendarObjects: async ({ calendar: list, filters }) => {
    assert.equal(list.displayName, 'Tasks');
    filterSeen = filters[0]['comp-filter']['comp-filter']._attributes.name === 'VTODO';
    if (fail) throw new Error('temporary failure');
    return [
      { data: todo('a', 'Buy milk', 'NEEDS-ACTION', '20300102', 'from store') },
      { data: todo('b', 'Done item', 'COMPLETED', '', 'milk') }
    ];
  }
});
(async () => {
  assert.deepEqual((await cloud.listReminderLists()).map(x => x.name), ['Tasks']);
  const active = await cloud.listReminders(null, false, 50);
  assert.equal(active.length, 1);
  assert.equal(active[0].name, 'Buy milk');
  assert.equal(active[0].dueDate, '2030-01-02');
  assert.equal(active[0].dueDateIsDate, true);
  assert.ok(filterSeen);
  assert.equal((await cloud.listReminders('Tasks', true, 50)).length, 2);
  assert.equal((await cloud.listReminders('Tasks', true, 1)).length, 1);
  assert.equal((await cloud.searchReminders('MILK')).length, 2);
  await assert.rejects(cloud.listReminders('missing'), /not found/);
  assert.throws(() => cloud.parseReminder('not ical', 'Tasks'));
  const listTool = remindersTools.find(t => t.name === 'list-reminders');
  const result = await listTool.handler({});
  assert.equal(result.structuredContent.total, 1);
  fail = true;
  await assert.rejects(cloud.listReminders(), /temporary failure/);
  assert.equal((await listTool.handler({})).isError, true);
  console.log('Cloud reminders tests passed (synthetic DAV data)');
})().catch(e => { console.error(e); process.exitCode = 1; });
