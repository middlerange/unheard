// ABOUTME: Brand voices settings page — manage brand profiles with name and writing prompt.
// ABOUTME: Compact table list with a Sheet drawer for create/edit.

import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Plus, Trash2, ChevronLeft, Star, Pencil } from "@/components/icons";
import { getBrands, createBrand, updateBrand, deleteBrand, setDefaultBrand } from '@/app/server-fns/brands';
import type { BrandProfile } from '@/lib/db/types';

export const Route = createFileRoute('/settings/brands')({
  loader: () => getBrands(),
  component: BrandSettings,
});

type Editing = null | { mode: 'create' } | { mode: 'edit'; brand: BrandProfile };

function BrandSettings() {
  const initial = Route.useLoaderData();
  const [brands, setBrands] = useState<BrandProfile[]>(initial);
  const [editing, setEditing] = useState<Editing>(null);
  const [draft, setDraft] = useState({ name: '', writing_prompt: '' });
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setBrands(await getBrands());
  }

  function openCreate() {
    setDraft({ name: '', writing_prompt: '' });
    setEditing({ mode: 'create' });
  }

  function openEdit(brand: BrandProfile) {
    setDraft({ name: brand.name, writing_prompt: brand.writing_prompt ?? '' });
    setEditing({ mode: 'edit', brand });
  }

  function closeDrawer() {
    setEditing(null);
  }

  async function handleSave() {
    if (!draft.name.trim()) return;
    setSaving(true);
    try {
      if (editing?.mode === 'create') {
        await createBrand({ data: { name: draft.name, writing_prompt: draft.writing_prompt, voice: '', audience: '' } });
      } else if (editing?.mode === 'edit') {
        await updateBrand({ data: { id: editing.brand.id, name: draft.name, writing_prompt: draft.writing_prompt, voice: '', audience: '' } });
      }
      closeDrawer();
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (editing?.mode !== 'edit') return;
    await deleteBrand({ data: { id: editing.brand.id } });
    closeDrawer();
    await refresh();
  }

  async function handleSetDefault() {
    if (editing?.mode !== 'edit') return;
    await setDefaultBrand({ data: { id: editing.brand.id } });
    closeDrawer();
    await refresh();
  }

  return (
    <div className="px-6 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/settings"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <h1 className="text-xl font-semibold">Brand Voices</h1>
        </div>
        <Button size="sm" className="gap-1.5 text-xs" onClick={openCreate}>
          <Plus className="w-3.5 h-3.5" />
          Add brand
        </Button>
      </div>

      {brands.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No brand voices yet.</p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left font-medium text-muted-foreground px-4 py-2.5 w-[160px]">Name</th>
                <th className="text-left font-medium text-muted-foreground px-4 py-2.5">Writing Prompt</th>
                <th className="px-4 py-2.5 w-[80px]" />
              </tr>
            </thead>
            <tbody>
              {brands.map(brand => (
                <tr
                  key={brand.id}
                  className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => openEdit(brand)}
                >
                  <td className="px-4 py-2.5 font-medium">
                    <div className="flex items-center gap-2">
                      {brand.name}
                      {brand.is_default && (
                        <span className="text-[11px] text-yellow-600 bg-yellow-500/10 px-1.5 py-0.5 rounded flex items-center gap-1">
                          <Star className="w-3 h-3 fill-yellow-500 text-yellow-500" />
                          Default
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground truncate max-w-0">
                    {brand.writing_prompt || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                      onClick={e => { e.stopPropagation(); openEdit(brand); }}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Sheet open={editing !== null} onOpenChange={v => !v && closeDrawer()}>
        <SheetContent className="w-[400px] max-w-[95vw] p-0 gap-0 flex flex-col">
          <SheetHeader className="px-5 py-4 border-b border-border pr-12">
            <SheetTitle>
              {editing?.mode === 'create' ? 'New Brand Voice' : 'Edit Brand Voice'}
            </SheetTitle>
          </SheetHeader>

          <div className="flex flex-col gap-4 p-5 overflow-y-auto flex-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input
                value={draft.name}
                onChange={e => setDraft(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Personal, Company"
                className="text-sm h-8"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Writing prompt</Label>
              <Textarea
                value={draft.writing_prompt}
                onChange={e => setDraft(p => ({ ...p, writing_prompt: e.target.value }))}
                placeholder="Describe the writing style, tone, and guidelines for AI..."
                rows={6}
                className="text-sm resize-none"
              />
            </div>
          </div>

          <div className="px-5 py-4 border-t border-border flex items-center justify-between">
            <div className="flex gap-2">
              <Button size="sm" className="text-xs h-7" onClick={handleSave} disabled={saving || !draft.name.trim()}>
                {editing?.mode === 'create' ? 'Create' : 'Save'}
              </Button>
              <Button size="sm" variant="ghost" className="text-xs h-7" onClick={closeDrawer}>
                Cancel
              </Button>
              {editing?.mode === 'edit' && !editing.brand.is_default && (
                <Button size="sm" variant="ghost" className="text-xs h-7 gap-1 text-muted-foreground" onClick={handleSetDefault}>
                  <Star className="w-3 h-3" />
                  Set as default
                </Button>
              )}
              {editing?.mode === 'edit' && editing.brand.is_default && (
                <span className="text-xs text-yellow-600 flex items-center gap-1">
                  <Star className="w-3 h-3 fill-yellow-500 text-yellow-500" />
                  Default
                </span>
              )}
            </div>
            {editing?.mode === 'edit' && (
              <Button
                size="sm"
                variant="ghost"
                className="text-xs h-7 text-muted-foreground hover:text-destructive"
                onClick={handleDelete}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
