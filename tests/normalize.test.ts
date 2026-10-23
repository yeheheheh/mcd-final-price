import { describe, expect, it } from 'vitest';
import {
  moneyToCents,
  normalizeCoupons,
  normalizeMenu,
  normalizeQuote,
  normalizeStores,
  parseToolPayload,
} from '../src/compare/normalize.js';

describe('moneyToCents', () => {
  it('treats integer numbers as fen', () => {
    expect(moneyToCents(2750)).toBe(2750);
  });

  it('treats decimal numbers as yuan', () => {
    expect(moneyToCents(27.5)).toBe(2750);
  });

  it('parses yuan strings with currency symbols', () => {
    expect(moneyToCents('¥27.50')).toBe(2750);
    expect(moneyToCents('36.5元')).toBe(3650);
  });

  it('parses integer strings as fen', () => {
    expect(moneyToCents('3650')).toBe(3650);
  });

  it('returns undefined for unusable input', () => {
    expect(moneyToCents('')).toBeUndefined();
    expect(moneyToCents('abc')).toBeUndefined();
    expect(moneyToCents(null)).toBeUndefined();
  });
});

describe('parseToolPayload', () => {
  it('extracts JSON from MCP text content', () => {
    const payload = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: true, data: { stores: [{ storeCode: 'A1' }] } }),
        },
      ],
    };

    expect(parseToolPayload(payload)).toEqual({
      success: true,
      data: { stores: [{ storeCode: 'A1' }] },
    });
  });

  it('returns plain JSON payloads unchanged', () => {
    expect(parseToolPayload({ success: true, data: { total: 1 } })).toEqual({
      success: true,
      data: { total: 1 },
    });
  });

  it('extracts the top-level JSON response from mixed markdown text', () => {
    const payload = {
      content: [
        {
          type: 'text',
          text: '## 输出格式\n|{data[].title}|\n\n{"success":true,"code":200,"data":[{"couponId":"C1"}]}\n\n尾部说明',
        },
      ],
    };

    expect(parseToolPayload(payload)).toEqual({
      success: true,
      code: 200,
      data: [{ couponId: 'C1' }],
    });
  });

  it('returns markdown-only text unchanged when there is no JSON', () => {
    const payload = {
      content: [{ type: 'text', text: '# 优惠券列表\n共 3 张可用优惠券' }],
    };

    expect(parseToolPayload(payload)).toBe('# 优惠券列表\n共 3 张可用优惠券');
  });
});

describe('normalizeStores', () => {
  it('normalizes a store list and parses distance text', () => {
    const stores = normalizeStores({
      data: {
        stores: [
          {
            storeCode: 'S001',
            storeName: '南京东路店',
            address: '南京东路 100 号',
            distance: '480m',
          },
          { storeId: 'S002', name: '人民广场店', distanceMeters: 240 },
        ],
      },
    });

    expect(stores).toEqual([
      {
        storeCode: 'S001',
        storeName: '南京东路店',
        address: '南京东路 100 号',
        distanceMeters: 480,
        beCode: undefined,
      },
      {
        storeCode: 'S002',
        storeName: '人民广场店',
        address: undefined,
        distanceMeters: 240,
        beCode: undefined,
      },
    ]);
  });
});

describe('normalizeMenu', () => {
  it('normalizes the meals dictionary shape used by query-meals', () => {
    const menu = normalizeMenu({
      data: {
        meals: {
          M001: { name: '双层吉士堡套餐', price: 3250, available: true },
          M002: { mealName: '麦香鱼套餐', salePrice: '19.50', soldOut: true },
        },
      },
    });

    expect(menu).toEqual([
      {
        productCode: 'M001',
        name: '双层吉士堡套餐',
        priceCents: 3250,
        available: true,
        isCombo: false,
      },
      {
        productCode: 'M002',
        name: '麦香鱼套餐',
        priceCents: 1950,
        available: false,
        isCombo: false,
      },
    ]);
  });
});

describe('normalizeCoupons', () => {
  it('normalizes coupon threshold and discount fields', () => {
    const coupons = normalizeCoupons({
      data: {
        coupons: [
          {
            couponId: 'C1',
            couponName: '满 25 减 5',
            minSpend: 2500,
            discountAmount: 500,
            orderType: 1,
          },
        ],
      },
    });

    expect(coupons).toEqual([
      {
        couponId: 'C1',
        couponCode: undefined,
        name: '满 25 减 5',
        thresholdCents: 2500,
        discountCents: 500,
        mode: 'pickup',
        storeCode: undefined,
        productCodes: [],
      },
    ]);
  });
});

describe('normalizeQuote', () => {
  it('extracts the payable total and fees from calculate-price', () => {
    const quote = normalizeQuote({
      data: {
        quoteId: 'Q1',
        totalAmount: 3650,
        productTotal: 3350,
        deliveryFee: 600,
        packagingFee: 100,
        discountAmount: 400,
        etaMinutes: 35,
      },
    });

    expect(quote.totalCents).toBe(3650);
    expect(quote.productCents).toBe(3350);
    expect(quote.deliveryFeeCents).toBe(600);
    expect(quote.packagingFeeCents).toBe(100);
    expect(quote.discountCents).toBe(400);
    expect(quote.quoteId).toBe('Q1');
    expect(quote.etaMinutes).toBe(35);
    expect(quote.etaSource).toBe('api');
  });

  it('supports yuan strings and nested totals', () => {
    const quote = normalizeQuote({
      data: { total: { amount: '36.50' }, deliveryFee: '6.00' },
    });

    expect(quote.totalCents).toBe(3650);
    expect(quote.deliveryFeeCents).toBe(600);
    expect(quote.etaSource).toBe('unknown');
  });

  it('throws when the payload has no payable amount', () => {
    expect(() => normalizeQuote({ data: { quoteId: 'Q1' } })).toThrow(
      /无法从算价响应中识别应付金额/,
    );
  });
});
