import type { Coupon, DeliveryAddress, MenuItem, OrderMode, PriceQuote, Store } from '../domain/types.js';

type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractJsonFromText(text: string): unknown {
  const successMatch = text.match(/{\s*"success"\s*:/);
  let start = successMatch?.index ?? -1;

  if (start < 0) {
    const traceMatch = text.match(/"traceId"\s*:/);
    if (traceMatch?.index !== undefined) {
      start = text.lastIndexOf('{', traceMatch.index);
    }
  }

  if (start < 0) start = text.lastIndexOf('{');
  if (start < 0) return text;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          return text;
        }
      }
    }
  }

  return text;
}

export function parseToolPayload(payload: unknown): unknown {
  if (!isRecord(payload) || !Array.isArray(payload.content)) return payload;

  for (const item of payload.content) {
    if (!isRecord(item) || item.type !== 'text' || typeof item.text !== 'string') continue;
    const text = item.text.trim();
    if (!text) continue;
    try {
      return JSON.parse(text);
    } catch {
      return extractJsonFromText(text);
    }
  }

  return payload;
}

function unwrapData(payload: unknown): unknown {
  const parsed = parseToolPayload(payload);
  if (isRecord(parsed) && 'data' in parsed) return parsed.data;
  if (isRecord(parsed) && 'result' in parsed) return parsed.result;
  return parsed;
}

function firstString(record: JsonRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value.replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function moneyToCents(value: unknown): number | undefined {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    return Number.isInteger(value) ? value : Math.round(value * 100);
  }

  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (!raw) return undefined;

  const hasCurrency = /[¥￥]/.test(raw) || /元/.test(raw);
  const cleaned = raw.replace(/[¥￥,\s]/g, '').replace(/元$/, '');
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return undefined;
  if (hasCurrency || cleaned.includes('.')) return Math.round(parsed * 100);
  return Math.round(parsed);
}

function firstMoney(record: JsonRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (isRecord(value)) {
      const nested = firstMoney(value, ['amount', 'value', 'price', 'total']);
      if (nested !== undefined) return nested;
      continue;
    }
    const parsed = moneyToCents(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function parseDistance(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== 'string') return undefined;

  const match = value.match(/([\d.]+)\s*(km|m)/i);
  if (match) {
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return undefined;
    return Math.round(match[2].toLowerCase() === 'km' ? amount * 1000 : amount);
  }

  return toNumber(value);
}

function extractList(data: unknown, keys: string[]): unknown[] {
  if (Array.isArray(data)) return data;
  if (!isRecord(data)) return [];
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

export function normalizeStore(raw: unknown): Store {
  const record = isRecord(raw) ? raw : {};
  const storeCode = firstString(record, ['storeCode', 'storeId', 'code', 'id']) ?? '';
  return {
    storeCode,
    storeName: firstString(record, ['storeName', 'name', 'title']) ?? storeCode,
    address: firstString(record, ['address', 'addressName', 'storeAddress', 'detail']),
    distanceMeters:
      parseDistance(record.distance) ?? parseDistance(record.distanceMeters),
    beCode: firstString(record, ['beCode', 'be_code', 'deliveryStoreCode']),
  };
}

export function normalizeStores(payload: unknown): Store[] {
  const data = unwrapData(payload);
  return extractList(data, ['stores', 'list', 'items'])
    .map(normalizeStore)
    .filter((store) => store.storeCode !== '');
}

function normalizeMenuItem(raw: unknown, fallbackCode: string): MenuItem {
  const record = isRecord(raw) ? raw : {};
  const productCode =
    firstString(record, ['productCode', 'mealCode', 'code', 'id']) ?? fallbackCode;
  const name =
    firstString(record, ['name', 'mealName', 'productName', 'title']) ?? productCode;
  const priceCents =
    firstMoney(record, [
      'priceCents',
      'price',
      'salePrice',
      'currentPrice',
      'priceAmount',
      'amount',
    ]) ?? 0;
  const unavailable =
    record.soldOut === true ||
    record.isAvailable === false ||
    record.available === false ||
    record.status === 'soldout' ||
    record.status === 'sold_out';
  const isCombo =
    record.isCombo === true || record.type === 'combo' || record.mealType === 'combo';

  return { productCode, name, priceCents, available: !unavailable, isCombo };
}

export function normalizeMenu(payload: unknown): MenuItem[] {
  const data = unwrapData(payload);

  let entries: Array<[string, unknown]> = [];
  if (isRecord(data) && isRecord(data.meals)) {
    entries = Object.entries(data.meals);
  } else if (isRecord(data) && Array.isArray(data.meals)) {
    entries = data.meals.map((item, index) => [String(index), item]);
  } else if (Array.isArray(data)) {
    entries = data.map((item, index) => [String(index), item]);
  } else if (isRecord(data)) {
    entries = extractList(data, ['meals', 'items', 'list']).map((item, index) => [
      String(index),
      item,
    ]);
  }

  return entries
    .map(([code, item]) => normalizeMenuItem(item, code))
    .filter((item) => item.productCode !== '');
}

export function normalizeCoupon(raw: unknown): Coupon {
  const record = isRecord(raw) ? raw : {};
  const couponId = firstString(record, ['couponId', 'coupon_id', 'id']);
  const couponCode = firstString(record, ['couponCode', 'coupon_code', 'code']);
  const orderType = toNumber(record.orderType ?? record.order_type);
  const mode: OrderMode | undefined =
    orderType === 1 ? 'pickup' : orderType === 2 ? 'delivery' : undefined;
  const products = Array.isArray(record.products) ? record.products : [];
  const productCodes = products
    .map((product) =>
      isRecord(product)
        ? firstString(product, ['productCode', 'code'])
        : undefined,
    )
    .filter((code): code is string => Boolean(code));

  return {
    couponId,
    couponCode,
    name:
      firstString(record, ['couponName', 'name', 'title', 'couponTitle']) ??
      couponId ??
      couponCode ??
      '优惠券',
    thresholdCents: firstMoney(record, [
      'thresholdCents',
      'minSpend',
      'threshold',
      'conditionAmount',
      'useCondition',
      'minAmount',
    ]),
    discountCents: firstMoney(record, [
      'discountCents',
      'discountAmount',
      'discount',
      'faceValue',
      'couponAmount',
      'amount',
    ]),
    mode,
    storeCode: firstString(record, ['storeCode', 'storeId']),
    productCodes,
  };
}

export function normalizeCoupons(payload: unknown): Coupon[] {
  const data = unwrapData(payload);
  return extractList(data, ['coupons', 'list', 'items']).map(normalizeCoupon);
}

export function normalizeAddresses(payload: unknown): DeliveryAddress[] {
  const data = unwrapData(payload);
  return extractList(data, ['addresses', 'list', 'items'])
    .map((raw) => {
      const record = isRecord(raw) ? raw : {};
      return {
        addressId:
          firstString(record, ['addressId', 'address_id', 'id', 'beCode']) ?? '',
        label:
          firstString(record, [
            'fullAddress',
            'address',
            'addressName',
            'detail',
            'name',
            'label',
          ]) ?? '外送地址',
      };
    })
    .filter((address) => address.addressId !== '');
}

function parseEta(record: JsonRecord): number | undefined {
  const keys = [
    'etaMinutes',
    'estimatedMinutes',
    'deliveryTime',
    'estimatedDeliveryTime',
    'arrivalMinutes',
    'duration',
  ];
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    if (typeof value === 'string') {
      const match = value.match(/(\d+(?:\.\d+)?)/);
      if (match) return Math.round(Number(match[1]));
    }
  }
  return undefined;
}

function findTotal(record: JsonRecord): number | undefined {
  const direct = firstMoney(record, [
    'totalCents',
    'payableCents',
    'payAmount',
    'totalAmount',
    'totalPrice',
    'total',
    'actualAmount',
    'amount',
    'price',
  ]);
  if (direct !== undefined) return direct;

  const product = firstMoney(record, [
    'productTotal',
    'productAmount',
    'goodsAmount',
    'subtotal',
    'originalAmount',
  ]);
  if (product === undefined) return undefined;

  const fees =
    (firstMoney(record, ['deliveryFee', 'deliveryPrice', 'deliveryAmount', 'shippingFee']) ??
      0) +
    (firstMoney(record, ['packagingFee', 'packingFee', 'packageFee']) ?? 0) +
    (firstMoney(record, ['tablewareFee']) ?? 0);
  const discount =
    firstMoney(record, [
      'discountCents',
      'discountAmount',
      'couponAmount',
      'couponDiscount',
      'discount',
    ]) ?? 0;

  return Math.max(0, product + fees - discount);
}

export function normalizeQuote(payload: unknown): PriceQuote {
  const data = unwrapData(payload);
  const record = isRecord(data) ? data : {};
  const totalCents = findTotal(record);
  if (totalCents === undefined) {
    throw new Error('无法从算价响应中识别应付金额');
  }

  const etaMinutes = parseEta(record);

  return {
    totalCents,
    productCents: firstMoney(record, [
      'productTotal',
      'productAmount',
      'productPrice',
      'productOriginalPrice',
      'goodsAmount',
      'subtotal',
      'originalAmount',
    ]),
    deliveryFeeCents: firstMoney(record, [
      'deliveryFee',
      'deliveryPrice',
      'deliveryAmount',
      'shippingFee',
    ]),
    packagingFeeCents: firstMoney(record, [
      'packagingFee',
      'packingFee',
      'packageFee',
    ]),
    discountCents: firstMoney(record, [
      'discountCents',
      'discountAmount',
      'couponAmount',
      'couponDiscount',
      'discount',
    ]),
    quoteId: firstString(record, ['quoteId', 'quote_id']),
    etaMinutes,
    etaSource: etaMinutes === undefined ? 'unknown' : 'api',
    raw: payload,
  };
}
