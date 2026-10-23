import { describe, expect, it } from 'vitest';
import {
  buildCandidates,
  matchMenuItem,
} from '../src/compare/candidates.js';
import type { Coupon, MenuItem, Store } from '../src/domain/types.js';

const store: Store = { storeCode: 'S1', storeName: '测试店' };

const menu: MenuItem[] = [
  {
    productCode: 'M1',
    name: '双层吉士堡套餐',
    priceCents: 3250,
    available: true,
    isCombo: true,
  },
  {
    productCode: 'M2',
    name: '薯条（中）',
    priceCents: 700,
    available: true,
    isCombo: false,
  },
  {
    productCode: 'M3',
    name: '可乐（中）',
    priceCents: 600,
    available: true,
    isCombo: false,
  },
  {
    productCode: 'M4',
    name: '双层吉士堡套餐',
    priceCents: 9999,
    available: false,
    isCombo: true,
  },
];

const coupons: Coupon[] = [
  {
    couponId: 'C1',
    name: '满 25 减 5',
    thresholdCents: 2500,
    discountCents: 500,
    mode: 'pickup',
    storeCode: 'S1',
  },
  {
    couponId: 'C2',
    name: '满 40 减 10',
    thresholdCents: 4000,
    discountCents: 1000,
    mode: 'pickup',
    storeCode: 'S1',
  },
  {
    couponId: 'C3',
    name: '外送专用券',
    discountCents: 300,
    mode: 'delivery',
    storeCode: 'S1',
  },
  {
    couponId: 'C4',
    name: '别的门店券',
    thresholdCents: 1000,
    discountCents: 200,
    mode: 'pickup',
    storeCode: 'S2',
  },
];

describe('matchMenuItem', () => {
  it('matches a cheaper available item when the intent is a prefix', () => {
    expect(matchMenuItem(menu, '双层吉士堡')?.productCode).toBe('M1');
  });

  it('returns undefined when nothing matches', () => {
    expect(matchMenuItem(menu, '麦旋风')).toBeUndefined();
  });
});

describe('buildCandidates', () => {
  it('builds a baseline plus applicable coupon and add-on candidates', () => {
    const result = buildCandidates({
      store,
      mode: 'pickup',
      menu,
      coupons,
      intent: '双层吉士堡',
      quantity: 1,
    });

    expect(result.matchedItem?.productCode).toBe('M1');
    expect(result.candidates).toHaveLength(3);

    const baseline = result.candidates.find((candidate) => !candidate.coupon);
    expect(baseline?.items).toEqual([
      {
        productCode: 'M1',
        name: '双层吉士堡套餐',
        quantity: 1,
        unitPriceCents: 3250,
      },
    ]);

    const directCoupon = result.candidates.find(
      (candidate) => candidate.coupon?.couponId === 'C1',
    );
    expect(directCoupon?.label).toBe('用券：满 25 减 5');

    const addon = result.candidates.find(
      (candidate) => candidate.coupon?.couponId === 'C2',
    );
    expect(addon?.label).toBe('凑单：满 40 减 10');
    expect(addon?.items).toEqual([
      {
        productCode: 'M1',
        name: '双层吉士堡套餐',
        quantity: 1,
        unitPriceCents: 3250,
      },
      {
        productCode: 'M3',
        name: '可乐（中）',
        quantity: 2,
        unitPriceCents: 600,
      },
    ]);
  });

  it('filters coupons by order mode and store', () => {
    const result = buildCandidates({
      store,
      mode: 'pickup',
      menu,
      coupons,
      intent: '双层吉士堡',
      quantity: 1,
    });

    const ids = result.candidates.map((candidate) => candidate.coupon?.couponId);
    expect(ids).not.toContain('C3');
    expect(ids).not.toContain('C4');
  });

  it('warns when the intent cannot be matched', () => {
    const result = buildCandidates({
      store,
      mode: 'pickup',
      menu,
      coupons,
      intent: '麦旋风',
      quantity: 1,
    });

    expect(result.candidates).toEqual([]);
    expect(result.warnings.join('\n')).toContain('未找到');
  });

  it('caps the number of candidates per store', () => {
    const result = buildCandidates({
      store,
      mode: 'pickup',
      menu,
      coupons,
      intent: '双层吉士堡',
      quantity: 1,
      maxCandidates: 2,
    });

    expect(result.candidates).toHaveLength(2);
  });
});
