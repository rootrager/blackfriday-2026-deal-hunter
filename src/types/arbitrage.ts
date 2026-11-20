export type StreamType = 'physical' | 'digital';
export type ProductType = 'physical_tech' | 'consumer_subscription' | 'api_credit';
export type CurrencyCode = 'TOMAN' | 'USDT' | 'USDC' | 'CNY';
export type BanCoverage = 'supported' | 'excluded' | 'unknown';
export type PromotionStatus = 'verified_bf' | 'standard_price' | 'not_found' | 'fake_promo';
export type DealGrade = 'A+' | 'A' | 'MANUAL_REVIEW' | 'DROP';

export type ValidationStatus =
  | 'verified_deal'
  | 'below_margin'
  | 'fake_discount'
  | 'manual_review'
  | 'over_item_cap';

export interface WatchlistItem {
  id: string;
  nameEn: string;
  nameFa: string;
  stream: StreamType;
  productType: ProductType;
  category: string;
  source: string;
  sourcePlatform:
    | 'digikala'
    | 'technolife'
    | 'divar'
    | 'aipay99'
    | 'suzhe'
    | 'openrouter'
    | 'teamorouter'
    | 'wholesale';
  settlementType: string;
  paymentAsset: string;
  paymentNetwork: string;
  currency: CurrencyCode;
  sourceCost: number;
  networkFeeUsd: number;
  gatewayFeePct?: number;
  priceBeforeDiscountToman: number | null;
  declaredDiscountPct: number;
  marketBenchmarkToman: number;
  buyLink: string;
  isC2C: boolean;
  deliveryMethod: string;
  banCoverage: BanCoverage;
  promotionStatus: PromotionStatus;
  notes?: string;
}

export interface CanonicalDealSignal {
  tracking_id: string;
  product_type: ProductType;
  name_fa: string;
  source_name: string;
  source_url: string;
  payment_asset: string;
  payment_network: string;
  currency_basis: CurrencyCode;
  raw_cost: number;
  network_gas_usd: number;
  exchange_rate_toman: number;
  total_cost_toman: number;
  market_benchmark_toman: number;
  net_profit_toman: number;
  margin_pct: number;
  roi_pct: number;
  delivery_method: string;
  ban_coverage: BanCoverage;
  promotion_status: PromotionStatus;
  manual_review_required: boolean;
  deal_grade: DealGrade;
  budget_capacity_units: number;
}

export interface EvaluatedDeal extends WatchlistItem {
  costInToman: number;
  costInUsd: number;
  netProfitToman: number;
  marginPct: number;
  roiPct: number;
  dealGrade: DealGrade;
  manualReviewRequired: boolean;
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
  canonicalSignal: CanonicalDealSignal;
  telegramHtmlCard: string;
  telegramMarkdownCard: string;
}

export interface EngineConfig {
  budgetToman: number;
  maxItemCommitmentToman: number;
  minMarginPct: number;
  goldenMarginPct: number;
  divarScamFloorRatio: number;
  dedupeWindowHours: number;
  useLiveUsdt: boolean;
  manualUsdtToman: number;
  cnyToUsdRate: number;
}

export interface FxSnapshot {
  usdtToman: number;
  usdFreeToman: number;
  eurToman: number;
  aedToman: number;
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
  goldenDeals: number;
  manualReviewCount: number;
  rejectedFakeOrCap: number;
  newAlertsQueued: number;
}

export interface ArbitrageStateResponse {
  config: EngineConfig;
  fx: FxSnapshot;
  deals: EvaluatedDeal[];
  summary: {
    totalTracked: number;
    verifiedDealsCount: number;
    goldenDealsCount: number;
    standardDealsCount: number;
    manualReviewCount: number;
    physicalDealsCount: number;
    consumerSubDealsCount: number;
    apiCreditDealsCount: number;
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

export interface WorkflowPhaseInfo {
  phase: number;
  code: string;
  title: string;
  titleFa: string;
  nodeCount: number;
  nodes: Array<{ id: string; name: string; type: string; role: string }>;
}

export interface WorkflowAsset {
  id: string;
  title: string;
  filename: string;
  description: string;
  nodeCount: number;
  triggerSchedule: string;
  streamsCovered: string;
  phases?: WorkflowPhaseInfo[];
  json: Record<string, unknown>;
}
