// ABOUTME: Main App component for the Content Hub Chrome extension side panel.
// ABOUTME: Orchestrates page context capture, prompt/template selection, AI generation, and copy.

import { useState, useEffect, useCallback, useRef } from 'react';
import { Sparkles, Globe, Copy, Check, RotateCcw, ChevronDown } from 'lucide-react';
import { templates, type WritingTemplate } from './lib/templates';
import { writingPrompts, DEFAULT_FREE_FORM_ID } from './lib/prompts';
import { generateContent, getCurrentTabContext } from './lib/api';

interface PageContext {
  url: string;
  title: string;
  description: string;
  selectedText: string;
  mainContent: string;
}

export function App() {
  const [pageContext, setPageContext] = useState<PageContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(true);
  const [selectedPromptId, setSelectedPromptId] = useState(DEFAULT_FREE_FORM_ID);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [command, setCommand] = useState('');
  const [freeFormPrompt, setFreeFormPrompt] = useState('');
  const [result, setResult] = useState('');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [showPageContext, setShowPageContext] = useState(false);

  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getCurrentTabContext().then((ctx) => {
      setPageContext(ctx);
      setLoadingContext(false);
    }).catch(() => setLoadingContext(false));
  }, []);

  const selectedPrompt = writingPrompts.find((p) => p.id === selectedPromptId);
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
  const isFreeForm = selectedPromptId === DEFAULT_FREE_FORM_ID;

  const buildPrompt = useCallback((): string => {
    const parts: string[] = [];

    if (selectedPrompt && !isFreeForm) {
      parts.push(`Writing style:\n${selectedPrompt.content}`);
    }

    if (pageContext?.mainContent) {
      parts.push(`Page context:\nTitle: ${pageContext.title}\nURL: ${pageContext.url}\n${pageContext.description ? `Description: ${pageContext.description}\n` : ''}Content:\n${pageContext.mainContent}`);
    } else if (pageContext?.url) {
      parts.push(`Page: ${pageContext.title}\nURL: ${pageContext.url}`);
    }

    if (pageContext?.selectedText) {
      parts.push(`Selected text from page:\n${pageContext.selectedText}`);
    }

    if (selectedTemplate) {
      parts.push(`Use this template structure:\n${selectedTemplate.content}`);
    }

    if (isFreeForm && freeFormPrompt.trim()) {
      parts.push(freeFormPrompt.trim());
    }

    if (command.trim()) {
      parts.push(`Additional instructions: ${command.trim()}`);
    }

    return parts.join('\n\n');
  }, [selectedPrompt, isFreeForm, pageContext, selectedTemplate, freeFormPrompt, command]);

  const handleGenerate = useCallback(async () => {
    const prompt = buildPrompt();
    if (!prompt) {
      setError('Enter a prompt or select a template to get started.');
      return;
    }

    setError('');
    setGenerating(true);
    setResult('');
    setCopied(false);

    try {
      const stream = await generateContent({
        prompt,
        pageContext: pageContext?.mainContent ?? '',
        tone: 'engaging',
      });

      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let fullResult = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullResult += decoder.decode(value, { stream: true });
        setResult(fullResult);
        if (resultRef.current) {
          resultRef.current.scrollTop = resultRef.current.scrollHeight;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }, [buildPrompt, pageContext]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [result]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !generating) {
      e.preventDefault();
      handleGenerate();
    }
  }, [handleGenerate, generating]);

  return (
    <div className="flex flex-col h-screen" onKeyDown={handleKeyDown}>
      <Header />

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <PageContextCard
          context={pageContext}
          loading={loadingContext}
          expanded={showPageContext}
          onToggle={() => setShowPageContext(!showPageContext)}
        />

        <PromptSelector
          selectedId={selectedPromptId}
          onChange={setSelectedPromptId}
          prompts={writingPrompts}
        />

        {isFreeForm && (
          <FreeFormInput value={freeFormPrompt} onChange={setFreeFormPrompt} />
        )}

        <TemplateSelector
          selectedId={selectedTemplateId}
          onChange={setSelectedTemplateId}
          templates={templates}
        />

        <CommandInput value={command} onChange={setCommand} />

        <button
          onClick={handleGenerate}
          disabled={generating}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm transition-colors"
        >
          {generating ? (
            <>
              <Sparkles className="w-4 h-4 animate-pulse" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Generate Reply
              <span className="text-indigo-300 text-xs ml-1">⌘↵</span>
            </>
          )}
        </button>

        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {result && (
          <GeneratedReply
            content={result}
            copied={copied}
            onCopy={handleCopy}
            onRegenerate={handleGenerate}
            generating={generating}
            ref={resultRef}
          />
        )}
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800 bg-zinc-900/50 shrink-0">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-indigo-400" />
        <span className="font-semibold text-sm">Content Hub</span>
      </div>
    </div>
  );
}

function PageContextCard({
  context,
  loading,
  expanded,
  onToggle,
}: {
  context: PageContext | null;
  loading: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-zinc-800/50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Globe className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          {loading ? (
            <span className="text-xs text-zinc-500">Loading page context...</span>
          ) : context ? (
            <span className="text-xs text-zinc-400 truncate">{context.title}</span>
          ) : (
            <span className="text-xs text-zinc-500">No page context available</span>
          )}
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && context && (
        <div className="px-3 pb-2 space-y-1.5">
          <div className="text-xs text-zinc-500 truncate">{context.url}</div>
          {context.description && <div className="text-xs text-zinc-400">{context.description}</div>}
          {context.selectedText && (
            <div className="text-xs text-indigo-400/70 border-l-2 border-indigo-500/30 pl-2 py-0.5">
              Selection: &ldquo;{context.selectedText.slice(0, 200)}
              {context.selectedText.length > 200 ? '...' : ''}&rdquo;
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PromptSelector({
  selectedId,
  onChange,
  prompts,
}: {
  selectedId: string;
  onChange: (id: string) => void;
  prompts: { id: string; name: string; description: string }[];
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-zinc-400">Writing Style</label>
      <select
        value={selectedId}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2.5 py-2 rounded-md bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500 appearance-none cursor-pointer"
      >
        <option value={DEFAULT_FREE_FORM_ID}>Free Form (no preset style)</option>
        {prompts.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} — {p.description.slice(0, 60)}...
          </option>
        ))}
      </select>
    </div>
  );
}

function FreeFormInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-zinc-400">What do you want to write?</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Describe the reply you want to generate..."
        rows={3}
        className="w-full px-2.5 py-2 rounded-md bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 resize-none"
      />
    </div>
  );
}

function TemplateSelector({
  selectedId,
  onChange,
  templates,
}: {
  selectedId: string;
  onChange: (id: string) => void;
  templates: WritingTemplate[];
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-zinc-400">Template (optional)</label>
      <select
        value={selectedId}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2.5 py-2 rounded-md bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500 appearance-none cursor-pointer"
      >
        <option value="">No template — free structure</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.id}: {t.name} ({t.type})
          </option>
        ))}
      </select>
    </div>
  );
}

function CommandInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-zinc-400">
        Commands to fine-tune
        <span className="text-zinc-600 ml-1">&mdash; e.g. &ldquo;make it shorter&rdquo;, &ldquo;more professional&rdquo;</span>
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Add instructions to refine the output..."
        className="w-full px-2.5 py-2 rounded-md bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
      />
    </div>
  );
}

function GeneratedReply({
  content,
  copied,
  onCopy,
  onRegenerate,
  generating,
  ref,
}: {
  content: string;
  copied: boolean;
  onCopy: () => void;
  onRegenerate: () => void;
  generating: boolean;
  ref: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="space-y-2">
      <div
        ref={ref}
        className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-300 whitespace-pre-wrap max-h-96 overflow-y-auto leading-relaxed"
      >
        {content}
        {generating && (
          <span className="inline-block w-2 h-4 bg-indigo-400 animate-pulse ml-0.5 align-text-bottom" />
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={onCopy}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-medium text-zinc-300 transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-green-400" />
              Copied
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              Copy to Clipboard
            </>
          )}
        </button>
        <button
          onClick={onRegenerate}
          disabled={generating}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-medium text-zinc-300 transition-colors disabled:opacity-50"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
