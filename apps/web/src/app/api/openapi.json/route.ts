import { NextResponse } from 'next/server';

// Curated surface index, NOT generated — hand-maintained, not validated
// against the route tree. Update by hand when routes under src/app/api change.
const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Sangfor OS API',
    description:
      'Curated index of the web app REST surface (route handlers under src/app/api). Paths and methods only — no schemas.',
    version: '1.0.0',
  },
  servers: [{ url: '/api' }],
  paths: {
    '/mail-candidates': {
      get: { summary: 'List mail candidates', tags: ['mail-candidates'] },
      post: { summary: 'Create a mail candidate', tags: ['mail-candidates'] },
    },
    '/mail-candidates/{id}': {
      get: { summary: 'Get a mail candidate', tags: ['mail-candidates'] },
      patch: { summary: 'Update a mail candidate', tags: ['mail-candidates'] },
    },
    '/mail-candidates/batch': {
      post: { summary: 'Batch-update mail candidates', tags: ['mail-candidates'] },
    },
    '/mail-candidates/convert': {
      post: { summary: 'Convert a mail candidate into an entity', tags: ['mail-candidates'] },
    },
    '/mail-candidates/cleanup': {
      post: { summary: 'Clean up stale mail candidates', tags: ['mail-candidates'] },
    },
    '/mail-candidates/{id}/connect': {
      post: { summary: 'Connect a mail candidate to an existing entity', tags: ['mail-candidates'] },
    },
    '/autopilot/run': {
      post: { summary: 'Trigger an autopilot run', tags: ['autopilot'] },
    },
    '/autopilot/config': {
      get: { summary: 'Get autopilot configuration', tags: ['autopilot'] },
      post: { summary: 'Update autopilot configuration', tags: ['autopilot'] },
    },
    '/daily-report': {
      get: { summary: 'Get the daily report', tags: ['reporting'] },
    },
    '/dashboard/{role}': {
      get: { summary: 'Get role-scoped dashboard data', tags: ['dashboard'] },
    },
    '/agent/playbooks': {
      get: { summary: 'List command-bar playbooks', tags: ['agent'] },
      post: { summary: 'Create a command-bar playbook', tags: ['agent'] },
    },
    '/agent/playbooks/{id}': {
      delete: { summary: 'Delete a command-bar playbook', tags: ['agent'] },
    },
    '/agent/schedules': {
      get: { summary: 'List agent schedules', tags: ['agent'] },
      post: { summary: 'Create an agent schedule', tags: ['agent'] },
    },
    '/agent/schedules/{id}': {
      patch: { summary: 'Update an agent schedule', tags: ['agent'] },
      delete: { summary: 'Delete an agent schedule', tags: ['agent'] },
    },
    '/agent/schedules/tick': {
      post: { summary: 'Tick due agent schedules (scheduler entrypoint)', tags: ['agent'] },
    },
    '/auth/login': {
      post: { summary: 'Log in and obtain a session token', tags: ['auth'] },
    },
  },
} as const;

export async function GET() {
  return NextResponse.json(openApiDocument);
}
