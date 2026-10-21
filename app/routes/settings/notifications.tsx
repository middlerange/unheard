// ABOUTME: Notifications settings page — shows Telegram config status and test button.
// ABOUTME: Lets users verify their Telegram integration is working.

import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ChevronLeft } from "@/components/icons";
import { getTelegramStatus, sendTestNotification } from '@/app/server-fns/telegram';

export const Route = createFileRoute('/settings/notifications')({
  loader: () => getTelegramStatus(),
  component: NotificationsPage,
});

function NotificationsPage() {
  const { configured, auto_publish } = Route.useLoaderData();
  const [autoPublish, setAutoPublish] = useState(auto_publish);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<'ok' | 'error' | null>(null);

  async function handleAutoPublish(value: boolean) {
    setSaving(true);
    setSaveError(false);
    try {
      const response = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_publish: value }),
      });
      if (!response.ok) throw new Error('Save failed');
      setAutoPublish(value);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setSending(true);
    setResult(null);
    try {
      await sendTestNotification();
      setResult('ok');
    } catch {
      setResult('error');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="px-6 py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/settings" className="text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-xl font-semibold">Notifications</h1>
      </div>

      <div className="border border-border rounded-lg bg-card p-4 space-y-2">
        <label className="flex items-center gap-3 text-sm font-medium">
          <input type="checkbox" checked={autoPublish} disabled={saving} onChange={event => handleAutoPublish(event.target.checked)} />
          Auto-publish scheduled posts
        </label>
        <p className="text-xs text-muted-foreground">When enabled for the team owner, due posts publish without Telegram approval. This preference applies to your user account.</p>
        {saveError && <p role="alert" className="text-sm text-red-600">Could not save the publishing preference.</p>}
      </div>

      <div className="border border-border rounded-lg bg-card p-4 space-y-4">
        <div>
          <h2 className="text-sm font-medium">Telegram</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Get a push notification when a post is published.
          </p>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <span className={`w-2 h-2 rounded-full ${configured ? 'bg-green-500' : 'bg-red-500'}`} />
          {configured ? 'Configured' : 'Not configured — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID'}
        </div>

        {configured && (
          <div className="flex items-center gap-3">
            <button
              onClick={handleTest}
              disabled={sending}
              className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Send test'}
            </button>
            {result === 'ok' && <span className="text-sm text-green-600">Sent!</span>}
            {result === 'error' && <span className="text-sm text-red-600">Failed — check server logs</span>}
          </div>
        )}
      </div>
    </div>
  );
}
