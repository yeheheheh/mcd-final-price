import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { compareLive, type LiveCompareOptions } from './compare/live.js';
import { renderHtml, renderJson, renderMarkdown } from './compare/report.js';
import { runDemo } from './demo/run.js';
import { loadEnvFile } from './env.js';
import { McpConnection } from './mcp/client.js';
import { McdApi } from './mcp/mcd.js';

export interface CliIo {
  out: (message: string) => void;
  err: (message: string) => void;
}

const defaultIo: CliIo = {
  out: (message) => console.log(message),
  err: (message) => console.error(message),
};

const HELP = `麦麦到手价 · 外送到手 vs 到店自取

用法：
  npm run demo -- [--json] [--html report.html] [--value-time 60]
  npm run compare -- --intent "双层吉士堡套餐" --city 上海 --keyword 人民广场 \\
    [--address-id A1] [--quantity 1] [--max-stores 3] \\
    [--value-time 60] [--json] [--html report.html]
  npm run probe -- [--full]

说明：
  --value-time   你的时间价值（元/小时），只折算需要离开工位或排队的时间
  --json         输出机器可读的 JSON
  --html         生成可截图分享的比价卡
  --address-id   指定外送地址；不传则使用账号下第一个地址
`;

class CliError extends Error {}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getString(
  values: Record<string, string | boolean | undefined>,
  key: string,
): string | undefined {
  const value = values[key];
  return typeof value === 'string' ? value : undefined;
}

function parseYuanToCents(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new CliError(`${name} 必须是非负数字`);
  }
  return Math.round(parsed * 100);
}

function parsePositiveInteger(
  value: string | undefined,
  name: string,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new CliError(`${name} 必须是大于 0 的整数`);
  }
  return parsed;
}

function emitResult(
  result: ReturnType<typeof runDemo>,
  values: Record<string, string | boolean | undefined>,
  io: CliIo,
): void {
  if (values.json === true) {
    io.out(renderJson(result));
  }

  const htmlPath = getString(values, 'html');
  if (htmlPath) {
    const absolutePath = resolve(process.cwd(), htmlPath);
    writeFileSync(absolutePath, renderHtml(result), 'utf8');
    io.out(`已生成比价卡：${absolutePath}`);
  }

  if (values.json !== true && !htmlPath) {
    io.out(renderMarkdown(result));
  }
}

async function runDemoCommand(
  args: string[],
  io: CliIo,
): Promise<number> {
  const { values } = parseArgs({
    args,
    allowPositionals: false,
    options: {
      json: { type: 'boolean', default: false },
      html: { type: 'string' },
      'value-time': { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help === true) {
    io.out(HELP);
    return 0;
  }

  const hourlyWageCents = parseYuanToCents(
    getString(values, 'value-time'),
    '--value-time',
  );
  const result = runDemo({ hourlyWageCents });
  emitResult(result, values, io);
  return 0;
}

async function runCompareCommand(
  args: string[],
  io: CliIo,
): Promise<number> {
  const { values } = parseArgs({
    args,
    allowPositionals: false,
    options: {
      intent: { type: 'string' },
      city: { type: 'string' },
      keyword: { type: 'string' },
      'address-id': { type: 'string' },
      quantity: { type: 'string' },
      'max-stores': { type: 'string' },
      'max-delivery-stores': { type: 'string' },
      'value-time': { type: 'string' },
      json: { type: 'boolean', default: false },
      html: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help === true) {
    io.out(HELP);
    return 0;
  }

  const intent = getString(values, 'intent');
  const city = getString(values, 'city');
  const keyword = getString(values, 'keyword');
  if (!intent) throw new CliError('缺少 --intent（想吃什么）');
  if (!city) throw new CliError('缺少 --city（城市）');
  if (!keyword) throw new CliError('缺少 --keyword（位置关键词）');

  loadEnvFile();
  const token = process.env.MCD_MCP_TOKEN;
  if (!token) {
    throw new CliError(
      '缺少 MCD_MCP_TOKEN。请复制 .env.example 为 .env，并填入你的麦当劳 MCP Token。',
    );
  }

  const options: LiveCompareOptions = {
    intent,
    city,
    keyword,
    addressId: getString(values, 'address-id'),
    quantity: parsePositiveInteger(getString(values, 'quantity'), '--quantity', 1),
    maxStores: parsePositiveInteger(
      getString(values, 'max-stores'),
      '--max-stores',
      3,
    ),
    maxDeliveryStores: parsePositiveInteger(
      getString(values, 'max-delivery-stores'),
      '--max-delivery-stores',
      2,
    ),
    hourlyWageCents: parseYuanToCents(
      getString(values, 'value-time'),
      '--value-time',
    ),
    onProgress: (message) => io.err(message),
  };

  const connection = await McpConnection.connect({
    token,
    url: process.env.MCD_MCP_URL,
  });

  try {
    const result = await compareLive(new McdApi(connection), options);
    emitResult(result, values, io);
    return 0;
  } finally {
    await connection.close();
  }
}

export async function runCli(
  argv: string[],
  io: CliIo = defaultIo,
): Promise<number> {
  const command = argv[0];
  const rest = argv.slice(1);

  try {
    if (!command || command === 'help' || command === '--help') {
      io.out(HELP);
      return 0;
    }

    if (command === 'demo') {
      return await runDemoCommand(rest, io);
    }

    if (command === 'compare') {
      return await runCompareCommand(rest, io);
    }

    throw new CliError(`未知命令：${command}\n\n${HELP}`);
  } catch (error) {
    io.err(`错误：${errorMessage(error)}`);
    return 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`错误：${errorMessage(error)}`);
      process.exitCode = 1;
    });
}
