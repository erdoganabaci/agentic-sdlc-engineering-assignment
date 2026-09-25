import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestDetail, RequestSummary, User } from './api/types';
import { App } from './app';

const ali: User = { id: 'ali', name: 'Ali', role: 'MANAGER' };
const emma: User = { id: 'emma', name: 'Emma', role: 'REVIEWER' };

const summary: RequestSummary = {
  id: 'REQ-101',
  applicationId: 'APP-101',
  customerLabel: 'Synthetic customer B',
  standardRateBps: 400,
  status: 'PENDING',
  currentVersionNumber: 1,
  discountBps: 25,
  rowRevision: 0,
  updatedAt: '2026-01-05T09:00:00Z',
};

const version = {
  id: 'REQ-101-v1',
  versionNumber: 1,
  discountBps: 25,
  reason: 'Existing customer',
  createdBy: ali,
  createdAt: '2026-01-05T09:00:00Z',
  decision: null,
  isCurrent: true,
};

const detailV1: RequestDetail = { ...summary, creator: ali, createdAt: summary.updatedAt, versions: [version] };
const detailV2: RequestDetail = {
  ...detailV1,
  currentVersionNumber: 2,
  discountBps: 40,
  rowRevision: 1,
  versions: [
    { ...version, isCurrent: false },
    { ...version, id: 'REQ-101-v2', versionNumber: 2, discountBps: 40, reason: 'Revised' },
  ],
};

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

describe('App', () => {
  const calls: { method: string; path: string; userId: string | null }[] = [];
  let currentDetail = detailV1;

  beforeEach(() => {
    calls.length = 0;
    currentDetail = detailV1;
    vi.stubGlobal('fetch', (input: string, init: RequestInit = {}) => {
      const path = new URL(input).pathname;
      const method = init.method ?? 'GET';
      calls.push({ method, path, userId: new Headers(init.headers).get('X-User-Id') });
      if (path === '/demo/users') return json(200, [ali, emma]);
      if (path === '/requests' && method === 'GET') {
        return json(200, { items: [summary], page: 1, pageSize: 100, total: 1 });
      }
      if (path === '/requests/REQ-101') return json(200, currentDetail);
      if (path.endsWith('/decision')) {
        currentDetail = detailV2;
        return json(409, { code: 'VERSION_NOT_CURRENT', message: 'Only the current version can be reviewed.' });
      }
      return json(404, { code: 'NOT_FOUND', message: 'Not found' });
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  async function actAs(name: string) {
    await userEvent.selectOptions(
      await screen.findByLabelText('Acting as'),
      within(screen.getByLabelText('Acting as')).getByText(new RegExp(name)),
    );
  }

  it('clears the selected request and reloads as the new actor when switching users', async () => {
    render(<App />);
    await actAs('Ali');
    await userEvent.click(await screen.findByRole('button', { name: 'APP-101' }));
    expect(await screen.findByRole('heading', { name: /APP-101/ })).toBeTruthy();
    expect(screen.getByText('Revise request')).toBeTruthy();

    await actAs('Emma');
    expect(await screen.findByText('Select a request to see its details and history.')).toBeTruthy();
    expect(screen.getByText('Role: Pricing reviewer')).toBeTruthy();
    expect(calls.filter((call) => call.path === '/requests').at(-1)?.userId).toBe('emma');
  });

  it('shows a conflict, reloads the latest version and never resubmits automatically', async () => {
    render(<App />);
    await actAs('Emma');
    await userEvent.click(await screen.findByRole('button', { name: 'APP-101' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Approve 25 bps' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Only the current version can be reviewed');
    expect(await screen.findByRole('button', { name: 'Approve 40 bps' })).toBeTruthy();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });
});
