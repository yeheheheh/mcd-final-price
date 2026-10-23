import { buildCandidates } from './candidates.js';
import { rankOffers } from './rank.js';
import type {
  ComparisonResult,
  Coupon,
  DeliveryAddress,
  MenuItem,
  Offer,
  OrderMode,
  PriceCandidate,
  PriceQuote,
  Store,
} from '../domain/types.js';

export interface CompareApi {
  nearbyStores(input: { city: string; keyword: string }): Promise<Store[]>;
  deliveryAddresses(): Promise<DeliveryAddress[]>;
  deliveryStores(addressId: string): Promise<Store[]>;
  menu(store: Store, mode: OrderMode): Promise<MenuItem[]>;
  storeCoupons(store: Store, mode: OrderMode): Promise<Coupon[]>;
  price(candidate: PriceCandidate): Promise<PriceQuote>;
}

export interface LiveCompareOptions {
  intent: string;
  city: string;
  keyword: string;
  addressId?: string;
  quantity?: number;
  hourlyWageCents?: number;
  maxStores?: number;
  maxDeliveryStores?: number;
  maxCandidatesPerStore?: number;
  now?: () => Date;
  onProgress?: (message: string) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), items.length) },
    async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await mapper(items[index]);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

export async function compareLive(
  api: CompareApi,
  options: LiveCompareOptions,
): Promise<ComparisonResult> {
  const intent = options.intent.trim();
  if (!intent) throw new Error('缺少 --intent（想吃什么）');

  const quantity = Math.max(1, Math.floor(options.quantity ?? 1));
  const progress = options.onProgress ?? (() => undefined);
  const warnings: string[] = [];
  const maxStores = Math.max(1, options.maxStores ?? 3);
  const maxDeliveryStores = Math.max(1, options.maxDeliveryStores ?? 2);
  const maxCandidatesPerStore = Math.max(
    1,
    options.maxCandidatesPerStore ?? 5,
  );

  progress(`正在查询 ${options.city} ${options.keyword} 附近门店…`);
  const pickupStores = (await api.nearbyStores({
    city: options.city,
    keyword: options.keyword,
  })).slice(0, maxStores);

  if (pickupStores.length === 0) {
    throw new Error(`没有找到 ${options.city} ${options.keyword} 附近的麦当劳门店`);
  }

  let deliveryStores: Store[] = [];
  try {
    progress('正在查询外送地址与可配送门店…');
    const addresses = await api.deliveryAddresses();
    const addressId = options.addressId ?? addresses[0]?.addressId;

    if (!addressId) {
      warnings.push('账号下没有可用的外送地址；本次只比较到店自取。');
    } else {
      const stores = await api.deliveryStores(addressId);
      deliveryStores = stores.filter((store) => store.beCode).slice(0, maxDeliveryStores);
      if (deliveryStores.length === 0) {
        warnings.push('当前外送地址没有可配送门店；本次只比较到店自取。');
      }
    }
  } catch (error) {
    warnings.push(`外送信息获取失败：${errorMessage(error)}；本次只比较到店自取。`);
  }

  const candidates: PriceCandidate[] = [];

  const collectCandidates = async (store: Store, mode: OrderMode) => {
    progress(`正在查询 ${store.storeName}（${mode === 'pickup' ? '自取' : '外送'}）的菜单与优惠券…`);
    try {
      const [menu, coupons] = await Promise.all([
        api.menu(store, mode),
        api.storeCoupons(store, mode),
      ]);
      const built = buildCandidates({
        store,
        mode,
        menu,
        coupons,
        intent,
        quantity,
        maxCandidates: maxCandidatesPerStore,
      });
      candidates.push(...built.candidates);
      warnings.push(
        ...built.warnings.map((warning) => `${store.storeName}：${warning}`),
      );
    } catch (error) {
      warnings.push(
        `${store.storeName}（${mode === 'pickup' ? '自取' : '外送'}）查询失败：${errorMessage(error)}`,
      );
    }
  };

  for (const store of pickupStores) {
    await collectCandidates(store, 'pickup');
  }
  for (const store of deliveryStores) {
    await collectCandidates(store, 'delivery');
  }

  if (candidates.length === 0) {
    throw new Error(`没有可算价的候选方案。${warnings.join('；')}`);
  }

  progress(`正在逐个调用 calculate-price 真算（${candidates.length} 个候选）…`);
  const priced = await mapLimit(candidates, 3, async (candidate) => {
    try {
      const quote = await api.price(candidate);
      const offer: Offer = {
        ...candidate,
        quote,
        etaMinutes: quote.etaMinutes,
        etaSource: quote.etaSource,
        timeCostCents: 0,
        adjustedTotalCents: quote.totalCents,
      };
      return offer;
    } catch (error) {
      warnings.push(
        `算价失败：${candidate.store.storeName} / ${candidate.label}：${errorMessage(error)}`,
      );
      return undefined;
    }
  });

  const offers = priced.filter((offer): offer is Offer => offer !== undefined);
  if (offers.length === 0) {
    throw new Error(`没有成功算价的方案。${warnings.join('；')}`);
  }

  progress(`算价完成：${offers.length}/${candidates.length} 个方案成功。`);

  return rankOffers(offers, {
    query: {
      intent,
      quantity,
      city: options.city,
      keyword: options.keyword,
      hourlyWageCents: options.hourlyWageCents,
    },
    hourlyWageCents: options.hourlyWageCents,
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    dataSource: 'live',
    warnings,
  });
}
