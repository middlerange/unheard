// ABOUTME: Discord webhook and bot integration for posting messages to Discord channels.
// ABOUTME: Supports webhooks (easy) and bot tokens (advanced) for posting rich embeds.

import { htmlToText } from './text';
import type { Media } from './db/types';

export interface DiscordWebhookCreds {
  type: 'webhook';
  webhookUrl: string;
}

export interface DiscordBotCreds {
  type: 'bot';
  botToken: string;
  channelId: string;
}

export type DiscordCreds = DiscordWebhookCreds | DiscordBotCreds;

interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  image?: { url: string };
  thumbnail?: { url: string };
  footer?: { text: string };
  timestamp?: string;
}

interface DiscordMessage {
  content?: string;
  embeds?: DiscordEmbed[];
  attachments?: { filename: string; file: Blob }[];
}

function buildEmbeds(content: string, media: Media[]): DiscordEmbed[] {
  const text = htmlToText(content);
  if (media.length === 0 && text.length <= 2000) {
    return []; // No embeds needed for text-only messages under limit
  }

  const embeds: DiscordEmbed[] = [];
  
  // If content is too long for a regular message, put it in an embed
  if (text.length > 2000) {
    embeds.push({
      description: text.slice(0, 4096), // Discord embed description limit
      color: 0x5865F2, // Discord blurple
    });
  }

  // Add image embeds
  for (const item of media.slice(0, 10)) { // Discord allows up to 10 embeds
    if (item.type === 'image') {
      embeds.push({
        image: { url: item.url },
        color: 0x5865F2,
      });
    }
  }

  return embeds;
}

async function uploadWithWebhook(
  message: DiscordMessage,
  webhookUrl: string
): Promise<string> {
  const formData = new FormData();
  
  // Add content if present and within limits
  if (message.content && message.content.length <= 2000) {
    formData.append('content', message.content);
  }
  
  // Add embeds
  if (message.embeds && message.embeds.length > 0) {
    formData.append('embeds', JSON.stringify(message.embeds));
  }
  
  // Add attachments
  if (message.attachments) {
    for (const attachment of message.attachments) {
      formData.append('files', attachment.file, attachment.filename);
    }
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Discord webhook failed: ${response.status} ${error}`);
  }

  // Webhook returns the message object, but we just need to know it succeeded
  // The webhook URL doesn't include the message ID in a simple way
  return `webhook-${Date.now()}`;
}

async function uploadWithBot(
  message: DiscordMessage,
  botToken: string,
  channelId: string
): Promise<string> {
  const formData = new FormData();
  
  if (message.content && message.content.length <= 2000) {
    formData.append('content', message.content);
  }
  
  if (message.embeds && message.embeds.length > 0) {
    formData.append('embeds', JSON.stringify(message.embeds));
  }
  
  if (message.attachments) {
    for (const attachment of message.attachments) {
      formData.append('files', attachment.file, attachment.filename);
    }
  }

  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${botToken}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Discord bot API failed: ${response.status} ${error}`);
  }

  const result = await response.json();
  return result.id;
}

export async function discordPost(
  content: string,
  media: Media[],
  thread: string[],
  creds: DiscordCreds
): Promise<string> {
  const text = htmlToText(content);
  
  // Build the message
  const message: DiscordMessage = {
    content: text.length <= 2000 ? text : undefined,
    embeds: buildEmbeds(content, media),
  };

  // Post the main message
  let messageId: string;
  if (creds.type === 'webhook') {
    messageId = await uploadWithWebhook(message, creds.webhookUrl);
  } else {
    messageId = await uploadWithBot(message, creds.botToken, creds.channelId);
  }

  // Post thread replies if any
  if (thread.length > 0) {
    // Discord doesn't have native threading in the same way, but we can reply or send follow-ups
    // For webhooks, we just send additional messages
    // For bots, we could use reply references but keeping it simple for now
    for (const threadItem of thread) {
      const threadText = htmlToText(threadItem);
      const threadMessage: DiscordMessage = {
        content: threadText.slice(0, 2000),
      };
      
      if (creds.type === 'webhook') {
        await uploadWithWebhook(threadMessage, creds.webhookUrl);
      } else {
        await uploadWithBot(threadMessage, creds.botToken, creds.channelId);
      }
    }
  }

  return messageId;
}

export async function validateDiscordCreds(creds: DiscordCreds): Promise<boolean> {
  try {
    if (creds.type === 'webhook') {
      // Test webhook by making a simple request
      const response = await fetch(creds.webhookUrl, {
        method: 'GET',
      });
      return response.ok;
    } else {
      // Test bot token by getting the bot's info
      const response = await fetch('https://discord.com/api/v10/users/@me', {
        headers: {
          'Authorization': `Bot ${creds.botToken}`,
        },
      });
      return response.ok;
    }
  } catch {
    return false;
  }
}
