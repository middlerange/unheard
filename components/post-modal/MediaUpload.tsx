// ABOUTME: Media upload component for attaching images and videos to posts.
// ABOUTME: Uploads to /api/upload, stores locally, previews inline.

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ImageIcon, X, Loader2 } from "@/components/icons";
import { cn } from '@/lib/utils';

export interface UploadedMedia {
  id: string;
  filename: string;
  path: string;
  url: string;
  type: 'image' | 'video';
  target_id?: string | null; // null/undefined = shared across all platforms
}

interface MediaUploadProps {
  media: UploadedMedia[];
  onChange: (media: UploadedMedia[]) => void;
}

export function MediaUpload({ media, onChange }: MediaUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(
        Array.from(files).map(async file => {
          const form = new FormData();
          form.append('file', file);
          const res = await fetch('/api/upload', { method: 'POST', body: form });
          if (!res.ok) throw new Error('Upload failed');
          return res.json() as Promise<UploadedMedia>;
        }),
      );
      onChange([...media, ...uploaded]);
    } finally {
      setUploading(false);
    }
  }

  function remove(id: string) {
    onChange(media.filter(m => m.id !== id));
  }

  return (
    <div className="space-y-2">
      {media.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {media.map(m => (
            <div key={m.id} className="relative group w-20 h-20 rounded-md overflow-hidden border border-input">
              {m.type === 'image' ? (
                <img src={m.url} alt={m.filename} className="w-full h-full object-cover" />
              ) : (
                <video src={m.url} className="w-full h-full object-cover" />
              )}
              <button
                onClick={() => remove(m.id)}
                className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-background/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-xs gap-1.5"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
        {uploading ? 'Uploading...' : 'Add media'}
      </Button>
    </div>
  );
}
