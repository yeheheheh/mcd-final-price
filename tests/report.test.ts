import { describe, expect, it } from 'vitest';
import { rankOffers } from '../src/compare/rank.js';
import {
  formatCents,
  renderHtml,
  renderJson,
  renderMarkdown,
} from '../src/compare/report.js';
import type { Offer, PriceQuote, Store } from '../src/domain/types.js';

function makeOffer(input: {
  id: string;
  mode: 'pickup' | 'delivery';
  store: Store;
  totalCents: number;
  productCents: number;
  deliveryFeeCents?: number;
  packagingFeeCents?: number;
  discountCents?: number;
  etaMinutes?: number;
  couponName?: string;
}): Offer {
  const quote: PriceQuote = {
    totalCents: input.totalCents,
    productCents: input.productCents,
    deliveryFeeCents: input.deliveryFeeCents,
    packagingFeeCents: input.packagingFeeCents,
    discountCents: input.discountCents,
    etaMinutes: input.etaMinutes,
    etaSource: input.etaMinutes === undefined ? 'unknown' : 'api',
  };

  return {
    id: input.id,
    mode: input.mode,
    store: input.store,
    items: [
      {
        productCode: 'M1',
        name: '双层吉士堡套餐',
        quantity: 1,
        unitPriceCents: input.productCents,
      },
    ],
    coupon: input.couponName
      ? { couponId: input.id, name: input.couponName }
      : undefined,
    label: '标准价',
    warnings: [],
    quote,
    etaMinutes: input.etaMinutes,
    etaSource: input.etaMinutes === undefined ? 'unknown' : 'api',
    timeCostCents: 0,
    adjustedTotalCents: input.totalCents,
  };
}

const offers: Offer[] = [
  makeOffer({
    id: 'A',
    mode: 'pickup',
    store: { storeCode: 'S1', storeName: '南京东路店', distanceMeters: 480 },
    totalCents: 2750,
    productCents: 3250,
    discountCents: 500,
    couponName: '满 25 减 5',
  }),
  makeOffer({
    id: 'B',
    mode: 'pickup',
    store: { storeCode: 'S2', storeName: '人民广场店', distanceMeters: 240 },
    totalCents: 3100,
    productCents: 3100,
  }),
  makeOffer({
    id: 'C',
    mode: 'delivery',
    store: { storeCode: 'D1', storeName: '外送店' },
    totalCents: 3650,
    productCents: 3350,
    deliveryFeeCents: 600,
    packagingFeeCents: 100,
    discountCents: 400,
    etaMinutes: 35,
    couponName: '满 30 减 4',
  }),
];

const result = rankOffers(offers, {
  query: { intent: '双层吉士堡套餐', quantity: 1 },
  generatedAt: '2026-10-23T04:00:00.000Z',
  dataSource: 'demo',
});

describe('formatCents', () => {
  it('formats fen as yuan with two decimals', () => {
    expect(formatCents(2750)).toBe('¥27.50');
    expect(formatCents(0)).toBe('¥0.00');
  });
});

describe('renderMarkdown', () => {
  it('contains the winner, comparison rows and demo disclaimer', () => {
    const markdown = renderMarkdown(result);

    expect(markdown).toContain('麦麦到手价');
    expect(markdown).toContain('南京东路店');
    expect(markdown).toContain('¥27.50');
    expect(markdown).toContain('¥36.50');
    expect(markdown).toContain('演示数据');
    expect(markdown).toContain('推荐');
  });
});

describe('renderJson', () => {
  it('serializes the comparison result', () => {
    const parsed = JSON.parse(renderJson(result)) as {
      winner: { id: string };
      offers: unknown[];
    };

    expect(parsed.winner.id).toBe('A');
    expect(parsed.offers).toHaveLength(3);
  });
});

describe('renderHtml', () => {
  it('renders a standalone card with the winning price', () => {
    const html = renderHtml(result);

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('¥27.50');
    expect(html).toContain('南京东路店');
    expect(html).toContain('演示数据');
  });

  it('escapes user-controlled store and item names', () => {
    const unsafe = rankOffers(
      [
        makeOffer({
          id: 'X',
          mode: 'pickup',
          store: {
            storeCode: 'X1',
            storeName: '<script>alert(1)</script>',
            distanceMeters: 100,
          },
          totalCents: 1000,
          productCents: 1000,
        }),
      ],
      {
        query: { intent: '<img src=x onerror=alert(1)>', quantity: 1 },
        generatedAt: '2026-10-23T04:00:00.000Z',
        dataSource: 'live',
      },
    );

    const html = renderHtml(unsafe);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
