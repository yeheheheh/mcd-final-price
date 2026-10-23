import type {
  ComparisonQuery,
  ComparisonResult,
  Offer,
} from '../domain/types.js';

export interface RankOptions {
  query: ComparisonQuery;
  hourlyWageCents?: number;
  generatedAt?: string;
  dataSource?: 'demo' | 'live';
  warnings?: string[];
  collapseByStore?: boolean;
}

const WALKING_METERS_PER_MINUTE = 80;
const PICKUP_OVERHEAD_MINUTES = 5;
const DELIVERY_HANDOFF_MINUTES = 1;

function selectBestPerStore(offers: Offer[]): Offer[] {
  const best = new Map<string, Offer>();

  for (const offer of offers) {
    const key = `${offer.mode}:${offer.store.storeCode}`;
    const current = best.get(key);
    if (!current) {
      best.set(key, offer);
      continue;
    }

    const isCheaper = offer.quote.totalCents < current.quote.totalCents;
    const isTieButSimpler =
      offer.quote.totalCents === current.quote.totalCents &&
      offer.items.length < current.items.length;
    if (isCheaper || isTieButSimpler) best.set(key, offer);
  }

  return [...best.values()];
}

function enrichOffer(offer: Offer, hourlyWageCents?: number): Offer {
  let etaMinutes = offer.quote.etaMinutes ?? offer.etaMinutes;
  let etaSource = offer.quote.etaMinutes !== undefined ? 'api' : offer.etaSource;

  if (
    etaMinutes === undefined &&
    offer.mode === 'pickup' &&
    offer.store.distanceMeters !== undefined
  ) {
    etaMinutes =
      Math.ceil(offer.store.distanceMeters / WALKING_METERS_PER_MINUTE) +
      PICKUP_OVERHEAD_MINUTES;
    etaSource = 'estimated';
  }

  if (etaMinutes === undefined) etaSource = 'unknown';

  const occupiedMinutes =
    etaMinutes === undefined
      ? 0
      : offer.mode === 'delivery'
        ? Math.min(DELIVERY_HANDOFF_MINUTES, etaMinutes)
        : etaMinutes;
  const timeCostCents =
    hourlyWageCents === undefined
      ? 0
      : Math.round((occupiedMinutes / 60) * hourlyWageCents);

  return {
    ...offer,
    etaMinutes,
    etaSource,
    occupiedMinutes,
    timeCostCents,
    adjustedTotalCents: offer.quote.totalCents + timeCostCents,
  };
}

function compareByPrice(left: Offer, right: Offer): number {
  return left.quote.totalCents - right.quote.totalCents;
}

function compareByEta(left: Offer, right: Offer): number {
  return (left.etaMinutes ?? Number.POSITIVE_INFINITY) -
    (right.etaMinutes ?? Number.POSITIVE_INFINITY);
}

export function rankOffers(offers: Offer[], options: RankOptions): ComparisonResult {
  if (offers.length === 0) {
    throw new Error('没有可比较的方案');
  }

  const hourlyWageCents = options.hourlyWageCents ?? options.query.hourlyWageCents;
  const selected =
    options.collapseByStore === false ? offers : selectBestPerStore(offers);
  const enriched = selected.map((offer) => enrichOffer(offer, hourlyWageCents));

  const sorted = [...enriched].sort((left, right) => {
    const primaryLeft =
      hourlyWageCents === undefined ? left.quote.totalCents : left.adjustedTotalCents;
    const primaryRight =
      hourlyWageCents === undefined ? right.quote.totalCents : right.adjustedTotalCents;
    return (
      primaryLeft - primaryRight ||
      compareByPrice(left, right) ||
      compareByEta(left, right) ||
      left.id.localeCompare(right.id)
    );
  });

  const cheapest = [...enriched].sort(
    (left, right) =>
      compareByPrice(left, right) ||
      compareByEta(left, right) ||
      left.id.localeCompare(right.id),
  )[0];

  const fastest = enriched.some((offer) => offer.etaMinutes !== undefined)
    ? [...enriched].sort(
        (left, right) =>
          compareByEta(left, right) ||
          compareByPrice(left, right) ||
          left.id.localeCompare(right.id),
      )[0]
    : undefined;

  return {
    query: options.query,
    offers: sorted,
    winner: sorted[0],
    cheapest,
    fastest,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    dataSource: options.dataSource ?? 'live',
    warnings: options.warnings ?? [],
  };
}
