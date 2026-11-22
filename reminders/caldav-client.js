'use strict';

// Read-only VTODO access. Reuse the calendar client's guarded transport and
// authentication; do not accept caller-supplied URLs as network destinations.
const ICAL = require('ical.js');
const calendarClient = require('../calendar/caldav-client');

const VTODO_FILTER = [{ 'comp-filter': {
  _attributes: { name: 'VCALENDAR' },
  'comp-filter': { _attributes: { name: 'VTODO' } }
} }];

async function discoverLists() {
  const client = await calendarClient.getClient();
  const calendars = await client.fetchCalendars();
  return { client, lists: calendars.filter(c => Array.isArray(c.components) && c.components.includes('VTODO')) };
}

async function listReminderLists() {
  const { lists } = await discoverLists();
  return lists.map(list => ({ id: list.url, name: list.displayName || 'Unnamed list' }));
}

function parseReminder(data, listName) {
  if (typeof data !== 'string' || !data) throw new Error('A reminder has no calendar data');
  let component;
  try {
    component = new ICAL.Component(ICAL.parse(data)).getFirstSubcomponent('vtodo');
  } catch {
    throw new Error('Could not parse a reminder');
  }
  if (!component) throw new Error('Calendar object did not contain a reminder');
  const due = component.getFirstPropertyValue('due');
  const status = String(component.getFirstPropertyValue('status') || '').toUpperCase();
  return {
    id: component.getFirstPropertyValue('uid') || '',
    name: component.getFirstPropertyValue('summary') || '(Untitled)',
    body: component.getFirstPropertyValue('description') || '',
    completed: status === 'COMPLETED' || Boolean(component.getFirstPropertyValue('completed')),
    dueDate: due ? due.toString() : null,
    dueDateIsDate: due ? Boolean(due.isDate) : false,
    priority: Number(component.getFirstPropertyValue('priority') || 0),
    list: listName
  };
}

async function fetchReminders(listName = null) {
  const { client, lists } = await discoverLists();
  const selected = listName ? lists.filter(list => (list.displayName || 'Unnamed list') === listName) : lists;
  if (listName && !selected.length) throw new Error('Reminder list not found');
  const results = [];
  for (const list of selected) {
    // Propagate failures; a partial result must not masquerade as a complete list.
    const objects = await client.fetchCalendarObjects({ calendar: list, filters: VTODO_FILTER });
    for (const object of objects) results.push(parseReminder(object.data, list.displayName || 'Unnamed list'));
  }
  results.sort((a, b) => a.dueDate && b.dueDate ? a.dueDate.localeCompare(b.dueDate) : a.dueDate ? -1 : b.dueDate ? 1 : 0);
  return results;
}

async function listReminders(listName = null, includeCompleted = false, count = 50) {
  const results = await fetchReminders(listName);
  return results.filter(item => includeCompleted || !item.completed).slice(0, count);
}

async function searchReminders(query, count = 25) {
  const results = await fetchReminders();
  const needle = query.toLowerCase();
  return results.filter(item => `${item.name}\n${item.body}`.toLowerCase().includes(needle)).slice(0, count);
}

module.exports = { listReminderLists, listReminders, searchReminders, parseReminder };
