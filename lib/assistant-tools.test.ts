// ABOUTME: Tests for shared post suggestion generation used by assistant chat and idea rewrites.
// ABOUTME: Covers free-form, auto-suggest, and specific-template generation modes.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePostSuggestions } from './assistant-tools';

const mocks = vi.hoisted(() => ({
  createCompletion: vi.fn(),
  listTemplates: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class {
    chat = {
      completions: {
        create: mocks.createCompletion,
      },
    };
  },
}));

vi.mock('@/lib/db/queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db/queries')>('@/lib/db/queries');
  return {
    ...actual,
    listTemplates: mocks.listTemplates,
  };
});

describe('generatePostSuggestions', () => {
  beforeEach(() => {
    mocks.createCompletion.mockReset();
    mocks.listTemplates.mockReset();
  });

  it('returns multiple free-form suggestions without loading templates', async () => {
    mocks.createCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              suggestions: [
                { templateName: 'Free-form', content: 'Draft one', thread: [] },
                { templateName: 'Free-form', content: 'Draft two', thread: [] },
              ],
            }),
          },
        },
      ],
    });

    const result = await generatePostSuggestions({
      content: 'Ship better product updates',
      brand: null,
      teamId: 'team-1',
      templateId: 'freeform',
      writingPrompt: 'Make it crisp',
    });

    expect(result).toEqual({
      suggestions: [
        { templateName: 'Free-form', content: 'Draft one', thread: [] },
        { templateName: 'Free-form', content: 'Draft two', thread: [] },
      ],
    });
    expect(mocks.listTemplates).not.toHaveBeenCalled();
    expect(mocks.createCompletion).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('No template structure'),
        }),
        expect.objectContaining({ role: 'user', content: 'Ship better product updates' }),
      ],
    }));
    expect(mocks.createCompletion.mock.calls[0]?.[0]?.messages?.[0]?.content).toContain('Additional writing instructions: Make it crisp');
  });

  it('uses all templates in auto-suggest mode', async () => {
    mocks.listTemplates.mockResolvedValue([
      { id: 'template-1', name: 'Story', category: 'story', content: 'Template 1' },
      { id: 'template-2', name: 'List', category: 'list', content: 'Template 2' },
    ]);
    mocks.createCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              suggestions: [
                { templateId: 'template-1', templateName: 'Story', content: 'Story draft', thread: [] },
                { templateId: 'template-2', templateName: 'List', content: 'List draft', thread: [] },
              ],
            }),
          },
        },
      ],
    });

    const result = await generatePostSuggestions({
      content: 'Why agent runtimes matter',
      brand: null,
      teamId: 'team-1',
      templateId: 'auto',
    });

    expect(result.suggestions).toHaveLength(2);
    expect(mocks.listTemplates).toHaveBeenCalledWith('team-1');
    expect(mocks.createCompletion.mock.calls[0]?.[0]?.messages?.[0]?.content).toContain('Pick the 2-3 templates that best fit');
    expect(mocks.createCompletion.mock.calls[0]?.[0]?.messages?.[0]?.content).toContain('id:template-1');
    expect(mocks.createCompletion.mock.calls[0]?.[0]?.messages?.[0]?.content).toContain('id:template-2');
  });

  it('limits generation to the selected template', async () => {
    mocks.listTemplates.mockResolvedValue([
      { id: 'template-1', name: 'Story', category: 'story', content: 'Template 1' },
      { id: 'template-2', name: 'List', category: 'list', content: 'Template 2' },
    ]);
    mocks.createCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              suggestions: [
                { templateId: 'template-2', templateName: 'List', content: 'List draft', thread: [] },
              ],
            }),
          },
        },
      ],
    });

    const result = await generatePostSuggestions({
      content: 'Why agent runtimes matter',
      brand: null,
      teamId: 'team-1',
      templateId: 'template-2',
    });

    expect(result).toEqual({
      suggestions: [
        { templateId: 'template-2', templateName: 'List', content: 'List draft', thread: [] },
      ],
    });
    expect(mocks.createCompletion.mock.calls[0]?.[0]?.messages?.[0]?.content).toContain('Use the provided template and write one draft post.');
    expect(mocks.createCompletion.mock.calls[0]?.[0]?.messages?.[0]?.content).toContain('id:template-2');
    expect(mocks.createCompletion.mock.calls[0]?.[0]?.messages?.[0]?.content).not.toContain('id:template-1');
  });
});
