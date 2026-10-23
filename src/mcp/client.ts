import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const READ_ONLY_TOOLS = new Set([
  'now-time-info',
  'query-nearby-stores',
  'delivery-query-addresses',
  'delivery-query-stores',
  'query-meals',
  'query-meal-detail',
  'query-store-coupons',
  'query-my-coupons',
  'available-coupons',
  'calculate-price',
]);

export function assertReadOnlyTool(name: string): void {
  if (!READ_ONLY_TOOLS.has(name)) {
    throw new Error(`拒绝调用非只读工具：${name}`);
  }
}

export interface ToolCaller {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface ConnectOptions {
  token: string;
  url?: string;
}

export class McpConnection implements ToolCaller {
  private constructor(private readonly client: Client) {}

  static async connect(options: ConnectOptions): Promise<McpConnection> {
    if (!options.token.trim()) {
      throw new Error('缺少 MCD_MCP_TOKEN，请先在 .env 中配置');
    }

    const transport = new StreamableHTTPClientTransport(
      new URL(options.url ?? 'https://mcp.mcd.cn'),
      {
        requestInit: {
          headers: {
            Authorization: `Bearer ${options.token}`,
          },
        },
      },
    );
    const client = new Client(
      { name: 'mcd-final-price', version: '0.1.0' },
      { capabilities: {} },
    );
    await client.connect(transport);
    return new McpConnection(client);
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    assertReadOnlyTool(name);
    return this.client.callTool({ name, arguments: args });
  }

  async listTools(): Promise<unknown> {
    return this.client.listTools();
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
