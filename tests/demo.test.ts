import { describe, expect, it } from 'vitest';
import { runDemo } from '../src/demo/run.js';
import { renderMarkdown } from '../src/compare/report.js';

describe('runDemo', () => {
  it('produces the three comparison offers without a token', () => {
    const result = runDemo();

    expect(result.dataSource).toBe('demo');
    expect(result.offers).toHaveLength(3);
    expect(result.winner.store.storeName).toBe('南京东路店');
    expect(result.winner.quote.totalCents).toBe(2750);
    expect(result.cheapest.id).toBe(result.winner.id);
    expect(result.fastest?.store.storeName).toBe('人民广场店');

    const delivery = result.offers.find((offer) => offer.mode === 'delivery');
    expect(delivery?.quote.totalCents).toBe(3650);
    expect(delivery?.etaMinutes).toBe(35);
  });

  it('renders a demo markdown report with the expected prices', () => {
    const markdown = renderMarkdown(runDemo());

    expect(markdown).toContain('¥27.50');
    expect(markdown).toContain('¥31.00');
    expect(markdown).toContain('¥36.50');
    expect(markdown).toContain('演示数据（非真实价格）');
  });
});
