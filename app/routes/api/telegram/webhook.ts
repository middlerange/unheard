// ABOUTME: Receives authenticated Telegram button callbacks for post approvals.
// ABOUTME: Only the configured chat and approver identity can release publishing.

import { createFileRoute } from '@tanstack/react-router';
import { processTelegramApprovalCallback } from '@/lib/approval';
import {
  answerTelegramCallback,
  getTelegramApprovalIdentity,
  sendNotification,
} from '@/lib/telegram';

type TelegramCallbackUpdate = {
  callback_query?: {
    id: string;
    from: { id: number };
    message?: { chat: { id: number } };
    data?: string;
  };
};

export const Route = createFileRoute('/api/telegram/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
        if (!configuredSecret) {
          return Response.json({ error: 'Telegram webhook is not configured' }, { status: 503 });
        }
        const providedSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
        if (!providedSecret || providedSecret !== configuredSecret) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const update = await request.json() as TelegramCallbackUpdate;
        const callback = update.callback_query;
        if (!callback?.data || !callback.message) return Response.json({ ok: true });

        const { chatId, approverUserId } = getTelegramApprovalIdentity();
        const callbackChatId = String(callback.message.chat.id);
        const callbackUserId = String(callback.from.id);
        if (!chatId || !approverUserId || callbackChatId !== chatId || callbackUserId !== approverUserId) {
          await answerTelegramCallback(callback.id, 'You are not authorized to approve this post.', true);
          return Response.json({ ok: true, ignored: true });
        }

        await answerTelegramCallback(
          callback.id,
          callback.data.startsWith('pa:r:') ? 'Post rejected.' : 'Approval received. Publishing now…',
        );

        try {
          const result = await processTelegramApprovalCallback(callback.data, callbackUserId);
          return Response.json({ ok: true, result });
        } catch (error) {
          console.error('[telegram-webhook] approval callback failed:', error);
          await sendNotification('❌ <b>Approval action failed</b>\nNothing was published. Please open Unheard and try again.');
          return Response.json({ error: 'Approval action failed' }, { status: 500 });
        }
      },
    },
  },
});
