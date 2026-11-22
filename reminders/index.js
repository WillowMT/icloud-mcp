/**
 * Reminders Module
 * MCP tool definitions for Reminders.app and read-only iCloud CalDAV
 */

const { z } = require('zod');
const localClient = require('./local-client');
const cloudClient = require('./caldav-client');
const { formatError } = require('../utils/error-handler');
const { listOutput, listResult } = require('../utils/schemas');
const { isLocalMode } = require('../mode');

/**
 * Check if we're in local mode, return error if not
 */
function requireLocalMode(toolName) {
  if (!isLocalMode()) {
    return formatError(new Error(`${toolName} is only available in LOCAL mode. Use set-mode to switch.`));
  }
  return null;
}

const remindersTools = [
  {
    name: 'list-reminder-lists',
    outputSchema: listOutput('list-reminder-lists'),
    title: 'List Reminder Lists',
    description: 'Lists reminder lists. Cloud mode exposes only lists available via iCloud CalDAV; some newer lists may be absent.',
    inputSchema: {},
    annotations: {"readOnlyHint":true,"idempotentHint":true,"openWorldHint":true},
    handler: async () => {
      try {
        const lists = await (isLocalMode() ? localClient : cloudClient).listReminderLists();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(lists, null, 2)
          }],
          structuredContent: listResult(lists)
        };
      } catch (error) {
        return formatError(error, 'list-reminder-lists');
      }
    }
  },
  {
    name: 'list-reminders',
    outputSchema: listOutput('list-reminders'),
    title: 'List Reminders',
    description: 'Lists reminders from a specific list or all lists. Cloud mode supports only CalDAV-accessible reminder lists; some newer lists may be absent.',
    inputSchema: {
      listName: z.string().optional().describe('Name of the reminder list (optional, lists all if not provided)'),
      includeCompleted: z.boolean().optional().describe('Include completed reminders (default: false)'),
      count: z.number().int().min(1).max(200).optional().describe('Maximum number of reminders to return (default: 50)')
    },
    annotations: {"readOnlyHint":true,"idempotentHint":true,"openWorldHint":true},
    handler: async ({ listName, includeCompleted = false, count = 50 }) => {
      try {
        const reminders = await (isLocalMode() ? localClient : cloudClient).listReminders(listName, includeCompleted, count);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(reminders, null, 2)
          }],
          structuredContent: listResult(reminders)
        };
      } catch (error) {
        return formatError(error, 'list-reminders');
      }
    }
  },
  {
    name: 'create-reminder',
    title: 'Create Reminder',
    description: 'Creates a new reminder (LOCAL mode only)',
    inputSchema: {
      name: z.string().describe('Reminder title (required)'),
      body: z.string().optional().describe('Reminder notes/description'),
      dueDate: z.string().optional().describe('Due date in ISO format (e.g., 2026-01-15T10:00:00)'),
      listName: z.string().optional().describe('Name of the list to add to (default: Reminders)'),
      priority: z.number().int().min(0).max(9).optional().describe('Priority level (0=none, 1=high, 5=medium, 9=low)')
    },
    annotations: {"readOnlyHint":false,"destructiveHint":false,"idempotentHint":false,"openWorldHint":false},
    handler: async (args) => {
      const modeError = requireLocalMode('create-reminder');
      if (modeError) return modeError;

      try {
        const result = await localClient.createReminder(args);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (error) {
        return formatError(error, 'create-reminder');
      }
    }
  },
  {
    name: 'update-reminder',
    title: 'Update Reminder',
    description: 'Updates an existing reminder (LOCAL mode only)',
    inputSchema: {
      reminderId: z.string().describe('ID of the reminder to update (required)'),
      name: z.string().optional().describe('New title'),
      body: z.string().optional().describe('New notes/description'),
      dueDate: z.string().optional().describe('New due date in ISO format'),
      priority: z.number().int().min(0).max(9).optional().describe('New priority level')
    },
    annotations: {"readOnlyHint":false,"destructiveHint":true,"idempotentHint":true,"openWorldHint":false},
    handler: async ({ reminderId, ...updates }) => {
      const modeError = requireLocalMode('update-reminder');
      if (modeError) return modeError;

      try {
        const result = await localClient.updateReminder(reminderId, updates);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (error) {
        return formatError(error, 'update-reminder');
      }
    }
  },
  {
    name: 'complete-reminder',
    title: 'Complete Reminder',
    description: 'Marks a reminder as complete or incomplete (LOCAL mode only)',
    inputSchema: {
      reminderId: z.string().describe('ID of the reminder (required)'),
      completed: z.boolean().optional().describe('Set to true to complete, false to uncomplete (default: true)')
    },
    annotations: {"readOnlyHint":false,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
    handler: async ({ reminderId, completed = true }) => {
      const modeError = requireLocalMode('complete-reminder');
      if (modeError) return modeError;

      try {
        const result = await localClient.completeReminder(reminderId, completed);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (error) {
        return formatError(error, 'complete-reminder');
      }
    }
  },
  {
    name: 'delete-reminder',
    title: 'Delete Reminder',
    description: 'Deletes a reminder (LOCAL mode only)',
    inputSchema: {
      reminderId: z.string().describe('ID of the reminder to delete (required)')
    },
    annotations: {"readOnlyHint":false,"destructiveHint":true,"idempotentHint":true,"openWorldHint":false},
    handler: async ({ reminderId }) => {
      const modeError = requireLocalMode('delete-reminder');
      if (modeError) return modeError;

      try {
        const result = await localClient.deleteReminder(reminderId);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (error) {
        return formatError(error, 'delete-reminder');
      }
    }
  },
  {
    name: 'search-reminders',
    title: 'Search Reminders',
    description: 'Search reminder names or notes. Cloud mode supports only CalDAV-accessible lists; some newer lists may be absent.',
    inputSchema: {
      query: z.string().describe('Search text (required)'),
      count: z.number().int().min(1).max(200).optional().describe('Maximum results to return (default: 25)')
    },
    annotations: {"readOnlyHint":true,"idempotentHint":true,"openWorldHint":true},
    handler: async ({ query, count = 25 }) => {
      try {
        const results = await (isLocalMode() ? localClient : cloudClient).searchReminders(query, count);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(results, null, 2)
          }]
        };
      } catch (error) {
        return formatError(error, 'search-reminders');
      }
    }
  }
];

module.exports = { remindersTools };
