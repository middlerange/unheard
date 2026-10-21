// ABOUTME: Twitter-specific post settings — controls who can reply.
// ABOUTME: Ported from postiz-app x.provider.tsx settings panel.

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Twitter } from "@/components/icons";

interface TwitterSettingsProps {
  replySettings: string;
  onChange: (value: string) => void;
}

const REPLY_OPTIONS = [
  { value: 'everyone', label: 'Everyone can reply' },
  { value: 'following', label: 'Followers only' },
  { value: 'mentionedUsers', label: 'Mentioned only' },
  { value: 'subscribers', label: 'Subscribers only' },
];

export function TwitterSettings({ replySettings, onChange }: TwitterSettingsProps) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-input">
      <Twitter className="w-4 h-4 text-[#1d9bf0] flex-shrink-0" />
      <div className="flex items-center gap-2 flex-1">
        <Label className="text-xs text-muted-foreground whitespace-nowrap">Who can reply</Label>
        <Select value={replySettings} onValueChange={onChange}>
          <SelectTrigger className="h-7 text-xs flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REPLY_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
