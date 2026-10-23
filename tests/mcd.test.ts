import { describe, expect, it } from 'vitest';
import { assertReadOnlyTool } from '../src/mcp/client.js';
import { McdApi } from '../src/mcp/mcd.js';
import type { PriceCandidate } from '../src/domain/types.js';

function textPayload(text: string) {
  return { content: [{ type: 'text', text }] };
}

function createFakeCaller(responses: Record<string, unknown>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    caller: {
      callTool: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return responses[name] ?? textPayload('{}');
      },
    },
  };
}

const storesText =
  '说明文字\n{"success":true,"code":200,"data":[{"storeCode":"1450713","storeName":"麦当劳上海黄浦华旭国际大厦餐厅","address":"南京东路街道西藏中路336号","distance":144,"businessStatus":true}]}';

const menuText =
  '说明文字\n{"success":true,"code":200,"data":{"meals":{"1100":{"name":"巨无霸","currentPrice":"25.5","originalPrice":"25.5"},"520445":{"name":"薄皮焦香V翅","currentPrice":"16","originalPrice":"16"}}}}';

const couponsText =
  '说明文字\n{"success":true,"code":200,"data":[{"title":"19.9元王牌炸鸡任选2","couponId":"CHICKEN","couponCode":"CHICKEN-CODE","products":[{"productName":"薄皮焦香V翅","productCode":"520445"}]},{"title":"巨无霸立减5","couponId":"C-BIG","couponCode":"CODE-BIG","products":[{"productName":"巨无霸","productCode":"1100"}]}]}';

const priceText =
  '说明文字\n{"success":true,"code":200,"data":{"productOriginalPrice":2550,"productPrice":2550,"originalPrice":2550,"discount":0,"price":2550,"productList":[{"productCode":"1100","productName":"巨无霸","quantity":1,"originalSubtotal":2550,"subtotal":2550}],"takeWayList":[{"code":"eat-in","title":"堂食"}]}}';

const emptyAddressesText =
  '说明文字\n{"success":true,"code":200,"data":{"addresses":[]}}';

describe('assertReadOnlyTool', () => {
  it('allows the read-only tools used by this project', () => {
    expect(() => assertReadOnlyTool('calculate-price')).not.toThrow();
    expect(() => assertReadOnlyTool('query-store-coupons')).not.toThrow();
  });

  it('rejects order-creating and coupon-claiming tools', () => {
    expect(() => assertReadOnlyTool('create-order')).toThrow(/只读/);
    expect(() => assertReadOnlyTool('auto-bind-coupons')).toThrow(/只读/);
  });
});

describe('McdApi', () => {
  it('queries nearby pickup stores with the required parameters', async () => {
    const { caller, calls } = createFakeCaller({
      'query-nearby-stores': textPayload(storesText),
    });
    const api = new McdApi(caller);

    const stores = await api.nearbyStores({ city: '上海', keyword: '人民广场' });

    expect(calls[0]).toEqual({
      name: 'query-nearby-stores',
      args: { searchType: 2, beType: 1, city: '上海', keyword: '人民广场' },
    });
    expect(stores).toEqual([
      {
        storeCode: '1450713',
        storeName: '麦当劳上海黄浦华旭国际大厦餐厅',
        address: '南京东路街道西藏中路336号',
        distanceMeters: 144,
        beCode: undefined,
      },
    ]);
  });

  it('queries menu with pickup context and normalizes real price fields', async () => {
    const { caller, calls } = createFakeCaller({
      'query-meals': textPayload(menuText),
    });
    const api = new McdApi(caller);

    const menu = await api.menu(
      { storeCode: '1450713', storeName: '测试店' },
      'pickup',
    );

    expect(calls[0]).toEqual({
      name: 'query-meals',
      args: { storeCode: '1450713', orderType: 1, beType: 1 },
    });
    expect(menu[0]).toEqual({
      productCode: '1100',
      name: '巨无霸',
      priceCents: 2550,
      available: true,
      isCombo: false,
    });
  });

  it('normalizes store coupons with their applicable product codes', async () => {
    const { caller, calls } = createFakeCaller({
      'query-store-coupons': textPayload(couponsText),
    });
    const api = new McdApi(caller);

    const coupons = await api.storeCoupons(
      { storeCode: '1450713', storeName: '测试店' },
      'pickup',
    );

    expect(calls[0]).toEqual({
      name: 'query-store-coupons',
      args: { storeCode: '1450713', orderType: 1, beType: 1 },
    });
    expect(coupons).toHaveLength(2);
    expect(coupons[1]).toMatchObject({
      couponId: 'C-BIG',
      couponCode: 'CODE-BIG',
      name: '巨无霸立减5',
      productCodes: ['1100'],
    });
  });

  it('prices a pickup candidate with couponId inside the item', async () => {
    const { caller, calls } = createFakeCaller({
      'calculate-price': textPayload(priceText),
    });
    const api = new McdApi(caller);
    const candidate: PriceCandidate = {
      id: 'c1',
      mode: 'pickup',
      store: { storeCode: '1450713', storeName: '测试店' },
      items: [
        { productCode: '1100', name: '巨无霸', quantity: 1, unitPriceCents: 2550 },
      ],
      coupon: {
        couponId: 'C-BIG',
        couponCode: 'CODE-BIG',
        name: '巨无霸立减5',
        productCodes: ['1100'],
      },
      label: '用券：巨无霸立减5',
      warnings: [],
    };

    const quote = await api.price(candidate);

    expect(quote.totalCents).toBe(2550);
    expect(quote.productCents).toBe(2550);
    expect(calls[0]).toEqual({
      name: 'calculate-price',
      args: {
        storeCode: '1450713',
        orderType: 1,
        beType: 1,
        items: [{ productCode: '1100', quantity: 1, couponId: 'C-BIG' }],
        needTableware: false,
      },
    });
  });

  it('prices a delivery candidate with beType 2 and beCode', async () => {
    const { caller, calls } = createFakeCaller({
      'calculate-price': textPayload(priceText),
    });
    const api = new McdApi(caller);
    const candidate: PriceCandidate = {
      id: 'c2',
      mode: 'delivery',
      store: { storeCode: 'D1', storeName: '外送店', beCode: 'BE1' },
      items: [
        { productCode: '1100', name: '巨无霸', quantity: 1, unitPriceCents: 2550 },
      ],
      label: '标准价',
      warnings: [],
    };

    await api.price(candidate);

    expect(calls[0].args).toEqual({
      storeCode: 'D1',
      orderType: 2,
      beType: 2,
      beCode: 'BE1',
      items: [{ productCode: '1100', quantity: 1 }],
      needTableware: false,
    });
  });

  it('rejects a delivery candidate without beCode', async () => {
    const { caller } = createFakeCaller({});
    const api = new McdApi(caller);

    await expect(
      api.price({
        id: 'c3',
        mode: 'delivery',
        store: { storeCode: 'D1', storeName: '外送店' },
        items: [{ productCode: '1100', name: '巨无霸', quantity: 1 }],
        label: '标准价',
        warnings: [],
      }),
    ).rejects.toThrow(/beCode/);
  });

  it('normalizes an empty delivery address list', async () => {
    const { caller } = createFakeCaller({
      'delivery-query-addresses': textPayload(emptyAddressesText),
    });
    const api = new McdApi(caller);

    await expect(api.deliveryAddresses()).resolves.toEqual([]);
  });

  it('uses fullAddress as the delivery address label', async () => {
    const { caller } = createFakeCaller({
      'delivery-query-addresses': textPayload(
        '说明\n{"success":true,"code":200,"data":{"addresses":[{"addressId":"A1","contactName":"张三","fullAddress":"上海市黄浦区人民广场 1 号","phone":"13800000000"}]}}',
      ),
    });
    const api = new McdApi(caller);

    await expect(api.deliveryAddresses()).resolves.toEqual([
      { addressId: 'A1', label: '上海市黄浦区人民广场 1 号' },
    ]);
  });
});
