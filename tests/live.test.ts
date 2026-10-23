import { describe, expect, it } from 'vitest';
import { compareLive, type CompareApi } from '../src/compare/live.js';
import type {
  Coupon,
  DeliveryAddress,
  MenuItem,
  PriceCandidate,
  PriceQuote,
  Store,
} from '../src/domain/types.js';

const pickupStore: Store = {
  storeCode: 'P1',
  storeName: '测试自取店',
  distanceMeters: 480,
};
const deliveryStore: Store = {
  storeCode: 'D1',
  storeName: '测试外送店',
  beCode: 'BE1',
};
const menu: MenuItem[] = [
  {
    productCode: 'M1',
    name: '巨无霸套餐',
    priceCents: 3000,
    available: true,
    isCombo: true,
  },
];
const coupon: Coupon = {
  couponId: 'C1',
  name: '立减 5',
  discountCents: 500,
  productCodes: ['M1'],
};

function createApi(overrides: Partial<CompareApi> = {}): CompareApi {
  return {
    nearbyStores: async () => [pickupStore],
    deliveryAddresses: async (): Promise<DeliveryAddress[]> => [],
    deliveryStores: async () => [],
    menu: async () => menu,
    storeCoupons: async () => [coupon],
    price: async (candidate: PriceCandidate): Promise<PriceQuote> => ({
      totalCents: candidate.coupon ? 2500 : 3000,
      productCents: 3000,
      discountCents: candidate.coupon ? 500 : 0,
      etaSource: 'unknown',
    }),
    ...overrides,
  };
}

describe('compareLive', () => {
  it('compares pickup offers and degrades gracefully without a delivery address', async () => {
    const result = await compareLive(createApi(), {
      intent: '巨无霸套餐',
      city: '上海',
      keyword: '人民广场',
      now: () => new Date('2026-10-23T04:00:00.000Z'),
    });

    expect(result.dataSource).toBe('live');
    expect(result.offers).toHaveLength(1);
    expect(result.winner.quote.totalCents).toBe(2500);
    expect(result.warnings.join('\n')).toContain('外送地址');
  });

  it('includes a delivery offer when an address and delivery store exist', async () => {
    const deliveryCalls: string[] = [];
    const result = await compareLive(
      createApi({
        deliveryAddresses: async () => [{ addressId: 'A1', label: '公司' }],
        deliveryStores: async (addressId) => {
          deliveryCalls.push(addressId);
          return [deliveryStore];
        },
        storeCoupons: async (_store, mode) => (mode === 'pickup' ? [coupon] : []),
        price: async (candidate) => ({
          totalCents: candidate.mode === 'delivery' ? 3600 : 2500,
          deliveryFeeCents: candidate.mode === 'delivery' ? 600 : 0,
          etaMinutes: candidate.mode === 'delivery' ? 35 : undefined,
          etaSource: candidate.mode === 'delivery' ? 'api' : 'unknown',
        }),
      }),
      {
        intent: '巨无霸套餐',
        city: '上海',
        keyword: '人民广场',
      },
    );

    expect(deliveryCalls).toEqual(['A1']);
    expect(result.offers).toHaveLength(2);
    expect(result.offers.some((offer) => offer.mode === 'delivery')).toBe(true);
    expect(result.offers.find((offer) => offer.mode === 'delivery')?.quote.totalCents).toBe(
      3600,
    );
  });

  it('skips a store whose price call fails and keeps the rest', async () => {
    let callCount = 0;
    const result = await compareLive(
      createApi({
        price: async () => {
          callCount += 1;
          if (callCount === 1) throw new Error('MCD_BUSY');
          return {
            totalCents: 2500,
            etaSource: 'unknown',
          };
        },
      }),
      {
        intent: '巨无霸套餐',
        city: '上海',
        keyword: '人民广场',
      },
    );

    expect(result.offers).toHaveLength(1);
    expect(result.warnings.join('\n')).toContain('算价失败');
  });

  it('throws when no store is found', async () => {
    await expect(
      compareLive(createApi({ nearbyStores: async () => [] }), {
        intent: '巨无霸套餐',
        city: '上海',
        keyword: '人民广场',
      }),
    ).rejects.toThrow(/没有找到/);
  });
});
