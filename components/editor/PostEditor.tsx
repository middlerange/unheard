// ABOUTME: TipTap-based rich text editor for composing social media posts.
// ABOUTME: Shows character count, formatting toolbar, and per-platform limits.

'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import { useEffect } from 'react';
import { cn } from '@/lib/utils';
import { normalizeEditorContent } from '@/lib/text';

interface PostEditorProps {
  content: string;
  onChange: (html: string) => void;
  maxChars: number;
  placeholder?: string;
  className?: string;
}

export function PostEditor({ content, onChange, maxChars, placeholder = 'Write your post...', className }: PostEditorProps) {
  const normalizedContent = normalizeEditorContent(content);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, code: false, blockquote: false, horizontalRule: false }),
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer' } }),
      Placeholder.configure({ placeholder }),
      CharacterCount,
    ],
    content: normalizedContent,
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: { class: 'tiptap post-copy max-w-none focus:outline-none px-4 py-3 min-h-[100px] h-full w-full outline-none' },
    },
  });

  useEffect(() => {
    if (editor && editor.getHTML() !== normalizedContent) {
      editor.commands.setContent(normalizedContent, { emitUpdate: false });
    }
  }, [editor, normalizedContent]);

  if (!editor) return null;

  const chars = editor.storage.characterCount.characters() as number;
  const pct = chars / maxChars;
  const overLimit = chars > maxChars;

  return (
    <div className={cn('flex flex-col border border-border rounded-xl bg-card overflow-hidden transition-shadow focus-within:ring-1 focus-within:ring-ring focus-within:border-primary/50 relative', className)}>
      <EditorContent editor={editor} className="flex-1 w-full" />
      <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-background/50 backdrop-blur-sm rounded text-[10px] font-medium z-10 pointer-events-none">
        <span className={cn('tabular-nums', overLimit ? 'text-destructive' : pct > 0.85 ? 'text-yellow-500' : 'text-muted-foreground')}>
          {chars} / {maxChars}
        </span>
      </div>
    </div>
  );
}
