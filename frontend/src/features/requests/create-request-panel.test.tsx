import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFor } from '../../api/client';
import { CreateRequestPanel } from './create-request-panel';

const application = {
  id: 'APP-100',
  customerLabel: 'Customer A',
  managerId: 'ali',
  standardRateBps: 400,
  requestId: null,
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('CreateRequestPanel retries', () => {
  const posts: { key: string | null; body: string }[] = [];
  let postResults: (() => Promise<Response>)[] = [];

  beforeEach(() => {
    posts.length = 0;
    vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
      if (new URL(input).pathname === '/applications') return json(200, [application]);
      posts.push({ key: new Headers(init.headers).get('Idempotency-Key'), body: String(init.body) });
      const next = postResults.shift();
      if (!next) throw new Error('Unexpected POST');
      return next();
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  async function fillAndSubmit() {
    await userEvent.type(await screen.findByLabelText('Discount (basis points)'), '25');
    await userEvent.type(screen.getByLabelText('Reason'), 'Competing offer');
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
  }

  it('resends the same key and body after a network failure', async () => {
    const onCreated = vi.fn();
    postResults = [() => Promise.reject(new TypeError('Failed to fetch')), async () => json(201, { requestId: 'r1' })];
    render(<CreateRequestPanel api={apiFor('ali')} onCreated={onCreated} />);

    await fillAndSubmit();
    expect((await screen.findByRole('alert')).textContent).toContain('Could not reach the server');
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }));

    expect(onCreated).toHaveBeenCalledWith('r1');
    expect(posts).toHaveLength(2);
    expect(posts[0].key).toBeTruthy();
    expect(posts[1]).toEqual(posts[0]);
  });

  it('uses a fresh key after a definitive server response', async () => {
    postResults = [
      async () => json(409, { code: 'REQUEST_EXISTS', message: 'Already exists' }),
      async () => json(201, { requestId: 'r1' }),
    ];
    render(<CreateRequestPanel api={apiFor('ali')} onCreated={vi.fn()} />);

    await fillAndSubmit();
    expect((await screen.findByRole('alert')).textContent).toContain('Already exists');
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }));

    expect(posts).toHaveLength(2);
    expect(posts[1].key).not.toBe(posts[0].key);
  });
});
