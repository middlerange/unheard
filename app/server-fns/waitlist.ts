// ABOUTME: Server function for public waitlist signups.
// ABOUTME: No auth required — accessible from the landing page.

import { createServerFn } from '@tanstack/react-start';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { insertWaitlistEntry } from '@/lib/db/queries';

const WaitlistInput = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  handle: z.string().optional(),
});

export const joinWaitlist = createServerFn({ method: 'POST' })
  .inputValidator(WaitlistInput)
  .handler(async ({ data }) => {
    const id = uuid();
    const now = Date.now();
    await insertWaitlistEntry(id, data.name, data.email, data.handle || null, now);
    return { ok: true };
  });
