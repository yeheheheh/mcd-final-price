import { parseArgs } from 'node:util';
import { loadEnvFile } from './env.js';
import { McpConnection } from './mcp/client.js';
import { McdApi } from './mcp/mcd.js';

const { values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: false,
  options: {
    full: { type: 'boolean', default: false },
    city: { type: 'string', default: '上海' },
    keyword: { type: 'string', default: '人民广场' },
  },
});

loadEnvFile();
const token = process.env.MCD_MCP_TOKEN;
if (!token) {
  console.error('缺少 MCD_MCP_TOKEN。请复制 .env.example 为 .env 并填入 Token。');
  process.exit(1);
}

const connection = await McpConnection.connect({
  token,
  url: process.env.MCD_MCP_URL,
});

try {
  const toolsResult = (await connection.listTools()) as {
    tools?: Array<{
      name: string;
      description?: string;
      inputSchema?: unknown;
    }>;
  };
  const tools = toolsResult.tools ?? [];

  console.log(`麦当劳 MCP 工具数量：${tools.length}`);
  for (const tool of tools) {
    if (values.full) {
      console.log(`\n### ${tool.name}`);
      console.log(JSON.stringify(tool.inputSchema ?? {}, null, 2));
    } else {
      console.log(`- ${tool.name}: ${tool.description ?? ''}`.slice(0, 240));
    }
  }

  console.log('\n只读连接验证：');
  const api = new McdApi(connection);
  const stores = await api.nearbyStores({
    city: String(values.city),
    keyword: String(values.keyword),
  });
  console.log(`- 附近门店：${stores.length} 家`);
  for (const store of stores.slice(0, 3)) {
    console.log(
      `  · ${store.storeName} (${store.storeCode}) ${store.distanceMeters ?? '?'}m`,
    );
  }

  const addresses = await api.deliveryAddresses();
  console.log(`- 外送地址：${addresses.length} 个`);
  for (const address of addresses.slice(0, 3)) {
    console.log(`  · ${address.addressId} ${address.label}`);
  }

  console.log('\n提示：npm run probe -- --full 可查看完整入参 schema。');
} finally {
  await connection.close();
}
