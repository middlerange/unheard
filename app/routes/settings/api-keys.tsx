// ABOUTME: Settings page for creating and revoking team API keys for external agents.
// ABOUTME: Raw API keys are displayed once immediately after creation.

import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { ChevronLeft, Copy, KeyRound, Plus, Trash2 } from "@/components/icons";
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { createApiKey, getApiKeys, revokeApiKeyFn } from '@/app/server-fns/api-keys';
import type { ApiKeyView } from '@/lib/db/types';

export const Route = createFileRoute('/settings/api-keys')({
  loader: () => getApiKeys(),
  component: ApiKeysSettings,
});

function formatDate(value: number | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

function ApiKeysSettings() {
  const initialKeys = Route.useLoaderData();
  const [keys, setKeys] = useState<ApiKeyView[]>(initialKeys);
  const [name, setName] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function refresh() {
    setKeys(await getApiKeys());
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setIsCreating(true);
    try {
      const result = await createApiKey({ data: { name } });
      setNewKey(result.key);
      setName('');
      await refresh();
      toast.success('API key created');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create API key');
    } finally {
      setIsCreating(false);
    }
  }

  async function handleCopy(value: string) {
    await navigator.clipboard.writeText(value);
    toast.success('Copied');
  }

  async function handleRevoke(id: string) {
    if (!confirm('Revoke this API key? Agents using it will stop working.')) return;
    setRevokingId(id);
    try {
      await revokeApiKeyFn({ data: { id } });
      await refresh();
      toast.success('API key revoked');
    } catch {
      toast.error('Failed to revoke API key');
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="w-full px-6 py-6 space-y-6">
      <div className="flex items-center gap-2">
        <Link to="/settings" className="text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-semibold">API Keys</h1>
      </div>

      {newKey && (
        <Card className="border-[var(--color-positive)]">
          <CardHeader>
            <CardTitle className="text-base">New API key</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input value={newKey} readOnly className="font-mono text-xs" />
              <Button type="button" variant="outline" onClick={() => handleCopy(newKey)} className="gap-2">
                <Copy className="w-4 h-4" />
                Copy
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              This key is shown once. Store it in your agent or integration secret manager.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create API Key</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="flex items-end gap-3">
            <div className="space-y-2 flex-1">
              <Label htmlFor="api-key-name">Name</Label>
              <Input
                id="api-key-name"
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder="Production agent"
                maxLength={80}
              />
            </div>
            <Button type="submit" disabled={isCreating || !name.trim()} className="gap-2">
              <Plus className="w-4 h-4" />
              {isCreating ? 'Creating...' : 'Create'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {keys.map(apiKey => {
          const revoked = !!apiKey.revoked_at;
          return (
            <Card key={apiKey.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-[var(--color-brand)]">
                      <KeyRound className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{apiKey.name}</p>
                        <Badge variant={revoked ? 'secondary' : 'default'}>
                          {revoked ? 'Revoked' : 'Active'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono">{apiKey.key_prefix}...</p>
                      <p className="text-xs text-muted-foreground">
                        Last used: {formatDate(apiKey.last_used_at)}
                      </p>
                    </div>
                  </div>
                  {!revoked && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRevoke(apiKey.id)}
                      disabled={revokingId === apiKey.id}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
