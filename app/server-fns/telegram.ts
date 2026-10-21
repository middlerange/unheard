// ABOUTME: Server functions for Telegram notification config and testing.
// ABOUTME: Used by the notifications settings page.

import { createServerFn } from '@tanstack/react-start';
import { getSession } from '@/lib/auth';
import { sendNotification } from '@/lib/telegram';

async function requireAuth() {
  const session = await getSession();
  if (!session.data.userId) {
    throw new Error('Unauthorized');
  }
  return session;
}

export const getTelegramStatus = createServerFn({ method: 'GET' })
  .handler(async () => {
    const session = await requireAuth();
    const { getUserById } = await import('@/lib/db/queries');
    const user = await getUserById(session.data.userId!);
    const configured = !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
    return { configured, auto_publish: user?.auto_publish ?? false };
  });

export const sendTestNotification = createServerFn({ method: 'POST' })
  .handler(async () => {
    await requireAuth();
    await sendNotification('✅ Content Hub test notification — Telegram is working!');
    return { ok: true };
  });
