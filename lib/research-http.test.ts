import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { researchHttp } from './research-http';

vi.mock('./auth', () => ({ getRequestTeamId: vi.fn(async () => 'team') }));

it('returns a conflict when an explicit source subset differs from the active run', async () => {
  const response = await researchHttp(new Request('https://app.test/api/research/runs'), async () => {
    throw new Error('A research run with different sources is active. Wait for it to finish before starting this source subset.');
  }, 202);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: expect.stringContaining('different sources') });
});

it('returns a validation error for an explicit source disabled for the requesting team', async () => {
  const response = await researchHttp(new Request('https://app.test/api/research/runs'), async () => {
    z.array(z.string()).refine(() => false, 'Requested sources must be enabled for this team').parse(['disabled-source']);
  }, 202);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid research request', details: ['Requested sources must be enabled for this team'] });
});
