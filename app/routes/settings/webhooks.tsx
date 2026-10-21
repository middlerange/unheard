// ABOUTME: Webhook settings page — configure outgoing webhooks for integrations
// ABOUTME: Zapier, Make.com, n8n, and custom webhook endpoints

import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, ChevronLeft, Send, Eye, EyeOff } from "@/components/icons";
import { listWebhooks, createWebhook, deleteWebhook, testWebhook, getWebhookDeliveries } from '@/app/server-fns/webhooks';
import { cn } from '@/lib/utils';
import type { Webhook, WebhookDelivery, WebhookEvent } from '@/lib/db/types';

export const Route = createFileRoute('/settings/webhooks')({
  loader: () => listWebhooks(),
  component: WebhookSettings,
});

const WEBHOOK_EVENTS: { id: WebhookEvent; label: string }[] = [
  { id: 'post.created', label: 'Post Created' },
  { id: 'post.scheduled', label: 'Post Scheduled' },
  { id: 'post.published', label: 'Post Published' },
  { id: 'post.failed', label: 'Post Failed' },
  { id: 'post.deleted', label: 'Post Deleted' },
  { id: 'media.uploaded', label: 'Media Uploaded' },
];

function WebhookSettings() {
  const initialWebhooks = Route.useLoaderData();
  const [webhooks, setWebhooks] = useState<Webhook[]>(initialWebhooks);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [deliveries, setDeliveries] = useState<Record<string, WebhookDelivery[]>>({});
  const [loadingDeliveries, setLoadingDeliveries] = useState<string | null>(null);
  
  // Form state
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<WebhookEvent[]>(['post.published']);
  const [customHeaders, setCustomHeaders] = useState('');

  async function refresh() {
    setWebhooks(await listWebhooks());
  }

  function resetForm() {
    setName('');
    setUrl('');
    setSecret('');
    setSelectedEvents(['post.published']);
    setCustomHeaders('');
    setAdding(false);
  }

  async function handleAdd() {
    if (!name.trim() || !url.trim() || !secret.trim()) {
      toast.error('Name, URL, and Secret are required');
      return;
    }

    if (selectedEvents.length === 0) {
      toast.error('Select at least one event');
      return;
    }

    setSaving(true);
    try {
      let headers = {};
      if (customHeaders.trim()) {
        try {
          headers = JSON.parse(customHeaders);
        } catch {
          toast.error('Custom headers must be valid JSON');
          setSaving(false);
          return;
        }
      }

      await createWebhook({
        data: {
          name: name.trim(),
          url: url.trim(),
          secret: secret.trim(),
          events: selectedEvents,
          headers,
        },
      });
      resetForm();
      await refresh();
      toast.success('Webhook created');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create webhook');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteWebhook({ data: { id } });
      await refresh();
      toast.success('Webhook deleted');
    } catch (error) {
      toast.error('Failed to delete webhook');
    }
  }

  async function handleTest(id: string) {
    setTestingId(id);
    try {
      const result = await testWebhook({ data: { id } });
      toast.success(result.success ? 'Test delivered successfully' : 'Test failed - check delivery log');
    } catch (error) {
      toast.error('Test failed');
    } finally {
      setTestingId(null);
    }
  }

  async function loadDeliveries(webhookId: string) {
    setLoadingDeliveries(webhookId);
    try {
      const data = await getWebhookDeliveries({ data: { webhookId } });
      setDeliveries(prev => ({ ...prev, [webhookId]: data }));
    } catch (error) {
      toast.error('Failed to load deliveries');
    } finally {
      setLoadingDeliveries(null);
    }
  }

  return (
    <div className="px-6 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/settings" className="text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold">Webhooks</h1>
            <p className="text-xs text-muted-foreground">Outgoing webhooks for Zapier, Make, n8n, and custom integrations</p>
          </div>
        </div>
        <Button size="sm" className="gap-1.5 text-xs" onClick={() => setAdding(true)} disabled={adding}>
          <Plus className="w-3.5 h-3.5" />
          Add webhook
        </Button>
      </div>

      {adding && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Webhook Name</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Zapier Integration"
              className="text-sm h-8"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Endpoint URL</Label>
            <Input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://hooks.zapier.com/hooks/catch/..."
              className="text-sm h-8"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Secret Key (for HMAC signature)</Label>
            <Input
              value={secret}
              onChange={e => setSecret(e.target.value)}
              placeholder="min 8 characters"
              className="text-sm h-8"
              type="password"
            />
            <p className="text-xs text-muted-foreground">
              Used to sign webhook payloads. Verify with X-Webhook-Signature header.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Events to Subscribe</Label>
            <div className="flex flex-wrap gap-2">
              {WEBHOOK_EVENTS.map(event => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => setSelectedEvents(prev =>
                    prev.includes(event.id) ? prev.filter(e => e !== event.id) : [...prev, event.id]
                  )}
                  className={cn(
                    'px-3 py-1.5 rounded-md border text-xs transition-colors',
                    selectedEvents.includes(event.id) ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {event.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Custom Headers (optional, JSON)</Label>
            <Input
              value={customHeaders}
              onChange={e => setCustomHeaders(e.target.value)}
              placeholder='{"Authorization": "Bearer token"}'
              className="text-sm h-8 font-mono"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button size="sm" className="text-xs h-7" onClick={handleAdd} disabled={saving}>
              {saving ? 'Adding...' : 'Add Webhook'}
            </Button>
            <Button size="sm" variant="ghost" className="text-xs h-7" onClick={resetForm}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {webhooks.length === 0 && !adding && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground mb-2">No webhooks configured yet.</p>
          <p className="text-xs text-muted-foreground">Add webhooks to integrate with Zapier, Make.com, n8n, or custom endpoints.</p>
        </div>
      )}

      {webhooks.map(webhook => (
        <div key={webhook.id} className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">{webhook.name}</h3>
                  <span className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded-full uppercase tracking-wide',
                    webhook.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                    webhook.status === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                  )}>
                    {webhook.status}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate mt-1">{webhook.url}</p>
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs h-7"
                  onClick={() => handleTest(webhook.id)}
                  disabled={testingId === webhook.id}
                >
                  <Send className={cn('w-3.5 h-3.5 mr-1', testingId === webhook.id && 'animate-pulse')} />
                  Test
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs h-7 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(webhook.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>Events: {webhook.events.length}</span>
              <span className="flex items-center gap-1">
                Secret: 
                <button
                  onClick={() => setShowSecret(prev => ({ ...prev, [webhook.id]: !prev[webhook.id] }))}
                  className="inline-flex items-center"
                >
                  {showSecret[webhook.id] ? (
                    <><EyeOff className="w-3 h-3" /> hide</>
                  ) : (
                    <><Eye className="w-3 h-3" /> show</>
                  )}
                </button>
              </span>
              {showSecret[webhook.id] && (
                <span className="font-mono bg-muted px-1 rounded">{webhook.secret}</span>
              )}
            </div>

            <div className="flex flex-wrap gap-1">
              {webhook.events.map(event => (
                <span key={event} className="text-[10px] px-2 py-0.5 bg-muted rounded-full">
                  {WEBHOOK_EVENTS.find(e => e.id === event)?.label || event}
                </span>
              ))}
            </div>

            {deliveries[webhook.id] && (
              <div className="border-t border-border pt-3 mt-3">
                <h4 className="text-xs font-medium mb-2">Recent Deliveries</h4>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {deliveries[webhook.id].map(delivery => (
                    <div key={delivery.id} className="flex items-start gap-2 text-xs p-2 rounded bg-muted/50">
                      <span className={cn(
                        'w-2 h-2 rounded-full mt-0.5',
                        delivery.status === 'delivered' ? 'bg-green-500' :
                        delivery.status === 'failed' ? 'bg-red-500' :
                        'bg-yellow-500'
                      )} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">{delivery.event_type}</p>
                        <p className="text-muted-foreground">
                          {new Date(delivery.created_at).toLocaleString()}
                          {delivery.response_status && ` • HTTP ${delivery.response_status}`}
                        </p>
                        {delivery.status === 'failed' && delivery.response_body && (
                          <p className="text-red-500 mt-1 truncate">{delivery.response_body}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!deliveries[webhook.id] && (
              <Button
                size="sm"
                variant="ghost"
                className="text-xs h-6"
                onClick={() => loadDeliveries(webhook.id)}
                disabled={loadingDeliveries === webhook.id}
              >
                {loadingDeliveries === webhook.id ? 'Loading...' : 'Show delivery log'}
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
