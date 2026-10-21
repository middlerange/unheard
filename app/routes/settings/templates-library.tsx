// ABOUTME: Templates Library settings page — manage reusable post templates (Issue #11)
// ABOUTME: Pre-built templates for common startup marketing posts with AI integration

import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Trash2, ChevronLeft, Copy, Sparkles, Heart } from "@/components/icons";
import { cn } from '@/lib/utils';
import type { PostTemplateLibrary, TemplateCategory } from '@/lib/db/types';
import { 
  listTemplatesLibrary, 
  createTemplate, 
  deleteTemplate, 
  toggleTemplateFavorite,
  applyTemplate,
  BUILT_IN_TEMPLATES 
} from '@/app/server-fns/templates-library';

export const Route = createFileRoute('/settings/templates-library')({
  loader: () => listTemplatesLibrary(),
  component: TemplatesLibrarySettings,
});

const CATEGORIES: { id: TemplateCategory | 'all'; label: string; icon: string }[] = [
  { id: 'all', label: 'All Templates', icon: '📁' },
  { id: 'launch', label: 'Product Launch', icon: '🚀' },
  { id: 'feature', label: 'Feature Release', icon: '✨' },
  { id: 'testimonial', label: 'Testimonial', icon: '💬' },
  { id: 'milestone', label: 'Milestone', icon: '🎯' },
  { id: 'tutorial', label: 'Tutorial', icon: '📚' },
  { id: 'engagement', label: 'Engagement', icon: '🤝' },
  { id: 'other', label: 'Other', icon: '📝' },
];

function TemplatesLibrarySettings() {
  const initialTemplates = Route.useLoaderData();
  const [templates, setTemplates] = useState<PostTemplateLibrary[]>(initialTemplates);
  const [activeCategory, setActiveCategory] = useState<TemplateCategory | 'all'>('all');
  const [isCreating, setIsCreating] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [isFavoriting, setIsFavoriting] = useState<string | null>(null);
  
  // Form state for creating new template
  const [newTemplate, setNewTemplate] = useState({
    name: '',
    category: 'other' as TemplateCategory,
    description: '',
    contentTemplate: '',
    aiPrompt: '',
  });

  async function refresh() {
    setTemplates(await listTemplatesLibrary());
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTemplate.name.trim() || !newTemplate.contentTemplate.trim()) {
      toast.error('Name and content template are required');
      return;
    }
    
    try {
      await createTemplate({
        data: {
          name: newTemplate.name,
          category: newTemplate.category,
          description: newTemplate.description,
          contentTemplate: newTemplate.contentTemplate,
          aiPrompt: newTemplate.aiPrompt || undefined,
        },
      });
      setIsCreating(false);
      setNewTemplate({ name: '', category: 'other', description: '', contentTemplate: '', aiPrompt: '' });
      toast.success('Template created successfully');
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create template');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this template?')) return;
    
    setIsDeleting(id);
    try {
      await deleteTemplate({ data: { id } });
      toast.success('Template deleted');
      await refresh();
    } catch {
      toast.error('Failed to delete template');
    } finally {
      setIsDeleting(null);
    }
  };

  const handleFavorite = async (id: string, isFavorite: boolean) => {
    setIsFavoriting(id);
    try {
      await toggleTemplateFavorite({ data: { id, isFavorite } });
      await refresh();
    } finally {
      setIsFavoriting(null);
    }
  };

  const handleApply = async (id: string) => {
    setIsApplying(true);
    try {
      await applyTemplate({ data: { id } });
      toast.success('Template applied! Go to Ideas to see the generated content.');
    } catch {
      toast.error('Failed to apply template');
    } finally {
      setIsApplying(false);
    }
  };

  const filteredTemplates = activeCategory === 'all' 
    ? templates 
    : templates.filter((t: PostTemplateLibrary) => t.category === activeCategory);

  const displayedTemplates = [...BUILT_IN_TEMPLATES, ...filteredTemplates];

  return (
    <div className="w-full px-6 py-6">
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <Link to="/settings" className="text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-semibold">Templates Library</h1>
      </div>

      <p className="text-muted-foreground mb-6">
        Pre-built templates for common posts. Use AI to fill them with your context, or create your own.
      </p>

      {/* Category Tabs */}
      <Tabs value={activeCategory} onValueChange={(v) => setActiveCategory(v as TemplateCategory | 'all')}>
        <TabsList className="mb-6 flex-wrap h-auto">
          {CATEGORIES.map((cat) => (
            <TabsTrigger key={cat.id} value={cat.id} className="gap-1">
              <span>{cat.icon}</span>
              <span className="hidden sm:inline">{cat.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={activeCategory} className="mt-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {displayedTemplates.map((template: any) => (
              <Card key={template.id} className={cn(
                'transition-all hover:shadow-md',
                template.is_favorite && 'border-yellow-400/50'
              )}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">
                        {CATEGORIES.find(c => c.id === template.category)?.icon || '📝'}
                      </span>
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          {template.name}
                          {template.id.startsWith('builtin-') && (
                            <Badge variant="secondary" className="text-[10px]">Built-in</Badge>
                          )}
                        </CardTitle>
                        <CardDescription className="text-xs">
                          {CATEGORIES.find(c => c.id === template.category)?.label}
                          {template.usage_count > 0 && ` • Used ${template.usage_count} times`}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {!template.id.startsWith('builtin-') && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleFavorite(template.id, !template.is_favorite)}
                          disabled={isFavoriting === template.id}
                        >
                          <Heart className={cn(
                            'w-4 h-4',
                            template.is_favorite && 'fill-yellow-400 text-yellow-400'
                          )} />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => handleDelete(template.id)}
                        disabled={template.id.startsWith('builtin-') || isDeleting === template.id}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {template.description && (
                    <p className="text-sm text-muted-foreground mb-3">
                      {template.description}
                    </p>
                  )}
                  
                  <div className="bg-muted rounded-md p-3 text-sm font-mono text-muted-foreground mb-3 max-h-24 overflow-y-auto">
                    {template.content_template}
                  </div>

                  {template.ai_prompt && (
                    <div className="flex items-center gap-1 text-xs text-purple-600 mb-3">
                      <Sparkles className="w-3 h-3" />
                      <span>AI-powered</span>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button 
                      size="sm" 
                      className="flex-1 gap-1"
                      onClick={() => handleApply(template.id)}
                      disabled={isApplying}
                    >
                      <Copy className="w-3 h-3" />
                      Use Template
                    </Button>
                    {template.ai_prompt && (
                      <Button 
                        size="sm" 
                        variant="outline"
                        className="gap-1"
                        onClick={() => handleApply(template.id)}
                        disabled={isApplying}
                      >
                        <Sparkles className="w-3 h-3" />
                        AI Fill
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Create Template Form */}
      {isCreating ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Create Custom Template</CardTitle>
            <CardDescription>
              Create your own reusable template with placeholders.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Template Name</Label>
                  <Input
                    id="name"
                    value={newTemplate.name}
                    onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                    placeholder="Product Hunt Launch"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <Select value={newTemplate.category} onValueChange={value => setNewTemplate({ ...newTemplate, category: value as TemplateCategory })}>
                    <SelectTrigger id="category" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.filter(c => c.id !== 'all').map(cat => (
                        <SelectItem key={cat.id} value={cat.id}>{cat.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description (optional)</Label>
                <Input
                  id="description"
                  value={newTemplate.description}
                  onChange={(e) => setNewTemplate({ ...newTemplate, description: e.target.value })}
                  placeholder="Use this template when launching on Product Hunt"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="content">Content Template</Label>
                <textarea
                  id="content"
                  value={newTemplate.contentTemplate}
                  onChange={(e) => setNewTemplate({ ...newTemplate, contentTemplate: e.target.value })}
                  className="w-full min-h-[120px] rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                  placeholder="🚀 Launching {{product_name}} on @ProductHunt today!\n\n{{product_description}}\n\nCheck it out: {{link}}"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Use {'{{variable_name}}'} for placeholders that will be filled in later.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="aiPrompt">AI Prompt (optional)</Label>
                <textarea
                  id="aiPrompt"
                  value={newTemplate.aiPrompt}
                  onChange={(e) => setNewTemplate({ ...newTemplate, aiPrompt: e.target.value })}
                  className="w-full min-h-[60px] rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                  placeholder="Generate a Product Hunt launch post for a {{product_type}} that helps {{target_audience}} with {{problem_solved}}"
                />
                <p className="text-xs text-muted-foreground">
                  If provided, AI will use this prompt to auto-fill the template based on context.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setIsCreating(false)}>
                  Cancel
                </Button>
                <Button type="submit">
                  Create Template
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Button onClick={() => setIsCreating(true)} className="mt-6 gap-2">
          <Plus className="w-4 h-4" />
          Create Custom Template
        </Button>
      )}
    </div>
  );
}
