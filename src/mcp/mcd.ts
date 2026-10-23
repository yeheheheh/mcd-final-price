import {
  normalizeAddresses,
  normalizeCoupons,
  normalizeMenu,
  normalizeQuote,
  normalizeStores,
} from '../compare/normalize.js';
import type {
  Coupon,
  DeliveryAddress,
  MenuItem,
  OrderMode,
  PriceCandidate,
  PriceQuote,
  Store,
} from '../domain/types.js';
import type { ToolCaller } from './client.js';

export class McdApi {
  constructor(private readonly caller: ToolCaller) {}

  async nearbyStores(input: { city: string; keyword: string }): Promise<Store[]> {
    const payload = await this.caller.callTool('query-nearby-stores', {
      searchType: 2,
      beType: 1,
      city: input.city,
      keyword: input.keyword,
    });
    return normalizeStores(payload);
  }

  async deliveryAddresses(): Promise<DeliveryAddress[]> {
    const payload = await this.caller.callTool('delivery-query-addresses', {});
    return normalizeAddresses(payload);
  }

  async deliveryStores(addressId: string): Promise<Store[]> {
    const payload = await this.caller.callTool('delivery-query-stores', {
      addressId,
      beType: 2,
    });
    return normalizeStores(payload);
  }

  async menu(store: Store, mode: OrderMode): Promise<MenuItem[]> {
    const payload = await this.caller.callTool(
      'query-meals',
      this.context(store, mode),
    );
    return normalizeMenu(payload);
  }

  async storeCoupons(store: Store, mode: OrderMode): Promise<Coupon[]> {
    const payload = await this.caller.callTool(
      'query-store-coupons',
      this.context(store, mode),
    );
    return normalizeCoupons(payload);
  }

  async price(candidate: PriceCandidate): Promise<PriceQuote> {
    const payload = await this.caller.callTool(
      'calculate-price',
      this.priceArgs(candidate),
    );
    return normalizeQuote(payload);
  }

  private context(store: Store, mode: OrderMode): Record<string, unknown> {
    if (mode === 'delivery') {
      if (!store.beCode) {
        throw new Error(`外送门店 ${store.storeName} 缺少 beCode`);
      }
      return {
        storeCode: store.storeCode,
        orderType: 2,
        beType: 2,
        beCode: store.beCode,
      };
    }

    return {
      storeCode: store.storeCode,
      orderType: 1,
      beType: 1,
    };
  }

  private priceArgs(candidate: PriceCandidate): Record<string, unknown> {
    const context = this.context(candidate.store, candidate.mode);
    let couponAttached = false;

    const items = candidate.items.map((item) => {
      const entry: Record<string, unknown> = {
        productCode: item.productCode,
        quantity: item.quantity,
      };
      const coupon = candidate.coupon;
      const appliesToItem =
        coupon !== undefined &&
        (!coupon.productCodes?.length ||
          coupon.productCodes.includes(item.productCode));

      if (coupon && appliesToItem && !couponAttached) {
        if (coupon.couponId) entry.couponId = coupon.couponId;
        else if (coupon.couponCode) entry.couponCode = coupon.couponCode;
        couponAttached = true;
      }

      return entry;
    });

    return { ...context, items, needTableware: false };
  }
}
