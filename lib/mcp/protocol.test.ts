// ABOUTME: Contract tests for the Unheard MCP server's stateless JSON-RPC implementation.
// ABOUTME: Covers protocol negotiation, scope-filtered tools, calls, and notifications.

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { describe, expect, it, vi } from 'vitest';
import { buildMcpServer, listMcpTools } from './protocol';

function context(scopes: Array<'read' | 'write'> = ['read']) {
  return {
    scopes,
    capabilities: vi.fn(async () => ({ version: 'test' })),
    invoke: vi.fn(async invocation => ({ invocation })),
  };
}

describe('Unheard MCP protocol', () => {
  async function request(body: unknown, ctx = context()) {
    const server = buildMcpServer(ctx);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(new Request('https://unheard.io/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(body),
      }));
    } finally {
      await transport.close();
      await server.close();
    }
  }

  it('negotiates initialize and advertises tools', async () => {
    const response = await request({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });

    expect(await response.json()).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-06-18',
        serverInfo: {
          name: 'unheard',
          title: 'Unheard MCP server',
          version: '1.1.0',
        },
        capabilities: { tools: { listChanged: true } },
      },
    });
  });

  it('hides every mutation tool from read-only grants', () => {
    const tools = listMcpTools(['read']);
    expect(tools.length).toBeGreaterThan(10);
    expect(tools.every(tool => tool.annotations.readOnlyHint)).toBe(true);
    expect(tools.some(tool => tool.name.endsWith('_write'))).toBe(false);
  });

  it('separates read and write tools for write grants', () => {
    const tools = listMcpTools(['read', 'write']);
    expect(tools.some(tool => tool.name === 'unheard_ideas_read')).toBe(true);
    expect(tools.some(tool => tool.name === 'unheard_ideas_write')).toBe(true);
    expect(tools.find(tool => tool.name === 'unheard_content_calendar_write')?.annotations.destructiveHint).toBe(true);
  });

  it('advertises complete content-calendar operations', () => {
    const tools = listMcpTools(['read', 'write']);
    const readTool = tools.find(tool => tool.name === 'unheard_content_calendar_read');
    const writeTool = tools.find(tool => tool.name === 'unheard_content_calendar_write');

    expect(readTool?.description).toContain('content and calendar');
    expect(readTool?.inputSchema).toMatchObject({
      properties: { action: { enum: ['list', 'get'] } },
    });
    expect(writeTool?.description).toContain('requestApproval');
    expect(writeTool?.inputSchema).toMatchObject({
      properties: { action: { enum: ['create', 'update', 'schedule', 'requestApproval', 'delete'] } },
    });
  });

  it('routes a valid read tool call into the agent API invocation', async () => {
    const ctx = context();
    const response = await request({
      jsonrpc: '2.0',
      id: 'call-1',
      method: 'tools/call',
      params: {
        name: 'unheard_ideas_read',
        arguments: { action: 'list', input: {} },
      },
    }, ctx);

    expect(ctx.invoke).toHaveBeenCalledWith({ resource: 'ideas', action: 'list', input: {} });
    expect(await response.json()).toMatchObject({ jsonrpc: '2.0', id: 'call-1', result: { content: [{ type: 'text' }] } });
  });

  it('routes a content-calendar approval request without a browser workflow', async () => {
    const ctx = context(['read', 'write']);
    const response = await request({
      jsonrpc: '2.0',
      id: 'approval-1',
      method: 'tools/call',
      params: {
        name: 'unheard_content_calendar_write',
        arguments: { action: 'requestApproval', input: { id: 'post-1' } },
      },
    }, ctx);

    expect(ctx.invoke).toHaveBeenCalledWith({
      resource: 'posts',
      action: 'requestApproval',
      input: { id: 'post-1' },
    });
    expect(await response.json()).toMatchObject({
      jsonrpc: '2.0',
      id: 'approval-1',
      result: { content: [{ type: 'text' }] },
    });
  });

  it('does not allow a read-only grant to call a mutation tool by name', async () => {
    const response = await request({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'unheard_ideas_write',
        arguments: { action: 'delete', input: { id: 'idea' } },
      },
    }, context(['read']));

    expect(await response.json()).toMatchObject({
      result: {
        isError: true,
        content: [{ type: 'text', text: expect.stringContaining('not found') }],
      },
    });
  });

  it('accepts initialized notifications without a response body', async () => {
    const response = await request({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
  });
});
