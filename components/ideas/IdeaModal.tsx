// ABOUTME: Drawer for creating and editing ideas with a single text field.
// ABOUTME: Used on the /ideas page for CRUD operations.

'use client';

import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { createIdea, updateIdea } from '@/app/server-fns/ideas';
import type { Idea } from '@/lib/db/types';

interface IdeaModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  existing?: Idea;
}

export function IdeaModal({ open, onClose, onSaved, existing }: IdeaModalProps) {
  const [text, setText] = useState(existing?.text ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!text.trim()) return;
    setSaving(true);
    try {
      if (existing) {
        await updateIdea({ data: { id: existing.id, text } });
      } else {
        await createIdea({ data: { text } });
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-[400px] max-w-[95vw] p-0 gap-0 flex flex-col">
        <SheetHeader className="px-5 py-4 border-b border-border pr-12">
          <SheetTitle>{existing ? 'Edit Idea' : 'New Idea'}</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-4 p-5 overflow-y-auto flex-1">
          <Textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="What's your idea?"
            rows={8}
            className="resize-none"
            autoFocus
          />
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border bg-[var(--color-bg-subtle)]">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !text.trim()}>Save</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
