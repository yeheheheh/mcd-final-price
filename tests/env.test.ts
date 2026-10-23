import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/env.js';

describe('parseEnv', () => {
  it('parses key-value pairs, comments, quotes and equals signs in values', () => {
    expect(
      parseEnv('# comment\nA=1\nB="two"\nC=three=four\nexport D=4\n\n'),
    ).toEqual({
      A: '1',
      B: 'two',
      C: 'three=four',
      D: '4',
    });
  });

  it('ignores invalid lines', () => {
    expect(parseEnv('not-a-pair\n=missing-key\nE=')).toEqual({ E: '' });
  });
});
