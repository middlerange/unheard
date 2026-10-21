// ABOUTME: Webhook Integration server functions (Issue #8)
// ABOUTME: Manage webhooks, deliver events with HMAC signatures and retries

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { eq, and, desc, asc, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/schema';
import { requireAuth } from './auth';
import type { Webhook, WebhookDelivery, WebhookEvent } from '@/lib/db/types';

// Webhook event types
const WEBHOOK_EVENTS = [
  'post.created',
  'post.scheduled',
  'post.published',
  'post.failed',
  'post.deleted',
  'media.uploaded',
] as const;

// Input validation
const createWebhookSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  secret: z.string().min(8).optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  headers: z.record(z.string(), z.string()).optional(),
});

const updateWebhookSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  url: z.string().url().optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).optional(),
  status: z.enum(['active', 'paused', 'error']).optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

// Generate HMAC signature
async function generateSignature(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate webhook secret
function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Calculate retry delay with exponential backoff
function getRetryDelay(attemptCount: number): number {
  // Exponential backoff: 1min, 5min, 15min, 30min, 1hour
  const delays = [60, 300, 900, 1800, 3600];
  const delay = delays[Math.min(attemptCount, delays.length - 1)];
  return delay * 1000; // Convert to milliseconds
}

// Create webhook
export const createWebhook = createServerFn({ method: 'POST' })
  .inputValidator(createWebhookSchema)
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
    const now = Date.now();
    const webhookId = crypto.randomUUID();
    const secret = data.secret ?? generateSecret();
    
    await db.insert(schema.webhooks).values({
      id: webhookId,
      team_id: teamId,
      name: data.name,
      url: data.url,
      secret,
      events: JSON.stringify(data.events),
      status: 'active',
      headers: JSON.stringify(data.headers || {}),
      created_at: now,
      updated_at: now,
    });
    
    return {
      id: webhookId,
      secret, // Only returned once at creation
      message: 'Webhook created successfully',
    };
  });

// List webhooks
export const listWebhooks = createServerFn({ method: 'GET' })
  .handler(async (): Promise<Webhook[]> => {
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
    
    const webhooks = await db
      .select({
        id: schema.webhooks.id,
        team_id: schema.webhooks.team_id,
        name: schema.webhooks.name,
        url: schema.webhooks.url,
        events: schema.webhooks.events,
        status: schema.webhooks.status,
        headers: schema.webhooks.headers,
        created_at: schema.webhooks.created_at,
        updated_at: schema.webhooks.updated_at,
      })
      .from(schema.webhooks)
      .where(eq(schema.webhooks.team_id, membership[0].teamId))
      .orderBy(desc(schema.webhooks.created_at));
    
    return webhooks.map(wh => ({
      ...wh,
      status: wh.status as Webhook['status'],
      events: JSON.parse(wh.events),
      headers: JSON.parse(wh.headers ?? '{}'),
      secret: undefined, // Never return secret
    }));
  });

// Update webhook
export const updateWebhook = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string(), data: updateWebhookSchema }))
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const db = await getDb();
    
    // Verify ownership
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      throw new Error('Not authorized');
    }
    
    const updates: any = {
      updated_at: Date.now(),
    };
    const next = data.data;
    
    if (next.name !== undefined) updates.name = next.name;
    if (next.url !== undefined) updates.url = next.url;
    if (next.events !== undefined) updates.events = JSON.stringify(next.events);
    if (next.status !== undefined) updates.status = next.status;
    if (next.headers !== undefined) updates.headers = JSON.stringify(next.headers);
    
    await db
      .update(schema.webhooks)
      .set(updates)
      .where(and(
        eq(schema.webhooks.id, data.id),
        eq(schema.webhooks.team_id, membership[0].teamId)
      ));
    
    return { message: 'Webhook updated successfully' };
  });

// Delete webhook
export const deleteWebhook = createServerFn({ method: 'POST' })
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
      .delete(schema.webhooks)
      .where(and(
        eq(schema.webhooks.id, data.id),
        eq(schema.webhooks.team_id, membership[0].teamId)
      ));
    
    return { message: 'Webhook deleted successfully' };
  });

// Get webhook delivery history
export const getWebhookDeliveries = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ webhookId: z.string() }))
  .handler(async ({ data }): Promise<WebhookDelivery[]> => {
    const user = await requireAuth();
    const db = await getDb();
    
    // Verify ownership
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      throw new Error('Not authorized');
    }
    
    // Verify webhook belongs to user's team
    const webhook = await db
      .select({ id: schema.webhooks.id })
      .from(schema.webhooks)
      .where(and(
        eq(schema.webhooks.id, data.webhookId),
        eq(schema.webhooks.team_id, membership[0].teamId)
      ))
      .limit(1);
    
    if (webhook.length === 0) {
      throw new Error('Webhook not found');
    }
    
    const deliveries = await db
      .select()
      .from(schema.webhook_deliveries)
      .where(eq(schema.webhook_deliveries.webhook_id, data.webhookId))
      .orderBy(desc(schema.webhook_deliveries.created_at))
      .limit(50);
    
    return deliveries.map(delivery => ({
      ...delivery,
      event_type: delivery.event_type as WebhookDelivery['event_type'],
      status: delivery.status as WebhookDelivery['status'],
    }));
  });

// Deliver webhook event (internal function)
export async function deliverWebhookEvent(
  webhookId: string,
  eventType: WebhookEvent,
  payload: Record<string, unknown>
): Promise<void> {
  const db = await getDb();
  
  const webhook = await db
    .select()
    .from(schema.webhooks)
    .where(and(
      eq(schema.webhooks.id, webhookId),
      eq(schema.webhooks.status, 'active')
    ))
    .limit(1);
  
  if (webhook.length === 0) return;
  
  const wh = webhook[0];
  const events = JSON.parse(wh.events) as WebhookEvent[];
  
  // Check if webhook subscribes to this event
  if (!events.includes(eventType)) return;
  
  // Prepare payload
  const payloadStr = JSON.stringify({
    event: eventType,
    timestamp: Date.now(),
    data: payload,
  });
  
  // Generate signature
  const signature = await generateSignature(payloadStr, wh.secret);
  
  // Create delivery record
  const deliveryId = crypto.randomUUID();
  await db.insert(schema.webhook_deliveries).values({
    id: deliveryId,
    webhook_id: webhookId,
    event_type: eventType,
    payload: payloadStr,
    signature,
    status: 'pending',
    attempt_count: 0,
    created_at: Date.now(),
  });
}

// Process pending webhook deliveries (called by cron job)
export const processWebhookDeliveries = createServerFn({ method: 'POST' })
  .handler(async () => {
    const db = await getDb();
    const now = Date.now();
    
    // Get pending deliveries ready for retry
    const pending = await db
      .select()
      .from(schema.webhook_deliveries)
      .where(and(
        eq(schema.webhook_deliveries.status, 'pending'),
        sql`(${schema.webhook_deliveries.next_retry_at} IS NULL OR ${schema.webhook_deliveries.next_retry_at} <= ${now})`
      ))
      .limit(100);
    
    const results = [];
    
    for (const delivery of pending) {
      const webhook = await db
        .select()
        .from(schema.webhooks)
        .where(eq(schema.webhooks.id, delivery.webhook_id))
        .limit(1);
      
      if (webhook.length === 0) {
        // Webhook deleted, mark delivery as failed
        await db
          .update(schema.webhook_deliveries)
          .set({ status: 'failed', delivered_at: now })
          .where(eq(schema.webhook_deliveries.id, delivery.id));
        continue;
      }
      
      const wh = webhook[0];
      const headers = JSON.parse(wh.headers || '{}') as Record<string, string>;
      
      try {
        const response = await fetch(wh.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': delivery.signature,
            'X-Webhook-Event': delivery.event_type,
            'X-Webhook-ID': delivery.id,
            ...headers,
          },
          body: delivery.payload,
        });
        
        const responseBody = await response.text();
        
        if (response.ok) {
          // Success!
          await db
            .update(schema.webhook_deliveries)
            .set({
              status: 'delivered',
              response_status: response.status,
              response_body: responseBody,
              delivered_at: now,
              attempt_count: delivery.attempt_count + 1,
            })
            .where(eq(schema.webhook_deliveries.id, delivery.id));
          
          results.push({ deliveryId: delivery.id, status: 'delivered' });
        } else {
          // Failed but will retry
          const newAttemptCount = delivery.attempt_count + 1;
          const maxAttempts = 5;
          
          if (newAttemptCount >= maxAttempts) {
            await db
              .update(schema.webhook_deliveries)
              .set({
                status: 'failed',
                response_status: response.status,
                response_body: responseBody,
                attempt_count: newAttemptCount,
                delivered_at: now,
              })
              .where(eq(schema.webhook_deliveries.id, delivery.id));
            
            // Update webhook status to error
            await db
              .update(schema.webhooks)
              .set({ status: 'error', updated_at: now })
              .where(eq(schema.webhooks.id, wh.id));
            
            results.push({ deliveryId: delivery.id, status: 'failed' });
          } else {
            const nextRetry = now + getRetryDelay(newAttemptCount);
            await db
              .update(schema.webhook_deliveries)
              .set({
                attempt_count: newAttemptCount,
                next_retry_at: nextRetry,
                response_status: response.status,
                response_body: responseBody,
              })
              .where(eq(schema.webhook_deliveries.id, delivery.id));
            
            results.push({ deliveryId: delivery.id, status: 'retrying', nextRetry });
          }
        }
      } catch (error) {
        // Network error - schedule retry
        const newAttemptCount = delivery.attempt_count + 1;
        const maxAttempts = 5;
        
        if (newAttemptCount >= maxAttempts) {
          await db
            .update(schema.webhook_deliveries)
              .set({
                status: 'failed',
                response_body: (error as Error).message,
                attempt_count: newAttemptCount,
                delivered_at: now,
              })
            .where(eq(schema.webhook_deliveries.id, delivery.id));
          
          // Update webhook status to error
          await db
            .update(schema.webhooks)
            .set({ status: 'error', updated_at: now })
            .where(eq(schema.webhooks.id, wh.id));
          
          results.push({ deliveryId: delivery.id, status: 'failed', error: (error as Error).message });
        } else {
          const nextRetry = now + getRetryDelay(newAttemptCount);
          await db
            .update(schema.webhook_deliveries)
            .set({
              attempt_count: newAttemptCount,
              next_retry_at: nextRetry,
              response_body: (error as Error).message,
            })
            .where(eq(schema.webhook_deliveries.id, delivery.id));
          
          results.push({ deliveryId: delivery.id, status: 'retrying', nextRetry, error: (error as Error).message });
        }
      }
    }
    
    return { processed: pending.length, results };
  });

// Test webhook endpoint
export const testWebhook = createServerFn({ method: 'POST' })
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
    
    const webhook = await db
      .select()
      .from(schema.webhooks)
      .where(and(
        eq(schema.webhooks.id, data.id),
        eq(schema.webhooks.team_id, membership[0].teamId)
      ))
      .limit(1);
    
    if (webhook.length === 0) {
      throw new Error('Webhook not found');
    }
    
    const wh = webhook[0];
    const headers = JSON.parse(wh.headers || '{}') as Record<string, string>;
    
    // Send test event
    const testPayload = JSON.stringify({
      event: 'webhook.test',
      timestamp: Date.now(),
      data: { message: 'This is a test event from your Unheard deployment' },
    });
    
    const signature = await generateSignature(testPayload, wh.secret);
    
    try {
      const response = await fetch(wh.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event': 'webhook.test',
          ...headers,
        },
        body: testPayload,
      });
      
      const body = await response.text();
      
      return {
        success: response.ok,
        status: response.status,
        body: body.slice(0, 1000), // Limit response size
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  });
