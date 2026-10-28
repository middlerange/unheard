import type { ModelUsage } from './research-pricing';

const unsupportedConstraints = new Set(['minimum', 'maximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems']);

// Claude supports a subset of JSON Schema; the callers still validate the full schema.
export function anthropicResearchSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(anthropicResearchSchema);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  const descriptions: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (unsupportedConstraints.has(key)) descriptions.push(`${key}: ${child}`);
    else if (key === 'properties') result[key] = Object.fromEntries(Object.entries(child as Record<string, unknown>).map(([name, schema]) => [name, anthropicResearchSchema(schema)]));
    else if (key === 'enum' || key === 'const') result[key] = child;
    else result[key] = anthropicResearchSchema(child);
  }
  if (descriptions.length) result.description = [result.description, ...descriptions].filter(Boolean).join('; ');
  return result;
}

export type AnthropicResearchMode = 'schema' | 'tool';
export const ANTHROPIC_RESEARCH_TOOL_NAME = 'submit_research';
const sonnet55 = (model?: string) => /^claude-sonnet-5-5(?:-\d{8}|-\d{4}-\d{2}-\d{2})?$/.test(model || '');

export function anthropicResearchRequest(model: string, system: string, data: unknown, schema: Record<string, unknown>, maxTokens: number, mode: AnthropicResearchMode = 'schema') {
  return {
    model, system, messages: [{ role: 'user', content: JSON.stringify(data) }],
    max_tokens: maxTokens, service_tier: 'standard_only', thinking: { type: sonnet55(model) ? 'between_tools' : 'disabled' },
    ...(mode === 'tool' ? {
      tools: [{ name: ANTHROPIC_RESEARCH_TOOL_NAME,
        description: 'Submit the research assessment data for application validation. This tool performs no external action.', input_schema: schema }],
      tool_choice: sonnet55(model) ? { type: 'auto', disable_parallel_tool_use: true }
        : { type: 'tool', name: ANTHROPIC_RESEARCH_TOOL_NAME, disable_parallel_tool_use: true },
    } : { output_config: { format: { type: 'json_schema', schema: anthropicResearchSchema(schema) } } }),
  };
}

export type AnthropicResearchResponse = {
  id?: string;
  model?: string;
  stop_reason?: string;
  content?: Array<{ type: string; text?: string; name?: string; input?: unknown }>;
  usage?: ModelUsage & { service_tier?: string };
};

export function anthropicResearchOutput(result: AnthropicResearchResponse, mode: AnthropicResearchMode = 'schema', model?: string) {
  if (mode === 'tool' && sonnet55(model) && result.stop_reason !== 'tool_use') return '';
  if (mode === 'tool' && result.stop_reason === 'tool_use') {
    const content = result.content || [];
    const blocks = sonnet55(model) ? content.filter(block => block.type === 'tool_use') : content;
    const block = blocks[0];
    if (sonnet55(model) && content.some(block => !['tool_use', 'text', 'thinking', 'redacted_thinking'].includes(block.type))) return '';
    if (blocks.length !== 1 || block?.type !== 'tool_use' || block.name !== ANTHROPIC_RESEARCH_TOOL_NAME
      || !block.input || typeof block.input !== 'object' || Array.isArray(block.input)) return '';
    return JSON.stringify(block.input);
  }
  if (result.content?.some(item => item.type === 'tool_use')) return '';
  return result.content?.filter(item => item.type === 'text').map(item => item.text || '').join('') || '';
}
