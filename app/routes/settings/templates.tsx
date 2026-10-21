// ABOUTME: Templates settings page — displays all available post templates grouped by category.
// ABOUTME: Read-only; templates are managed via the seed script.

import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronLeft } from "@/components/icons";
import { getTemplates } from '@/app/server-fns/templates';
import type { Template } from '@/lib/db/types';

export const Route = createFileRoute('/settings/templates')({
  loader: () => getTemplates(),
  component: TemplatesPage,
});

function TemplatesPage() {
  const templates = Route.useLoaderData();

  const byCategory = templates.reduce<Record<string, Template[]>>((acc, t) => {
    (acc[t.category] ??= []).push(t);
    return acc;
  }, {});

  return (
    <div className="px-6 py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/settings" className="text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-xl font-semibold">Templates</h1>
      </div>

      {templates.length === 0 && (
        <p className="text-sm text-muted-foreground py-8 text-center">No templates available.</p>
      )}

      <div className="space-y-8">
        {Object.entries(byCategory).map(([category, items]) => (
          <div key={category} className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">{category}</h2>
            <div className="space-y-3">
              {items.map(t => (
                <div key={t.id} className="rounded-lg border border-border bg-card p-4 space-y-2">
                  <p className="text-sm font-medium">{t.name}</p>
                  <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-line">{t.content}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
