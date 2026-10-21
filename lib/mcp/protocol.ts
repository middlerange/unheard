// ABOUTME: Builds the stateless MCP tool server for the hosted Unheard endpoint.
// ABOUTME: Exposes Unheard content and calendar operations as scoped agent tools.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export const MCP_PROTOCOL_VERSION = '2025-11-25';
export const SUPPORTED_MCP_PROTOCOL_VERSIONS = new Set([
  '2025-03-26',
  '2025-06-18',
  MCP_PROTOCOL_VERSION,
]);

export type McpScope = 'read' | 'write';

type AgentResource = {
  resource: string;
  slug: string;
  title: string;
  description: string;
  actions: readonly string[];
};

export const AGENT_RESOURCES: readonly AgentResource[] = [
  {
    resource: 'posts',
    slug: 'content_calendar',
    title: 'Content calendar',
    description: 'Read and manage Unheard social content and calendar entries. List accepts input.states; get, schedule, requestApproval, and delete require input.id. Create and update accept targets, media, state, publish_at, and channel metadata. Update is a full replacement of targets and media. requestApproval sends the exact saved snapshot to the configured approver and publishes only after approval.',
    actions: ['list', 'get', 'create', 'update', 'schedule', 'requestApproval', 'delete'],
  },
  { resource: 'ideas', slug: 'ideas', title: 'Ideas', description: 'Manage content ideas.', actions: ['list', 'get', 'create', 'update', 'delete', 'setStatus'] },
  { resource: 'brands', slug: 'brands', title: 'Brand voices', description: 'Manage brand voice profiles.', actions: ['list', 'get', 'create', 'update', 'delete', 'setDefault'] },
  { resource: 'channels', slug: 'channels', title: 'Channels', description: 'Manage connected publishing channels.', actions: ['list', 'get', 'create', 'update', 'delete', 'setDefault'] },
  { resource: 'templates', slug: 'templates', title: 'Templates', description: 'Manage team content templates.', actions: ['list', 'get', 'create', 'update', 'delete'] },
  { resource: 'templateLibrary', slug: 'template_library', title: 'Template library', description: 'Manage reusable template-library entries.', actions: ['list', 'get', 'create', 'update', 'delete'] },
  { resource: 'rssFeeds', slug: 'rss_feeds', title: 'RSS feeds', description: 'Manage automated RSS sources.', actions: ['list', 'get', 'create', 'update', 'delete'] },
  { resource: 'webhooks', slug: 'webhooks', title: 'Webhooks', description: 'Manage outbound webhooks.', actions: ['list', 'get', 'create', 'update', 'delete'] },
  { resource: 'bestTimePredictions', slug: 'best_time_predictions', title: 'Best-time predictions', description: 'Read predicted publishing times.', actions: ['list'] },
  { resource: 'teamMembers', slug: 'team_members', title: 'Team members', description: 'Read team membership.', actions: ['list'] },
  { resource: 'postComments', slug: 'post_comments', title: 'Post comments', description: 'Read collaboration comments for a content-calendar post.', actions: ['list'] },
  { resource: 'postApprovals', slug: 'post_approvals', title: 'Post approvals', description: 'Read the latest approval state for a content-calendar post.', actions: ['get'] },
  { resource: 'telegramChannels', slug: 'telegram_channels', title: 'Telegram channels', description: 'Manage Telegram approval channels.', actions: ['list', 'create', 'delete'] },
] as const;

export const READ_ACTIONS = new Set(['list', 'get']);
export const DESTRUCTIVE_ACTIONS = new Set(['delete']);

export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean };
};

type ToolBinding = {
  tool: McpTool;
  resource?: string;
  actions?: string[];
  kind: 'capabilities' | 'resource';
};

export type AgentInvocation = {
  resource: string;
  action: string;
  input: Record<string, unknown>;
};

export type McpRequestContext = {
  scopes: McpScope[];
  capabilities: () => Promise<unknown>;
  invoke: (invocation: AgentInvocation) => Promise<unknown>;
};

function actionSchema(actions: string[]) {
  return {
    type: 'object',
    properties: {
      action: { type: 'string', enum: actions },
      input: {
        type: 'object',
        description: 'Parameters accepted by the selected action.',
        additionalProperties: true,
      },
    },
    required: ['action'],
    additionalProperties: false,
  };
}

function bindingsForScopes(scopes: McpScope[]): ToolBinding[] {
  const canWrite = scopes.includes('write');
  const bindings: ToolBinding[] = [
    {
      kind: 'capabilities',
      tool: {
        name: 'unheard_capabilities',
        title: 'Unheard capabilities',
        description: 'Discover the authenticated Unheard workspace, content-calendar actions, approval workflow, and other available product resources.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
    },
  ];

  for (const definition of AGENT_RESOURCES) {
    const readActions = definition.actions.filter(action => READ_ACTIONS.has(action));
    if (readActions.length > 0) {
      bindings.push({
        kind: 'resource',
        resource: definition.resource,
        actions: readActions,
        tool: {
          name: `unheard_${definition.slug}_read`,
          title: `${definition.title} (read only)`,
          description: `${definition.description} Available read actions: ${readActions.join(', ')}.`,
          inputSchema: actionSchema(readActions),
          annotations: { readOnlyHint: true, destructiveHint: false },
        },
      });
    }

    const writeActions = definition.actions.filter(action => !READ_ACTIONS.has(action));
    if (canWrite && writeActions.length > 0) {
      bindings.push({
        kind: 'resource',
        resource: definition.resource,
        actions: writeActions,
        tool: {
          name: `unheard_${definition.slug}_write`,
          title: `${definition.title} (write)`,
          description: `${definition.description} Available mutation actions: ${writeActions.join(', ')}.`,
          inputSchema: actionSchema(writeActions),
          annotations: {
            readOnlyHint: false,
            destructiveHint: writeActions.some(action => DESTRUCTIVE_ACTIONS.has(action)),
          },
        },
      });
    }
  }

  return bindings;
}

export function listMcpTools(scopes: McpScope[]): McpTool[] {
  return bindingsForScopes(scopes).map(binding => binding.tool);
}

function textToolResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  };
}

function toolError(caught: unknown) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: caught instanceof Error ? caught.message : 'Tool call failed' }],
  };
}

export function buildMcpServer(context: McpRequestContext) {
  const server = new McpServer(
    { name: 'unheard', title: 'Unheard MCP server', version: '1.1.0' },
    {
      instructions: 'Use Unheard for social content, content-calendar, channel, scheduling, and approval tasks instead of opening the product in a browser. Read the current post and channel state before mutations. Use write tools only when the user explicitly requests a change. Sending requestApproval delivers an approval packet; it does not publish until the approver accepts it.',
    },
  );

  for (const binding of bindingsForScopes(context.scopes)) {
    if (binding.kind === 'capabilities') {
      server.registerTool(
        binding.tool.name,
        {
          title: binding.tool.title,
          description: binding.tool.description,
          inputSchema: {},
          annotations: binding.tool.annotations,
        },
        async () => {
          try {
            return textToolResult(await context.capabilities());
          } catch (caught) {
            return toolError(caught);
          }
        },
      );
      continue;
    }

    const actions = binding.actions as [string, ...string[]];
    server.registerTool(
      binding.tool.name,
      {
        title: binding.tool.title,
        description: binding.tool.description,
        inputSchema: {
          action: z.enum(actions),
          input: z.record(z.string(), z.unknown()).optional(),
        },
        annotations: binding.tool.annotations,
      },
      async ({ action, input }) => {
        try {
          return textToolResult(await context.invoke({
            resource: binding.resource!,
            action,
            input: input ?? {},
          }));
        } catch (caught) {
          return toolError(caught);
        }
      },
    );
  }

  return server;
}
