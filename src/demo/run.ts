import { readFileSync } from 'node:fs';
import { buildCandidates } from '../compare/candidates.js';
import { rankOffers } from '../compare/rank.js';
import type {
  ComparisonQuery,
  ComparisonResult,
  Coupon,
  MenuItem,
  Offer,
  OrderMode,
  PriceCandidate,
  PriceQuote,
  Store,
} from '../domain/types.js';

interface DemoEntry {
  mode: OrderMode;
  store: Store;
  menu: MenuItem[];
  coupons: Coupon[];
}

interface DemoScenario {
  query: ComparisonQuery;
  generatedAt: string;
  entries: DemoEntry[];
}

function loadScenario(): DemoScenario {
  const content = readFileSync(new URL('./scenario.json', import.meta.url), 'utf8');
  return JSON.parse(content) as DemoScenario;
}

function demoPricer(candidate: PriceCandidate): PriceQuote {
  const subtotal = candidate.items.reduce(
    (sum, item) => sum + (item.unitPriceCents ?? 0) * item.quantity,
    0,
  );
  const deliveryFeeCents = candidate.mode === 'delivery' ? 600 : 0;
  const packagingFeeCents = candidate.mode === 'delivery' ? 100 : 0;
  const thresholdMet =
    candidate.coupon?.thresholdCents === undefined ||
    subtotal >= candidate.coupon.thresholdCents;
  const discountCents =
    candidate.coupon?.discountCents !== undefined && thresholdMet
      ? candidate.coupon.discountCents
      : 0;
  const totalCents = Math.max(
    0,
    subtotal + deliveryFeeCents + packagingFeeCents - discountCents,
  );

  return {
    totalCents,
    productCents: subtotal,
    deliveryFeeCents,
    packagingFeeCents,
    discountCents,
    quoteId: `demo-${candidate.id}`,
    etaMinutes: candidate.mode === 'delivery' ? 35 : undefined,
    etaSource: candidate.mode === 'delivery' ? 'api' : 'unknown',
    raw: { demo: true },
  };
}

export interface DemoOptions {
  hourlyWageCents?: number;
}

export function runDemo(options: DemoOptions = {}): ComparisonResult {
  const scenario = loadScenario();
  const warnings: string[] = [];
  const offers: Offer[] = [];

  for (const entry of scenario.entries) {
    const built = buildCandidates({
      store: entry.store,
      mode: entry.mode,
      menu: entry.menu,
      coupons: entry.coupons,
      intent: scenario.query.intent,
      quantity: scenario.query.quantity,
    });

    warnings.push(
      ...built.warnings.map((warning) => `${entry.store.storeName}：${warning}`),
    );

    for (const candidate of built.candidates) {
      const quote = demoPricer(candidate);
      offers.push({
        ...candidate,
        quote,
        etaMinutes: quote.etaMinutes,
        etaSource: quote.etaSource,
        timeCostCents: 0,
        adjustedTotalCents: quote.totalCents,
      });
    }
  }

  return rankOffers(offers, {
    query: {
      ...scenario.query,
      hourlyWageCents: options.hourlyWageCents,
    },
    hourlyWageCents: options.hourlyWageCents,
    generatedAt: scenario.generatedAt,
    dataSource: 'demo',
    warnings,
  });
}
