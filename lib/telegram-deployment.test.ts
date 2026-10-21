import { afterEach, expect, it, vi } from 'vitest';
import { sendApprovalPacket } from './telegram';
import type { ApprovalSnapshot } from './approval';

const snapshot: ApprovalSnapshot = {
  version: 1, post_id: 'local-post', team_id: 'local-team',
  channel_group: 'personal', publish_at: null, targets: [], media: [],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  globalThis.__contentHubOrigin__ = undefined;
});

it.each(['https://my-social.example', ''])('keeps approval links on the configured deployment (%s)', async (origin) => {
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
  vi.stubEnv('TELEGRAM_CHAT_ID', '123');
  vi.stubEnv('CONTENT_HUB_PUBLIC_URL', origin);
  globalThis.__contentHubOrigin__ = undefined;
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 42 } })));
  vi.stubGlobal('fetch', fetchMock);
  expect(await sendApprovalPacket('approval', 'token', snapshot)).toBe(42);
  const payload = JSON.parse(fetchMock.mock.calls.at(-1)![1].body);
  const buttons = payload.reply_markup.inline_keyboard.flat();
  expect(buttons.filter((button: { url?: string }) => button.url)).toEqual(
    origin ? [{ text: '✏️ Open / edit', url: `${origin}/posts/local-post` }] : [],
  );
  expect(JSON.stringify(payload)).not.toContain('unheard.io');
});
