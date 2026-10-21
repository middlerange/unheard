// ABOUTME: Floating AI assistant panel for generating and improving post content.
// ABOUTME: Supports OpenAI GPT-5 and Google Gemini Flash with streamed output, brand profiles, and templates.

'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Sparkles, RefreshCw, Check } from "@/components/icons";
import { cn } from '@/lib/utils';
import type { AIModel } from '@/lib/ai';
import { getBrands } from '@/app/server-fns/brands';
import { getTemplates } from '@/app/server-fns/templates';
import type { BrandProfile, Template } from '@/lib/db/types';
import type { PlatformId } from '@/lib/platforms';

interface AIPanelProps {
  platform: PlatformId;
  existingContent?: string;
  initialPrompt?: string;
  onUse: (content: string) => void;
  className?: string;
}

const TONES = ['engaging', 'professional', 'casual', 'witty', 'inspirational', 'informative'];

export function AIPanel({ platform, existingContent, initialPrompt, onUse, className }: AIPanelProps) {
  const [prompt, setPrompt] = useState(initialPrompt ?? '');
  const [tone, setTone] = useState('engaging');
  const [model, setModel] = useState<AIModel>('gpt-5');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [brands, setBrands] = useState<BrandProfile[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [brandProfileId, setBrandProfileId] = useState('none');
  const [templateId, setTemplateId] = useState('none');

  useEffect(() => {
    getBrands().then(setBrands).catch(() => {});
    getTemplates().then(setTemplates).catch(() => {});
  }, []);

  async function generate() {
    if (!prompt.trim()) return;
    setLoading(true);
    setResult('');

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          platform,
          tone,
          model,
          existingContent,
          brandProfileId: brandProfileId === 'none' ? undefined : brandProfileId,
          templateId: templateId === 'none' ? undefined : templateId,
        }),
      });

      if (!res.ok || !res.body) throw new Error('Generation failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setResult(text);
      }
    } catch (err) {
      setResult('Error generating content. Check your API keys.');
    } finally {
      setLoading(false);
    }
  }

  const groupedTemplates = templates.reduce<Record<string, Template[]>>((acc, t) => {
    (acc[t.category] ??= []).push(t);
    return acc;
  }, {});

  return (
    <div className={cn("flex flex-col gap-3 p-4 border border-input rounded-xl bg-card shadow-sm ring-1 ring-[var(--color-ring-elevated)]", className)}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="w-4 h-4 text-yellow-400" />
        AI Assistant
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Prompt</Label>
        <Textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder={`What should I write about? (for ${platform})`}
          className="resize-none text-sm"
          rows={3}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate(); }}
        />
      </div>

      <div className="flex gap-2">
        <div className="flex-1 space-y-1">
          <Label className="text-xs text-muted-foreground">Tone</Label>
          <Select value={tone} onValueChange={setTone}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TONES.map(t => (
                <SelectItem key={t} value={t} className="text-xs capitalize">{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 space-y-1">
          <Label className="text-xs text-muted-foreground">Model</Label>
          <Select value={model} onValueChange={v => setModel(v as AIModel)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="gpt-5" className="text-xs">GPT-5</SelectItem>
              <SelectItem value="gemini-flash" className="text-xs">Gemini Flash</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {brands.length > 0 && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Brand Profile</Label>
          <Select value={brandProfileId} onValueChange={setBrandProfileId}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Default voice" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-xs text-muted-foreground">Default voice</SelectItem>
              {brands.map(b => (
                <SelectItem key={b.id} value={b.id} className="text-xs">{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {templates.length > 0 && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Template</Label>
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="No template" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-xs text-muted-foreground">No template</SelectItem>
              {Object.entries(groupedTemplates).map(([category, items]) => (
                <div key={category}>
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {category}
                  </div>
                  {items.map(t => (
                    <SelectItem key={t.id} value={t.id} className="text-xs pl-4">{t.name}</SelectItem>
                  ))}
                </div>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <Button size="sm" onClick={generate} disabled={loading || !prompt.trim()}>
        {loading ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
        {loading ? 'Generating...' : 'Generate'}
      </Button>

      {result && (
        <div className="space-y-2">
          <div className="text-xs bg-[var(--color-bg-subtle)] rounded-lg p-3 whitespace-pre-wrap leading-relaxed border border-border">{result}</div>
          <div className="flex gap-2">
            <Button size="sm" variant="default" className="flex-1" onClick={() => onUse(result)}>
              <Check className="w-3.5 h-3.5 mr-1.5" />
              Use this
            </Button>
            <Button size="sm" variant="outline" onClick={generate} disabled={loading}>
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
