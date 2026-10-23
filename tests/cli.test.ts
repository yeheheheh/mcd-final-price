import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';

function createIo() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      out: (message: string) => out.push(message),
      err: (message: string) => err.push(message),
    },
  };
}

describe('runCli', () => {
  it('prints demo JSON without connecting to MCP', async () => {
    const { out, io } = createIo();

    const code = await runCli(['demo', '--json'], io);

    expect(code).toBe(0);
    const parsed = JSON.parse(out.join('\n')) as {
      winner: { quote: { totalCents: number } };
      dataSource: string;
    };
    expect(parsed.dataSource).toBe('demo');
    expect(parsed.winner.quote.totalCents).toBe(2750);
  });

  it('prints help when no command is given', async () => {
    const { out, io } = createIo();

    const code = await runCli([], io);

    expect(code).toBe(0);
    expect(out.join('\n')).toContain('麦麦到手价');
    expect(out.join('\n')).toContain('demo');
    expect(out.join('\n')).toContain('compare');
  });

  it('returns a non-zero code for missing compare arguments', async () => {
    const { err, io } = createIo();

    const code = await runCli(['compare'], io);

    expect(code).toBe(1);
    expect(err.join('\n')).toContain('--intent');
  });
});
