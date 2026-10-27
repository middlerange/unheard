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

export function anthropicResearchRequest(model: string, system: string, data: unknown, schema: Record<string, unknown>, maxTokens: number) {
  return {
    model, system, messages: [{ role: 'user', content: JSON.stringify(data) }],
    max_tokens: maxTokens, service_tier: 'standard_only', thinking: { type: 'disabled' },
    output_config: { format: { type: 'json_schema', schema: anthropicResearchSchema(schema) } },
  };
}

export type AnthropicResearchResponse = {
  id?: string;
  model?: string;
  stop_reason?: string;
  content?: Array<{ type: string; text?: string }>;
  usage?: ModelUsage & { service_tier?: string };
};

export function anthropicResearchOutput(result: AnthropicResearchResponse) {
  return result.content?.filter(item => item.type === 'text').map(item => item.text || '').join('') || '';
}
