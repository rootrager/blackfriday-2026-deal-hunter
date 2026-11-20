import type { CurrencyCode, ValidationStatus } from '../types/arbitrage';

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

export function formatNativeCost(amount: number, currency: CurrencyCode, networkFeeUsd: number): string {
  if (currency === 'TOMAN') {
    return `${Math.round(amount).toLocaleString('en-US')} TMN`;
  }
  if (currency === 'USDT') {
    const feeText = networkFeeUsd > 0 ? ` + $${networkFeeUsd.toFixed(2)} gas` : '';
    return `${amount.toFixed(2)} USDT${feeText}`;
  }
  const feeText = networkFeeUsd > 0 ? ` + $${networkFeeUsd.toFixed(2)}` : '';
  return `¥${amount.toFixed(0)} CNY${feeText}`;
}

export function formatTimeAgo(iso: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
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
    case 'scam_floor':
      return { label: 'Scam Floor', textClass: 'text-red-700' };
    case 'over_item_cap':
      return { label: 'Over 35M Cap', textClass: 'text-amber-700' };
  }
}
