// ABOUTME: Telegram Bot API client for sending push notifications.
// ABOUTME: Best-effort delivery — notification errors are logged and swallowed.

import type { PostWithDetails } from './db/types';
import type { ApprovalSnapshot } from './approval';
import { htmlToText } from './text';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return null;
  return { token, chatId };
}

type TelegramMessage = {
  message_id: number;
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

async function telegramRequest<T>(token: string, method: string, body: Record<string, unknown>): Promise<T | undefined> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const responseBody = await res.text();
    throw new Error(`Telegram API ${res.status}: ${responseBody}`);
  }

  if (typeof res.json !== 'function') return undefined;
  const payload = await res.json() as TelegramApiResponse<T>;
  if (!payload.ok) {
    throw new Error(`Telegram API error: ${payload.description ?? 'Unknown error'}`);
  }
  return payload.result;
}

function platformLabel(platform: string): string {
  switch (platform) {
    case 'twitter':
      return 'X (Twitter)';
    case 'linkedin':
      return 'LinkedIn';
    case 'instagram':
      return 'Instagram';
    case 'facebook':
      return 'Facebook';
    case 'youtube':
      return 'YouTube';
    default:
      return platform;
  }
}

function platformUrl(platform: string, platformPostId: string): string | null {
  switch (platform) {
    case 'twitter':
      return `https://x.com/i/status/${platformPostId}`;
    case 'linkedin':
      return `https://www.linkedin.com/feed/update/${platformPostId}`;
    case 'instagram':
      return `https://www.instagram.com/p/${platformPostId}/`;
    case 'facebook':
      return `https://www.facebook.com/${platformPostId}`;
    case 'youtube':
      return `https://www.youtube.com/watch?v=${platformPostId}`;
    default:
      return null;
  }
}

export async function sendNotification(text: string): Promise<boolean> {
  const config = getConfig();
  if (!config) return false;

  await telegramRequest(config.token, 'sendMessage', {
    chat_id: config.chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });

  return true;
}

function formatScheduledTime(timestamp: number | null): string {
  if (!timestamp) return 'Immediately after approval';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp)) + ' IST';
}

function profileLabel(target: ApprovalSnapshot['targets'][number]): string {
  const name = target.channel_name || 'Unnamed profile';
  const account = target.channel_account_id && target.channel_account_id !== name
    ? ` (${target.channel_account_id})`
    : '';
  return `${name}${account}`;
}

function splitMessage(text: string, maxLength = 3800): string[] {
  const characters = Array.from(text);
  const chunks: string[] = [];
  for (let index = 0; index < characters.length; index += maxLength) {
    chunks.push(characters.slice(index, index + maxLength).join(''));
  }
  return chunks.length > 0 ? chunks : [''];
}

async function sendMediaPreview(
  token: string,
  chatId: string,
  media: ApprovalSnapshot['media'][number],
  destination: string,
  index: number,
  total: number,
): Promise<void> {
  const method = media.type === 'video' ? 'sendVideo' : 'sendPhoto';
  const field = media.type === 'video' ? 'video' : 'photo';
  try {
    await telegramRequest(token, method, {
      chat_id: chatId,
      [field]: media.url,
      caption: `Asset ${index + 1}/${total}: ${media.filename}\nDestination: ${destination}`,
    });
  } catch (error) {
    console.error('[telegram] media preview failed:', error);
    await telegramRequest(token, 'sendMessage', {
      chat_id: chatId,
      text: `Asset ${index + 1}/${total}: ${media.filename}\nDestination: ${destination}\n${media.url}`,
      disable_web_page_preview: false,
    });
  }
}

export async function sendApprovalPacket(
  approvalId: string,
  callbackToken: string,
  snapshot: ApprovalSnapshot,
): Promise<number> {
  const config = getConfig();
  if (!config) throw new Error('Telegram approval is not configured');

  const profiles = snapshot.targets
    .map(target => `${platformLabel(target.platform)} → ${profileLabel(target)}`)
    .join('\n');

  await telegramRequest(config.token, 'sendMessage', {
    chat_id: config.chatId,
    text: [
      '🔐 <b>Post approval required</b>',
      '',
      `<b>Scheduled:</b> ${escapeHtml(formatScheduledTime(snapshot.publish_at))}`,
      `<b>Group:</b> ${escapeHtml(snapshot.channel_group || 'custom')}`,
      `<b>Profiles:</b>\n${escapeHtml(profiles)}`,
      `<b>Assets:</b> ${snapshot.media.length}`,
    ].join('\n'),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });

  for (let index = 0; index < snapshot.media.length; index += 1) {
    const media = snapshot.media[index];
    const target = media.target_id
      ? snapshot.targets.find(candidate => candidate.target_id === media.target_id)
      : null;
    const destination = target
      ? `${platformLabel(target.platform)} → ${profileLabel(target)}`
      : 'Shared across all profiles';
    await sendMediaPreview(config.token, config.chatId, media, destination, index, snapshot.media.length);
  }

  for (const target of snapshot.targets) {
    const parts = [
      `EXACT COPY — ${platformLabel(target.platform)} — ${profileLabel(target)}`,
      '',
      target.content,
    ];
    if (target.thread.length > 0) {
      target.thread.forEach((item, index) => {
        parts.push('', `THREAD / COMMENT ${index + 1}`, '', item);
      });
    }
    for (const chunk of splitMessage(parts.join('\n'))) {
      await telegramRequest(config.token, 'sendMessage', {
        chat_id: config.chatId,
        text: chunk,
        disable_web_page_preview: true,
      });
    }
  }

  const baseUrl = process.env.CONTENT_HUB_PUBLIC_URL || globalThis.__contentHubOrigin__;
  const message = await telegramRequest<TelegramMessage>(config.token, 'sendMessage', {
    chat_id: config.chatId,
    text: [
      'Nothing will be published without your approval.',
      '',
      'Approve publishes the exact profiles, copy, and assets shown above.',
    ].join('\n'),
    reply_markup: {
      inline_keyboard: [
        [{ text: '✅ Approve & publish', callback_data: `pa:a:${approvalId}:${callbackToken}` }],
        [
          ...(baseUrl ? [{ text: '✏️ Open / edit', url: `${baseUrl.replace(/\/$/, '')}/posts/${encodeURIComponent(snapshot.post_id)}` }] : []),
          { text: '❌ Reject', callback_data: `pa:r:${approvalId}:${callbackToken}` },
        ],
      ],
    },
    disable_web_page_preview: true,
  });

  if (!message?.message_id) throw new Error('Telegram did not return an approval message id');
  return message.message_id;
}

export function getTelegramApprovalIdentity(): { chatId: string | null; approverUserId: string | null } {
  const chatId = process.env.TELEGRAM_CHAT_ID ?? null;
  const configuredApprover = process.env.TELEGRAM_APPROVER_USER_ID ?? null;
  const approverUserId = configuredApprover ?? (chatId && !chatId.startsWith('-') ? chatId : null);
  return { chatId, approverUserId };
}

export async function answerTelegramCallback(
  callbackQueryId: string,
  text: string,
  showAlert = false,
): Promise<void> {
  const config = getConfig();
  if (!config) return;
  await telegramRequest(config.token, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert,
  });
}

export async function clearTelegramApprovalButtons(messageId: number): Promise<void> {
  const config = getConfig();
  if (!config) return;
  await telegramRequest(config.token, 'editMessageReplyMarkup', {
    chat_id: config.chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  });
}

export function buildPublishedMessage(post: PostWithDetails): string {
  const lines: string[] = ['📤 <b>Post published</b>\n'];

  for (const target of post.targets) {
    if (!target.platform_post_id) continue;
    const platform = target.channel_name ?? platformLabel(target.platform);
    const url = platformUrl(target.platform, target.platform_post_id);
    lines.push(url ? `${platform}: ${escapeHtml(url)}` : `${platform}: ${escapeHtml(target.platform_post_id)}`);
  }

  const firstTarget = post.targets[0];
  if (firstTarget) {
    const preview = escapeHtml(htmlToText(firstTarget.content).slice(0, 300));
    lines.push(`\n<i>${preview}</i>`);
  }

  return lines.join('\n');
}

export function buildFailedMessage(post: PostWithDetails): string {
  const lines: string[] = ['❌ <b>Post publish failed</b>\n'];

  for (const target of post.targets) {
    const platform = target.channel_name ?? platformLabel(target.platform);
    const url = target.platform_post_id ? platformUrl(target.platform, target.platform_post_id) : null;

    if (target.platform_post_id) {
      lines.push(`${platform}: ✅ Published ${escapeHtml(url ?? target.platform_post_id)}`);
    }

    if (target.error) {
      lines.push(`${platform}: ❌ ${escapeHtml(target.error)}`);
      continue;
    }

    if (!target.platform_post_id) {
      lines.push(`${platform}: ❌ Failed`);
    }
  }

  const firstTarget = post.targets[0];
  if (firstTarget) {
    const preview = escapeHtml(htmlToText(firstTarget.content).slice(0, 300));
    lines.push(`\n<i>${preview}</i>`);
  }

  return lines.join('\n');
}

export async function notifyPublished(post: PostWithDetails): Promise<void> {
  try {
    await sendNotification(buildPublishedMessage(post));
  } catch (err) {
    console.error('[telegram] notification failed:', err);
  }
}

export async function notifyFailed(post: PostWithDetails): Promise<void> {
  try {
    await sendNotification(buildFailedMessage(post));
  } catch (err) {
    console.error('[telegram] notification failed:', err);
  }
}
