// ABOUTME: Renders a thread editor: main post + sequential reply/comment blocks.
// ABOUTME: Handles add, remove, and reorder of thread items.

'use client';

import { Plus, Trash2, ChevronUp, ChevronDown } from "@/components/icons";
import { Button } from '@/components/ui/button';
import { PostEditor } from '@/components/editor/PostEditor';
import { cn } from '@/lib/utils';

interface ThreadEditorProps {
  content: string;
  thread: string[];
  onChange: (content: string) => void;
  onThreadChange: (thread: string[]) => void;
  maxChars: number;
  platform?: string;
}

export function ThreadEditor({ content, thread, onChange, onThreadChange, maxChars, platform }: ThreadEditorProps) {
  function addItem() {
    onThreadChange([...thread, '']);
  }

  function removeItem(index: number) {
    onThreadChange(thread.filter((_, i) => i !== index));
  }

  function moveItem(index: number, direction: 'up' | 'down') {
    const next = [...thread];
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    onThreadChange(next);
  }

  function updateItem(index: number, value: string) {
    const next = [...thread];
    next[index] = value;
    onThreadChange(next);
  }

  const label = platform === 'linkedin' ? 'Add comment' : 'Add to thread';

  return (
    <div className="space-y-0">
      <PostEditor
        content={content}
        onChange={onChange}
        maxChars={maxChars}
        className="min-h-[140px]"
      />

      {thread.map((item, i) => (
        <div key={i} className="flex gap-2 mt-1">
          <div className="flex flex-col items-center pt-1">
            <div className="w-px flex-1 bg-border" />
          </div>
          <div className="flex-1 space-y-1">
            <div className={cn('flex items-center gap-1 pt-2 pb-1', 'text-xs text-muted-foreground')}>
              <span>{platform === 'linkedin' ? `Comment ${i + 1}` : `Reply ${i + 1}`}</span>
              <div className="ml-auto flex items-center gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => moveItem(i, 'up')}
                  disabled={i === 0}
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => moveItem(i, 'down')}
                  disabled={i === thread.length - 1}
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                  onClick={() => removeItem(i)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            <PostEditor
              content={item}
              onChange={v => updateItem(i, v)}
              maxChars={maxChars}
              placeholder={platform === 'linkedin' ? 'Add a comment...' : 'Continue the thread...'}
              className="min-h-[100px]"
            />
          </div>
        </div>
      ))}

      <div className="pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-xs gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={addItem}
        >
          <Plus className="w-3.5 h-3.5" />
          {label}
        </Button>
      </div>
    </div>
  );
}
