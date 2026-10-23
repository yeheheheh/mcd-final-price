import { describe, expect, it } from 'vitest';
import { rankOffers } from '../src/compare/rank.js';
import type { Offer, PriceQuote, Store } from '../src/domain/types.js';

const storeA: Store = {
  storeCode: 'S1',
  storeName: '南京东路店',
  distanceMeters: 480,
};
const storeB: Store = {
  storeCode: 'S2',
  storeName: '人民广场店',
  distanceMeters: 240,
};
const deliveryStore: Store = {
  storeCode: 'D1',
  storeName: '外送店',
  beCode: 'D1-01',
};

function makeOffer(input: {
  id: string;
  mode: 'pickup' | 'delivery';
  store: Store;
  totalCents: number;
  etaMinutes?: number;
}): Offer {
  const quote: PriceQuote = {
    totalCents: input.totalCents,
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
        unitPriceCents: input.totalCents,
      },
    ],
    label: '标准价',
    warnings: [],
    quote,
    etaMinutes: input.etaMinutes,
    etaSource: input.etaMinutes === undefined ? 'unknown' : 'api',
    timeCostCents: 0,
    adjustedTotalCents: input.totalCents,
  };
}

const baseOffers: Offer[] = [
  makeOffer({ id: 'A', mode: 'pickup', store: storeA, totalCents: 2750 }),
  makeOffer({ id: 'B', mode: 'pickup', store: storeB, totalCents: 3100 }),
  makeOffer({
    id: 'C',
    mode: 'delivery',
    store: deliveryStore,
    totalCents: 3650,
    etaMinutes: 35,
  }),
];

describe('rankOffers', () => {
  it('ranks by final price and estimates pickup time from distance', () => {
    const result = rankOffers(baseOffers, {
      query: { intent: '双层吉士堡套餐', quantity: 1 },
      generatedAt: '2026-10-23T04:00:00.000Z',
    });

    expect(result.winner.id).toBe('A');
    expect(result.cheapest.id).toBe('A');
    expect(result.fastest?.id).toBe('B');
    expect(result.offers.map((offer) => offer.id)).toEqual(['A', 'B', 'C']);

    const offerA = result.offers.find((offer) => offer.id === 'A');
    expect(offerA?.etaMinutes).toBe(11);
    expect(offerA?.etaSource).toBe('estimated');
  });

  it('can flip the winner when time value is included', () => {
    const result = rankOffers(baseOffers, {
      hourlyWageCents: 6000,
      query: { intent: '双层吉士堡套餐', quantity: 1, hourlyWageCents: 6000 },
      generatedAt: '2026-10-23T04:00:00.000Z',
    });

    expect(result.winner.id).toBe('C');
    expect(result.cheapest.id).toBe('A');
    expect(result.fastest?.id).toBe('B');

    const offerA = result.offers.find((offer) => offer.id === 'A');
    const offerC = result.offers.find((offer) => offer.id === 'C');
    expect(offerA?.timeCostCents).toBe(1100);
    expect(offerA?.adjustedTotalCents).toBe(3850);
    expect(offerC?.timeCostCents).toBe(100);
    expect(offerC?.adjustedTotalCents).toBe(3750);
  });

  it('prefers an API-provided ETA over the distance estimate', () => {
    const pickupWithEta = makeOffer({
      id: 'A',
      mode: 'pickup',
      store: storeA,
      totalCents: 2750,
      etaMinutes: 20,
    });

    const result = rankOffers([pickupWithEta], {
      query: { intent: '双层吉士堡套餐', quantity: 1 },
      generatedAt: '2026-10-23T04:00:00.000Z',
    });

    expect(result.winner.etaMinutes).toBe(20);
    expect(result.winner.etaSource).toBe('api');
  });

  it('keeps going when an ETA is unknown', () => {
    const unknownEta = makeOffer({
      id: 'D',
      mode: 'delivery',
      store: { storeCode: 'D2', storeName: '未知时效店' },
      totalCents: 2500,
    });

    const result = rankOffers([unknownEta, ...baseOffers], {
      query: { intent: '双层吉士堡套餐', quantity: 1 },
      generatedAt: '2026-10-23T04:00:00.000Z',
    });

    expect(result.winner.id).toBe('D');
    expect(result.winner.etaSource).toBe('unknown');
    expect(result.fastest?.id).toBe('B');
  });

  it('keeps only the cheapest offer per store and mode', () => {
    const baseline = makeOffer({
      id: 'A1',
      mode: 'pickup',
      store: storeA,
      totalCents: 2750,
    });
    const couponOffer = makeOffer({
      id: 'A2',
      mode: 'pickup',
      store: storeA,
      totalCents: 2600,
    });

    const result = rankOffers([baseline, couponOffer], {
      query: { intent: '双层吉士堡套餐', quantity: 1 },
      generatedAt: '2026-10-23T04:00:00.000Z',
    });

    expect(result.offers).toHaveLength(1);
    expect(result.winner.id).toBe('A2');
  });

  it('rejects an empty offer list', () => {
    expect(() =>
      rankOffers([], {
        query: { intent: '双层吉士堡套餐', quantity: 1 },
      }),
    ).toThrow(/没有可比较的方案/);
  });
});
