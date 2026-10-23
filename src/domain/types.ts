export type OrderMode = 'pickup' | 'delivery';

export type EtaSource = 'api' | 'estimated' | 'unknown';

export interface Store {
  storeCode: string;
  storeName: string;
  address?: string;
  distanceMeters?: number;
  beCode?: string;
}

export interface MenuItem {
  productCode: string;
  name: string;
  priceCents: number;
  available: boolean;
  isCombo: boolean;
}

export interface Coupon {
  couponId?: string;
  couponCode?: string;
  name: string;
  thresholdCents?: number;
  discountCents?: number;
  mode?: OrderMode;
  storeCode?: string;
  productCodes?: string[];
}

export interface PriceQuote {
  totalCents: number;
  productCents?: number;
  deliveryFeeCents?: number;
  packagingFeeCents?: number;
  discountCents?: number;
  quoteId?: string;
  etaMinutes?: number;
  etaSource: EtaSource;
  raw?: unknown;
}

export interface CandidateItem {
  productCode: string;
  name: string;
  quantity: number;
  unitPriceCents?: number;
}

export interface PriceCandidate {
  id: string;
  mode: OrderMode;
  store: Store;
  items: CandidateItem[];
  coupon?: Coupon;
  label: string;
  warnings: string[];
}

export interface Offer extends PriceCandidate {
  quote: PriceQuote;
  etaMinutes?: number;
  etaSource: EtaSource;
  occupiedMinutes?: number;
  timeCostCents: number;
  adjustedTotalCents: number;
}

export interface ComparisonQuery {
  intent: string;
  quantity: number;
  hourlyWageCents?: number;
  city?: string;
  keyword?: string;
}

export interface ComparisonResult {
  query: ComparisonQuery;
  offers: Offer[];
  winner: Offer;
  cheapest: Offer;
  fastest?: Offer;
  generatedAt: string;
  dataSource: 'demo' | 'live';
  warnings: string[];
}

export interface DeliveryAddress {
  addressId: string;
  label: string;
}
