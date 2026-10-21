// ABOUTME: Templates Library server functions (Issue #11)
// ABOUTME: Pre-built and custom templates for common startup marketing posts

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/schema';
import { requireAuth } from '@/app/server-fns/auth';
import type { TemplateCategory, PostTemplateLibrary } from '@/lib/db/types';
import { getTemplatesLibrary, insertTemplateLibrary as insertTemplate, deleteTemplateLibrary as dbDeleteTemplate, updateTemplateLibrary as updateTemplate, incrementTemplateUsage } from '@/lib/db/queries';
import { generateContent } from '@/lib/ai';

// Built-in templates that are available to all teams
export const BUILT_IN_TEMPLATES: PostTemplateLibrary[] = [
  {
    id: 'builtin-product-launch',
    team_id: 'builtin',
    name: 'Product Launch',
    category: 'launch',
    description: 'Announce a new product or major release',
    content_template: `🚀 Introducing {{product_name}}!

{{product_description}}

✨ Key features:
{{features}}

🔗 Try it now: {{link}}

#ProductLaunch #{{product_tag}} #Startup`,
    platform_variants: {
      twitter: '🚀 Introducing {{product_name}}!\n\n{{product_description}}\n\n{{link}}',
      linkedin: '🚀 New Product Alert\n\nI\'m excited to announce {{product_name}}!\n\n{{product_description}}\n\nKey features:\n{{features}}\n\n{{link}}',
    },
    ai_prompt: 'Write a product launch announcement for {{product_name}}. It helps {{target_audience}} solve {{problem}}. Key features: {{features}}. Keep it exciting and professional.',
    is_favorite: false,
    usage_count: 0,
    created_at: Date.now(),
    updated_at: Date.now(),
  },
  {
    id: 'builtin-feature-release',
    team_id: 'builtin',
    name: 'Feature Release',
    category: 'feature',
    description: 'Announce a new feature or improvement',
    content_template: `✨ New Feature: {{feature_name}}

{{feature_description}}

🎯 Why it matters:
{{benefits}}

👉 Learn more: {{link}}`,
    platform_variants: {},
    ai_prompt: 'Write a feature announcement for {{feature_name}} that {{feature_action}}. Explain the benefits for {{target_user}}.',
    is_favorite: false,
    usage_count: 0,
    created_at: Date.now(),
    updated_at: Date.now(),
  },
  {
    id: 'builtin-testimonial',
    team_id: 'builtin',
    name: 'Customer Testimonial',
    category: 'testimonial',
    description: 'Share customer success stories',
    content_template: `💬 "{{quote}}"

— {{customer_name}}, {{customer_title}} at {{company}}

{{context}}

{{link}}`,
    platform_variants: {
      twitter: '💬 "{{quote}}"\n\n— {{customer_name}}\n\n{{link}}',
    },
    ai_prompt: 'Format this customer testimonial: "{{quote}}" from {{customer_name}}, {{customer_title}} at {{company}}. Add brief context about their success.',
    is_favorite: false,
    usage_count: 0,
    created_at: Date.now(),
    updated_at: Date.now(),
  },
  {
    id: 'builtin-milestone',
    team_id: 'builtin',
    name: 'Milestone Celebration',
    category: 'milestone',
    description: 'Celebrate achievements and milestones',
    content_template: `🎯 Milestone Unlocked: {{milestone}}

{{description}}

🙏 Thank you to everyone who made this possible!

{{link}}`,
    platform_variants: {},
    ai_prompt: 'Write a milestone celebration post for achieving {{milestone}}. Be grateful and forward-looking.',
    is_favorite: false,
    usage_count: 0,
    created_at: Date.now(),
    updated_at: Date.now(),
  },
  {
    id: 'builtin-tutorial',
    team_id: 'builtin',
    name: 'Quick Tutorial',
    category: 'tutorial',
    description: 'Share tips, tricks, or how-to content',
    content_template: `📚 Quick Tip: {{tip_title}}

{{tip_content}}

1️⃣ {{step_1}}
2️⃣ {{step_2}}
3️⃣ {{step_3}}

Full guide: {{link}}

#Tutorial #HowTo`,
    platform_variants: {},
    ai_prompt: 'Write a quick tutorial about {{topic}} in 3 simple steps. Make it actionable and easy to follow.',
    is_favorite: false,
    usage_count: 0,
    created_at: Date.now(),
    updated_at: Date.now(),
  },
  {
    id: 'builtin-engagement',
    team_id: 'builtin',
    name: 'Poll / Question',
    category: 'engagement',
    description: 'Ask engaging questions to your audience',
    content_template: `🤔 {{question}}

{{context}}

Let me know in the comments! 👇`,
    platform_variants: {},
    ai_prompt: 'Write an engaging question about {{topic}} to spark discussion. Add brief context.',
    is_favorite: false,
    usage_count: 0,
    created_at: Date.now(),
    updated_at: Date.now(),
  },
  {
    id: 'builtin-behind-scenes',
    team_id: 'builtin',
    name: 'Behind the Scenes',
    category: 'other',
    description: 'Share team or process insights',
    content_template: `🔍 Behind the Scenes

{{content}}

#StartupLife #BuildingInPublic`,
    platform_variants: {},
    ai_prompt: 'Write a behind-the-scenes post about {{topic}}. Be authentic and personal.',
    is_favorite: false,
    usage_count: 0,
    created_at: Date.now(),
    updated_at: Date.now(),
  },
  {
    id: 'builtin-ama',
    team_id: 'builtin',
    name: 'AMA Announcement',
    category: 'engagement',
    description: 'Host an Ask Me Anything session',
    content_template: `❓ AMA Alert!

I'm hosting an AMA about {{topic}} on {{platform}} at {{time}}.

Drop your questions below! 👇`,
    platform_variants: {},
    ai_prompt: 'Write an AMA announcement for {{topic}} on {{platform}}. Be inviting and clear about the time.',
    is_favorite: false,
    usage_count: 0,
    created_at: Date.now(),
    updated_at: Date.now(),
  },
  {
    id: 'builtin-newsletter',
    team_id: 'builtin',
    name: 'Newsletter Signup',
    category: 'other',
    description: 'Promote your newsletter',
    content_template: `📬 Want more {{topic}} insights?

I write a weekly newsletter covering:
{{topics}}

Join {{subscriber_count}}+ readers:
{{signup_link}}`,
    platform_variants: {},
    ai_prompt: 'Write a newsletter promotion for {{topic}}. Mention the frequency and key topics covered.',
    is_favorite: false,
    usage_count: 0,
    created_at: Date.now(),
    updated_at: Date.now(),
  },
];

// Input validation
const createTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  category: z.enum(['launch', 'feature', 'testimonial', 'milestone', 'tutorial', 'engagement', 'other']),
  description: z.string().max(200).optional(),
  contentTemplate: z.string().min(1).max(2000),
  aiPrompt: z.string().max(500).optional(),
});

// List templates
export const listTemplatesLibrary = createServerFn({ method: 'GET' })
  .handler(async () => {
    const user = await requireAuth();
    const db = await getDb();
    
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      return BUILT_IN_TEMPLATES;
    }
    
    const customTemplates = await getTemplatesLibrary(membership[0].teamId);
    return [...BUILT_IN_TEMPLATES, ...customTemplates];
  });

// Create custom template
export const createTemplate = createServerFn({ method: 'POST' })
  .inputValidator(createTemplateSchema)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const db = await getDb();
    
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      throw new Error('User not associated with a team');
    }
    
    const id = await insertTemplate({
      team_id: membership[0].teamId,
      name: data.name,
      category: data.category as TemplateCategory,
      description: data.description || null,
      content_template: data.contentTemplate,
      platform_variants: {},
      ai_prompt: data.aiPrompt || null,
      is_favorite: false,
      usage_count: 0,
    });
    
    return { id, message: 'Template created successfully' };
  });

// Delete template
export const deleteTemplate = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const db = await getDb();
    
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      throw new Error('Not authorized');
    }
    
    await dbDeleteTemplate(data.id, membership[0].teamId);
    return { message: 'Template deleted' };
  });

// Toggle favorite
export const toggleTemplateFavorite = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string(), isFavorite: z.boolean() }))
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const db = await getDb();
    
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      throw new Error('Not authorized');
    }
    
    await updateTemplate(data.id, membership[0].teamId, { is_favorite: data.isFavorite });
    return { message: 'Favorite status updated' };
  });

// Apply template (with optional AI fill)
export const applyTemplate = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ 
    id: z.string(),
    variables: z.record(z.string(), z.string()).optional(),
    useAI: z.boolean().optional(),
  }))
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const db = await getDb();
    
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      throw new Error('Not authorized');
    }
    
    // Find template
    let template = BUILT_IN_TEMPLATES.find(t => t.id === data.id);
    
    if (!template) {
      const customTemplates = await getTemplatesLibrary(membership[0].teamId);
      template = customTemplates.find(t => t.id === data.id);
    }
    
    if (!template) {
      throw new Error('Template not found');
    }
    
    // Increment usage count
    if (!template.id.startsWith('builtin-')) {
      await incrementTemplateUsage(template.id);
    }
    
    let content = template.content_template;
    
    // If AI fill requested and template has AI prompt
    if (data.useAI && template.ai_prompt) {
      try {
        // Combine template AI prompt with user variables
        const aiContext = { ...data.variables };
        const filledPrompt = template.ai_prompt.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
          return aiContext[key] || match;
        });
        
        // Generate content using AI
        const generated = await generateContent(filledPrompt, 'twitter', 'professional', 'gpt-5');
        
        content = await new Response(generated).text();
      } catch (error) {
        // Fall back to regular template if AI fails
        console.error('AI generation failed:', error);
      }
    }
    
    // Fill in variables if provided
    if (data.variables) {
      content = content.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
        return data.variables?.[key] || match;
      });
    }
    
    // Create an idea from the template
    const ideaId = crypto.randomUUID();
    await db.insert(schema.ideas).values({
      id: ideaId,
      team_id: membership[0].teamId,
      text: content,
      status: 'open',
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    
    return { 
      ideaId, 
      content,
      message: 'Template applied successfully',
    };
  });

// Export for use in UI
