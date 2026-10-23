import type {
  CandidateItem,
  Coupon,
  MenuItem,
  OrderMode,
  PriceCandidate,
  Store,
} from '../domain/types.js';

export interface BuildCandidatesInput {
  store: Store;
  mode: OrderMode;
  menu: MenuItem[];
  coupons: Coupon[];
  intent: string;
  quantity?: number;
  maxCandidates?: number;
  maxAddonGapCents?: number;
}

export interface BuildCandidatesResult {
  candidates: PriceCandidate[];
  warnings: string[];
  matchedItem?: MenuItem;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/麦当劳|麦麦|mcdonald'?s?/g, '')
    .replace(/[\s，。、,.!！?？\-—_（）()【】[\]·]/g, '');
}

function bigrams(value: string): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    result.add(value.slice(index, index + 2));
  }
  return result;
}

function similarity(left: string, right: string): number {
  const a = bigrams(left);
  const b = bigrams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

function matchScore(name: string, intent: string): number | undefined {
  const normalizedName = normalizeText(name);
  const normalizedIntent = normalizeText(intent);
  if (!normalizedName || !normalizedIntent) return undefined;
  if (normalizedName === normalizedIntent) return 0;
  if (
    normalizedName.includes(normalizedIntent) ||
    normalizedIntent.includes(normalizedName)
  ) {
    return 1;
  }
  if (similarity(normalizedName, normalizedIntent) >= 0.5) return 2;
  return undefined;
}

export function matchMenuItem(menu: MenuItem[], intent: string): MenuItem | undefined {
  const matches = menu
    .filter((item) => item.available)
    .map((item) => ({ item, score: matchScore(item.name, intent) }))
    .filter(
      (entry): entry is { item: MenuItem; score: number } => entry.score !== undefined,
    )
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.item.priceCents - right.item.priceCents ||
        left.item.productCode.localeCompare(right.item.productCode),
    );

  return matches[0]?.item;
}

interface AddonChoice {
  item: MenuItem;
  quantity: number;
  costCents: number;
}

function findAddon(
  menu: MenuItem[],
  excludedProductCode: string,
  gapCents: number,
  maxQuantity: number,
): AddonChoice | undefined {
  const choices = menu
    .filter(
      (item) =>
        item.available &&
        item.productCode !== excludedProductCode &&
        item.priceCents > 0,
    )
    .map((item) => {
      const quantity = Math.ceil(gapCents / item.priceCents);
      return { item, quantity, costCents: quantity * item.priceCents };
    })
    .filter((choice) => choice.quantity <= maxQuantity && choice.costCents >= gapCents)
    .sort(
      (left, right) =>
        left.costCents - right.costCents ||
        left.quantity - right.quantity ||
        left.item.priceCents - right.item.priceCents ||
        left.item.productCode.localeCompare(right.item.productCode),
    );

  return choices[0];
}

function couponKey(coupon: Coupon): string {
  return coupon.couponId ?? coupon.couponCode ?? coupon.name;
}

function buildCandidateId(
  mode: OrderMode,
  store: Store,
  coupon: Coupon | undefined,
  items: CandidateItem[],
): string {
  const itemKey = items
    .map((item) => `${item.productCode}x${item.quantity}`)
    .sort()
    .join('+');
  return `${mode}:${store.storeCode}:${coupon ? couponKey(coupon) : 'none'}:${itemKey}`;
}

export function buildCandidates(input: BuildCandidatesInput): BuildCandidatesResult {
  const quantity = Math.max(1, Math.floor(input.quantity ?? 1));
  const matchedItem = matchMenuItem(input.menu, input.intent);

  if (!matchedItem) {
    return {
      candidates: [],
      warnings: [`未找到与“${input.intent}”匹配的在售商品`],
    };
  }

  const maxCandidates = Math.max(1, input.maxCandidates ?? 8);
  const maxAddonGapCents = Math.max(0, input.maxAddonGapCents ?? 1000);
  const baselineItem: CandidateItem = {
    productCode: matchedItem.productCode,
    name: matchedItem.name,
    quantity,
    unitPriceCents: matchedItem.priceCents,
  };
  const baselineSubtotal = matchedItem.priceCents * quantity;
  const warnings: string[] = [];

  const candidates: PriceCandidate[] = [
    {
      id: buildCandidateId(input.mode, input.store, undefined, [baselineItem]),
      mode: input.mode,
      store: input.store,
      items: [baselineItem],
      label: '标准价',
      warnings: [],
    },
  ];

  const eligibleCoupons = input.coupons
    .filter((coupon) => !coupon.mode || coupon.mode === input.mode)
    .filter(
      (coupon) => !coupon.storeCode || coupon.storeCode === input.store.storeCode,
    )
    .filter(
      (coupon) =>
        !coupon.productCodes?.length ||
        coupon.productCodes.includes(matchedItem.productCode),
    )
    .sort(
      (left, right) =>
        (right.discountCents ?? 0) - (left.discountCents ?? 0) ||
        left.name.localeCompare(right.name),
    );

  for (const coupon of eligibleCoupons) {
    const threshold = coupon.thresholdCents;
    if (threshold !== undefined && baselineSubtotal < threshold) {
      const gapCents = threshold - baselineSubtotal;
      if (gapCents > maxAddonGapCents) {
        warnings.push(
          `「${coupon.name}」还差 ¥${(gapCents / 100).toFixed(2)}，超过凑单阈值，已跳过`,
        );
        continue;
      }

      const addon = findAddon(
        input.menu,
        matchedItem.productCode,
        gapCents,
        3,
      );
      if (!addon) {
        warnings.push(`「${coupon.name}」差 ¥${(gapCents / 100).toFixed(2)}，没有合适凑单品`);
        continue;
      }

      const items: CandidateItem[] = [
        baselineItem,
        {
          productCode: addon.item.productCode,
          name: addon.item.name,
          quantity: addon.quantity,
          unitPriceCents: addon.item.priceCents,
        },
      ];
      candidates.push({
        id: buildCandidateId(input.mode, input.store, coupon, items),
        mode: input.mode,
        store: input.store,
        items,
        coupon,
        label: `凑单：${coupon.name}`,
        warnings: [
          `为触发「${coupon.name}」加购 ${addon.item.name} ×${addon.quantity}`,
        ],
      });
      continue;
    }

    candidates.push({
      id: buildCandidateId(input.mode, input.store, coupon, [baselineItem]),
      mode: input.mode,
      store: input.store,
      items: [baselineItem],
      coupon,
      label: `用券：${coupon.name}`,
      warnings: [],
    });
  }

  const seen = new Set<string>();
  const deduped = candidates.filter((candidate) => {
    if (seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return true;
  });

  return {
    candidates: deduped.slice(0, maxCandidates),
    warnings,
    matchedItem,
  };
}
