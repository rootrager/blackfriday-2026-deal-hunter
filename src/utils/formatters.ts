import type {
  BanCoverage,
  CurrencyCode,
  DealGrade,
  ProductType,
  ValidationStatus,
} from '../types/arbitrage';

export function formatToman(value: number): string {
  return `${Math.round(value).toLocaleString('en-US')} TMN`;
}

export function formatTomanShort(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000_000) {
    return `${sign}${(abs / 1_000_000_000).toFixed(2)}B TMN`;
  }
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(2)}M TMN`;
  }
  return `${sign}${Math.round(abs).toLocaleString('en-US')} TMN`;
}

export function formatNativeCost(
  amount: number,
  currency: CurrencyCode,
  networkFeeUsd: number,
  gatewayFeePct = 0,
): string {
  if (currency === 'TOMAN') {
    return `${Math.round(amount).toLocaleString('en-US')} TMN`;
  }
  const feeParts: string[] = [];
  if (gatewayFeePct > 0) feeParts.push(`+${gatewayFeePct}% fee`);
  if (networkFeeUsd > 0) feeParts.push(`+$${networkFeeUsd.toFixed(2)} gas`);
  const suffix = feeParts.length ? ` (${feeParts.join(', ')})` : '';
  if (currency === 'USDT' || currency === 'USDC') {
    return `${amount.toFixed(2)} ${currency}${suffix}`;
  }
  return `¥${amount.toFixed(0)} CNY${suffix}`;
}

export function formatTimeAgo(iso: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

export function getProductTypeLabel(type: ProductType): string {
  switch (type) {
    case 'physical_tech':
      return 'Physical Tech';
    case 'consumer_subscription':
      return 'Consumer AI Sub';
    case 'api_credit':
      return 'API Credit';
  }
}

export function getBanCoverageMeta(cov: BanCoverage): { label: string; textClass: string } {
  switch (cov) {
    case 'supported':
      return { label: 'Warranty OK', textClass: 'text-emerald-700' };
    case 'excluded':
      return { label: 'Ban Excluded', textClass: 'text-amber-700' };
    case 'unknown':
      return { label: 'Ban Unverified', textClass: 'text-slate-500' };
  }
}

export function getGradeMeta(grade: DealGrade): { label: string; textClass: string } {
  switch (grade) {
    case 'A+':
      return { label: 'Grade A+ (Golden)', textClass: 'text-emerald-700' };
    case 'A':
      return { label: 'Grade A', textClass: 'text-slate-900' };
    case 'MANUAL_REVIEW':
      return { label: 'Manual Review', textClass: 'text-amber-700' };
    case 'DROP':
      return { label: 'Dropped', textClass: 'text-red-700' };
  }
}

export function getValidationMeta(status: ValidationStatus): {
  label: string;
  textClass: string;
} {
  switch (status) {
    case 'verified_deal':
      return { label: 'Verified Deal', textClass: 'text-emerald-700' };
    case 'below_margin':
      return { label: 'Below Margin', textClass: 'text-amber-700' };
    case 'fake_discount':
      return { label: 'Fake Discount', textClass: 'text-red-700' };
    case 'manual_review':
      return { label: 'Manual Review (<40%)', textClass: 'text-amber-700' };
    case 'over_item_cap':
      return { label: 'Over Cap', textClass: 'text-amber-700' };
  }
}
