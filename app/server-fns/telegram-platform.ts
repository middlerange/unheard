// ABOUTME: Telegram platform integration (Issue #10)
// ABOUTME: Bot-based posting to Telegram channels and groups with Markdown support

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/schema';
import { requireAuth } from '@/app/server-fns/auth';

// Telegram API response types
interface TelegramMessage {
  message_id: number;
  chat: { id: number; title?: string };
  date: number;
  text?: string;
}

interface TelegramApiResponse {
  ok: boolean;
  result?: TelegramMessage;
  error_code?: number;
  description?: string;
}

// Input validation
const addChannelSchema = z.object({
  name: z.string().min(1).max(100),
  channelId: z.string().min(1), // Can be channel username (@channel) or chat ID (-100...)
  botToken: z.string().min(1),
  threadId: z.string().optional(), // For forum topics
});

const sendMessageSchema = z.object({
  channelId: z.string(),
  content: z.string().min(1).max(4096),
  botToken: z.string(),
  threadId: z.string().optional(),
  mediaUrls: z.array(z.string().url()).optional(),
});

// Validate bot token format (should be numbers:alphanumeric)
function isValidBotToken(token: string): boolean {
  return /^\d+:[A-Za-z0-9_-]{35,}$/.test(token);
}

// Send text message to Telegram
async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  threadId?: string
): Promise<TelegramApiResponse> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  
  const params: Record<string, string> = {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: 'false',
  };
  
  if (threadId) {
    params.message_thread_id = threadId;
  }
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  
  return await response.json();
}

// Send photo to Telegram
async function sendTelegramPhoto(
  botToken: string,
  chatId: string,
  photoUrl: string,
  caption?: string,
  threadId?: string
): Promise<TelegramApiResponse> {
  const url = `https://api.telegram.org/bot${botToken}/sendPhoto`;
  
  const params: Record<string, string> = {
    chat_id: chatId,
    photo: photoUrl,
    parse_mode: 'Markdown',
  };
  
  if (caption) {
    params.caption = caption;
  }
  
  if (threadId) {
    params.message_thread_id = threadId;
  }
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  
  return await response.json();
}

// Send media group (multiple photos)
async function sendTelegramMediaGroup(
  botToken: string,
  chatId: string,
  mediaUrls: string[],
  threadId?: string
): Promise<TelegramApiResponse> {
  const url = `https://api.telegram.org/bot${botToken}/sendMediaGroup`;
  
  const media = mediaUrls.map((url, index) => ({
    type: 'photo',
    media: url,
    caption: index === 0 ? undefined : undefined, // Only first image gets caption if provided separately
  }));
  
  const params: Record<string, unknown> = {
    chat_id: chatId,
    media,
  };
  
  if (threadId) {
    params.message_thread_id = threadId;
  }
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  
  return await response.json();
}

// Test bot token and get bot info
export const testTelegramBot = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ botToken: z.string() }))
  .handler(async ({ data }) => {
    if (!isValidBotToken(data.botToken)) {
      throw new Error('Invalid bot token format. Should be like: 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11');
    }
    
    const url = `https://api.telegram.org/bot${data.botToken}/getMe`;
    
    try {
      const response = await fetch(url);
      const result = await response.json();
      
      if (!result.ok) {
        throw new Error(result.description || 'Failed to validate bot token');
      }
      
      return {
        valid: true,
        bot: {
          id: result.result.id,
          name: result.result.first_name,
          username: result.result.username,
        },
      };
    } catch (error) {
      throw new Error(`Bot validation failed: ${(error as Error).message}`);
    }
  });

// Add Telegram channel
export const addTelegramChannel = createServerFn({ method: 'POST' })
  .inputValidator(addChannelSchema)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const db = await getDb();
    
    // Get user's team
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      throw new Error('User not associated with a team');
    }
    
    const teamId = membership[0].teamId;
    
    // Validate bot token by calling getMe
    const botTest = await testTelegramBot({ data: { botToken: data.botToken } });
    
    if (!botTest.valid) {
      throw new Error('Invalid bot token');
    }
    
    // Test channel access by sending a test message (we'll delete it immediately or just check permissions)
    // Actually, let's just try to get chat info
    const chatInfoUrl = `https://api.telegram.org/bot${data.botToken}/getChat?chat_id=${data.channelId}`;
    
    try {
      const chatResponse = await fetch(chatInfoUrl);
      const chatResult = await chatResponse.json();
      
      if (!chatResult.ok) {
        throw new Error(`Cannot access channel: ${chatResult.description}`);
      }
      
      // Save to telegram_channels table
      const id = crypto.randomUUID();
      const now = Date.now();
      
      await db.insert(schema.telegram_channels).values({
        id,
        team_id: teamId,
        channel_id: data.channelId,
        name: data.name,
        bot_token: data.botToken,
        thread_id: data.threadId || null,
        created_at: now,
      });
      
      return {
        id,
        name: data.name,
        channelId: data.channelId,
        botUsername: botTest.bot.username,
        chatTitle: chatResult.result.title || chatResult.result.username || data.channelId,
        message: 'Telegram channel added successfully',
      };
    } catch (error) {
      if ((error as Error).message.includes('Cannot access channel')) {
        throw error;
      }
      throw new Error(`Failed to verify channel access. Make sure the bot is added to the channel as an admin.`);
    }
  });

// List Telegram channels
export const listTelegramChannels = createServerFn({ method: 'GET' })
  .handler(async () => {
    const user = await requireAuth();
    const db = await getDb();
    
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      return [];
    }
    
    const channels = await db
      .select({
        id: schema.telegram_channels.id,
        channel_id: schema.telegram_channels.channel_id,
        name: schema.telegram_channels.name,
        bot_token: schema.telegram_channels.bot_token,
        thread_id: schema.telegram_channels.thread_id,
        created_at: schema.telegram_channels.created_at,
      })
      .from(schema.telegram_channels)
      .where(eq(schema.telegram_channels.team_id, membership[0].teamId))
      .orderBy(desc(schema.telegram_channels.created_at));
    
    // Mask bot tokens for security
    return channels.map(ch => ({
      ...ch,
      bot_token: ch.bot_token.slice(0, 10) + '...' + ch.bot_token.slice(-5),
    }));
  });

// Delete Telegram channel
export const deleteTelegramChannel = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const db = await getDb();
    
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      throw new Error('Not authorized');
    }
    
    await db
      .delete(schema.telegram_channels)
      .where(and(
        eq(schema.telegram_channels.id, data.id),
        eq(schema.telegram_channels.team_id, membership[0].teamId)
      ));
    
    return { message: 'Telegram channel removed' };
  });

// Publish post to Telegram
export const publishToTelegram = createServerFn({ method: 'POST' })
  .inputValidator(sendMessageSchema)
  .handler(async ({ data }) => {
    try {
      let result: TelegramApiResponse;
      
      if (data.mediaUrls && data.mediaUrls.length > 0) {
        if (data.mediaUrls.length === 1) {
          // Single photo with caption
          result = await sendTelegramPhoto(
            data.botToken,
            data.channelId,
            data.mediaUrls[0],
            data.content,
            data.threadId
          );
        } else {
          // Multiple photos - send media group first, then text if needed
          result = await sendTelegramMediaGroup(
            data.botToken,
            data.channelId,
            data.mediaUrls,
            data.threadId
          );
          
          // If there's substantial text, send it as a follow-up message
          if (data.content.length > 10) {
            await sendTelegramMessage(
              data.botToken,
              data.channelId,
              data.content,
              data.threadId
            );
          }
        }
      } else {
        // Text only
        result = await sendTelegramMessage(
          data.botToken,
          data.channelId,
          data.content,
          data.threadId
        );
      }
      
      if (!result.ok) {
        throw new Error(result.description || 'Failed to send Telegram message');
      }
      
      return {
        success: true,
        messageId: result.result?.message_id,
        chatId: result.result?.chat.id,
      };
    } catch (error) {
      throw new Error(`Telegram publish failed: ${(error as Error).message}`);
    }
  });

// Convert HTML/Tiptap content to Telegram Markdown
export function formatForTelegram(htmlContent: string): string {
  // Simple HTML to Markdown conversion for Telegram
  let text = htmlContent;
  
  // Bold
  text = text.replace(/<strong>(.*?)<\/strong>/gi, '*$1*');
  text = text.replace(/<b>(.*?)<\/b>/gi, '*$1*');
  
  // Italic
  text = text.replace(/<em>(.*?)<\/em>/gi, '_$1_');
  text = text.replace(/<i>(.*?)<\/i>/gi, '_$1_');
  
  // Strikethrough
  text = text.replace(/<s>(.*?)<\/s>/gi, '~$1~');
  text = text.replace(/<strike>(.*?)<\/strike>/gi, '~$1~');
  
  // Code
  text = text.replace(/<code>(.*?)<\/code>/gi, '`$1`');
  text = text.replace(/<pre>(.*?)<\/pre>/gi, '```\n$1\n```');
  
  // Links
  text = text.replace(/<a href="(.*?)">(.*?)<\/a>/gi, '[$2]($1)');
  
  // Remove remaining HTML tags
  text = text.replace(/<[^>]*>/g, '');
  
  // Decode HTML entities
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&quot;/g, '"');
  
  // Telegram has a 4096 character limit for messages
  if (text.length > 4096) {
    text = text.slice(0, 4093) + '...';
  }
  
  return text;
}
