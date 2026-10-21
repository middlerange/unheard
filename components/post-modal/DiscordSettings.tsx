// ABOUTME: Discord-specific settings component for the post editor.
// ABOUTME: Currently minimal as Discord doesn't have many per-post settings.

'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

interface DiscordSettingsProps {
  threadName?: string;
  onChange: (patch: { threadName?: string }) => void;
}

export function DiscordSettings({ threadName, onChange }: DiscordSettingsProps) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-3">
      <div className="space-y-2">
        <Label htmlFor="discord-thread" className="text-xs text-muted-foreground">
          Thread Name (optional)
        </Label>
        <Input
          id="discord-thread"
          value={threadName || ''}
          onChange={(e) => onChange({ threadName: e.target.value })}
          placeholder="Create a thread with this name"
          className="text-xs h-8"
        />
        <p className="text-[10px] text-muted-foreground">
          If provided, your post will create a thread in the channel.
        </p>
      </div>
    </div>
  );
}
