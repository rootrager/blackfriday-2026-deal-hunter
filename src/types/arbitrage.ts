export type StreamType = 'physical' | 'digital';
export type CurrencyCode = 'TOMAN' | 'USDT' | 'CNY';

export type ValidationStatus =
  | 'verified_deal'
  | 'below_margin'
  | 'fake_discount'
  | 'scam_floor'
  | 'over_item_cap';

export interface WatchlistItem {
  id: string;
  nameEn: string;
  nameFa: string;
  stream: StreamType;
  category: string;
  source: string;
  sourcePlatform: 'digikala' | 'technolife' | 'divar' | 'aipay99' | 'suzhe' | 'wholesale';
  settlementType: string;
  currency: CurrencyCode;
  sourceCost: number;
  networkFeeUsd: number;
  priceBeforeDiscountToman: number | null;
  declaredDiscountPct: number;
  marketBenchmarkToman: number;
  buyLink: string;
  isC2C: boolean;
  notes?: string;
}

export interface EvaluatedDeal extends WatchlistItem {
  costInToman: number;
  costInUsd: number;
  netProfitToman: number;
  marginPct: number;
  maxUnitsWithinBudget: number;
  maxUnitsWithinCap: number;
  potentialTotalProfitToman: number;
  discountVerified: boolean;
  passesScamFloor: boolean;
  withinItemCap: boolean;
  withinBudget: boolean;
  passesMinMargin: boolean;
  isDeal: boolean;
  validationStatus: ValidationStatus;
  validationReason: string;
  isNewAlert: boolean;
  dedupeKey: string;
  telegramHtmlCard: string;
  telegramMarkdownCard: string;
}

export interface EngineConfig {
  budgetToman: number;
  maxItemCommitmentToman: number;
  minMarginPct: number;
  divarScamFloorRatio: number;
  dedupeWindowHours: number;
  useLiveUsdt: boolean;
  manualUsdtToman: number;
  cnyToUsdRate: number;
}

export interface FxSnapshot {
  usdtToman: number;
  usdFreeToman: number;
  cnyToUsd: number;
  cnyToman: number;
  source: 'wallex_live' | 'fallback_default' | 'manual_override';
  fetchedAt: string;
}

export interface ScanLogEntry {
  id: string;
  timestamp: string;
  usdtToman: number;
  totalScanned: number;
  verifiedDeals: number;
  rejectedFakeOrScam: number;
  newAlertsQueued: number;
}

export interface ArbitrageStateResponse {
  config: EngineConfig;
  fx: FxSnapshot;
  deals: EvaluatedDeal[];
  summary: {
    totalTracked: number;
    verifiedDealsCount: number;
    physicalDealsCount: number;
    digitalDealsCount: number;
    avgVerifiedMarginPct: number;
    bestDealMarginPct: number;
    bestDealName: string | null;
    deployableProfitPotentialToman: number;
    rejectedCount: number;
    dedupedActiveCount: number;
  };
  scanHistory: ScanLogEntry[];
}

export interface SupplierLead {
  id: string;
  name: string;
  url: string;
  type: 'subscription_storefront' | 'api_gateway';
  productsAndPricing: string;
  cryptoNetworks: string[];
  blackFridayStatus: string;
  riskTier: 'shortlisted' | 'caution' | 'not_recommended';
  riskLabel: string;
  authorizationNotes: string;
  assessment: string;
}

export interface MarketInsightItem {
  id: string;
  segment: 'Physical Tech' | 'AI Subscriptions' | 'Pricing Complaints';
  title: string;
  titleFa: string;
  summary: string;
  targetPriceBand: string;
  keyRisk: string;
}

export interface WorkflowAsset {
  id: string;
  title: string;
  filename: string;
  description: string;
  nodeCount: number;
  triggerSchedule: string;
  streamsCovered: string;
  json: Record<string, unknown>;
}
