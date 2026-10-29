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

export const ANTHROPIC_STRICT_SCHEMA_VERSION = 'anthropic-strict-tool-schema-v1';

export function anthropicStrictResearchSchema(schema: Record<string, unknown>) {
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  const scalar = (value: unknown) => value === null || ['string', 'number', 'boolean'].includes(typeof value);
  const types = new Set(['object', 'array', 'string', 'integer', 'number', 'boolean', 'null']);
  const formats = new Set(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid']);
  const reference = (root: Record<string, unknown>, value: unknown) => {
    if (typeof value !== 'string' || !value.startsWith('#/')) throw Error('Strict research schema requires local references');
    const target = value.slice(2).split('/').reduce<unknown>((node, key) => object(node) ? node[key.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined, root);
    if (!object(target)) throw Error('Strict research schema reference is unresolved');
    return target;
  };
  function lower(node: unknown): Record<string, unknown> {
    if (!object(node)) throw Error('Strict research schema requires schema objects');
    const result: Record<string, unknown> = {}, descriptions: string[] = [];
    for (const [key, value] of Object.entries(node)) {
      if (unsupportedConstraints.has(key) && !(key === 'minItems' && (value === 0 || value === 1))) {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw Error('Invalid strict research schema bound');
        descriptions.push(`${key}: ${value}`);
      } else if (['properties', '$defs', 'definitions'].includes(key)) {
        if (!object(value)) throw Error('Strict research schema requires a schema map');
        result[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, lower(child)]));
      } else if (key === 'oneOf') {
        if (!Array.isArray(value) || !value.length || !value.every(object)) throw Error('Invalid strict research schema union');
        const first = value[0];
        const discriminator = object(first.properties) && Object.keys(first.properties).find(name => {
          const tags = value.map(branch => object(branch.properties) ? branch.properties[name] : undefined);
          return tags.every((tag, index) => object(tag) && scalar(tag.const) && Object.hasOwn(tag, 'const')
            && value[index].type === 'object' && Array.isArray(value[index].required) && value[index].required.includes(name))
            && new Set(tags.map(tag => JSON.stringify((tag as Record<string, unknown>).const))).size === value.length;
        });
        if (!discriminator || Object.hasOwn(node, 'anyOf')) throw Error('Strict research schema oneOf must have disjoint required constant tags');
        result.anyOf = value.map(lower);
      } else if (key === 'anyOf' || key === 'allOf') {
        if (!Array.isArray(value) || !value.length || key === 'allOf' && JSON.stringify(value).includes('"$ref"')) throw Error('Unsupported strict research schema union');
        result[key] = value.map(lower);
      } else if (key === 'items') result[key] = lower(value);
      else if (key === '$ref') { reference(schema, value); result[key] = value; }
      else if (key === 'type') {
        if (!(typeof value === 'string' && types.has(value)) && !(Array.isArray(value) && value.length && value.every(type => typeof type === 'string' && types.has(type)))) throw Error('Unsupported strict research schema type');
        result[key] = value;
      } else if (key === 'required') {
        if (!Array.isArray(value) || value.some(name => typeof name !== 'string') || new Set(value).size !== value.length) throw Error('Invalid strict research schema required fields');
        result[key] = value;
      } else if (key === 'additionalProperties') {
        if (value !== false) throw Error('Strict research schema must reject additional properties');
        result[key] = value;
      } else if (key === 'enum' || key === 'const') {
        if (key === 'enum' ? !Array.isArray(value) || !value.length || !value.every(scalar) : !scalar(value)) throw Error('Strict research schema requires scalar constants');
        result[key] = value;
      } else if (key === 'pattern') {
        if (value !== '\\S' && value !== '[^\\s]') throw Error('Unsupported strict research schema pattern');
        result[key] = '[^\\s]';
      } else if (key === 'format') {
        if (typeof value !== 'string' || !formats.has(value)) throw Error('Unsupported strict research schema format');
        result[key] = value;
      } else if (['description', 'title'].includes(key)) {
        if (typeof value !== 'string') throw Error('Invalid strict research schema annotation');
        result[key] = value;
      } else if (key === 'default' || key === 'minItems') result[key] = value;
      else throw Error('Unsupported strict research schema keyword: ' + key);
    }
    if (node.type === 'object' && (!object(node.properties) || node.additionalProperties !== false
      || !Array.isArray(node.required) || node.required.some(name => !Object.hasOwn(node.properties as object, name)))) throw Error('Strict research schema object contract is incomplete');
    if (descriptions.length) result.description = [result.description, ...descriptions].filter(Boolean).join('; ');
    return result;
  }
  const lowered = lower(schema);
  let optionalParameters = 0, unionParameters = 0;
  function count(node: Record<string, unknown>, references: string[] = []) {
    if (typeof node.$ref === 'string') {
      if (references.includes(node.$ref)) throw Error('Recursive strict research schema is unsupported');
      count(reference(lowered, node.$ref), [...references, node.$ref]);
    }
    if (Array.isArray(node.anyOf) || Array.isArray(node.type)) unionParameters++;
    if (object(node.properties)) {
      optionalParameters += Object.keys(node.properties).filter(name => !(node.required as string[]).includes(name)).length;
      for (const child of Object.values(node.properties)) count(child as Record<string, unknown>, references);
    }
    if (object(node.items)) count(node.items, references);
    for (const key of ['anyOf', 'allOf']) if (Array.isArray(node[key])) for (const child of node[key]) count(child, references);
    if (optionalParameters > 24 || unionParameters > 16) throw Error('Strict research schema exceeds provider complexity limits');
  }
  count(lowered);
  return lowered;
}

export type AnthropicResearchMode = 'schema' | 'tool' | 'strict-tool';
export const ANTHROPIC_RESEARCH_TOOL_NAME = 'submit_research';
const sonnet55 = (model?: string) => /^claude-sonnet-5-5(?:-\d{8}|-\d{4}-\d{2}-\d{2})?$/.test(model || '');

export function anthropicResearchRequest(model: string, system: string, data: unknown, schema: Record<string, unknown>, maxTokens: number, mode: AnthropicResearchMode = 'schema') {
  return {
    model, system, messages: [{ role: 'user', content: JSON.stringify(data) }],
    max_tokens: maxTokens, service_tier: 'standard_only', thinking: { type: sonnet55(model) ? 'between_tools' : 'disabled' },
    ...(mode === 'tool' || mode === 'strict-tool' ? {
      tools: [{ name: ANTHROPIC_RESEARCH_TOOL_NAME,
        description: 'Submit the research assessment data for application validation. This tool performs no external action.',
        ...(mode === 'strict-tool' ? { strict: true } : {}), input_schema: mode === 'strict-tool' ? anthropicStrictResearchSchema(schema) : schema }],
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
  if (mode !== 'schema' && sonnet55(model) && result.stop_reason !== 'tool_use') return '';
  if (mode !== 'schema' && result.stop_reason === 'tool_use') {
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
