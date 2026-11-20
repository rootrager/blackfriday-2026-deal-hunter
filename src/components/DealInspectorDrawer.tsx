import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Save,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import type { EvaluatedDeal, FxSnapshot } from '../types/arbitrage';
import {
  formatNativeCost,
  formatToman,
  getBanCoverageMeta,
  getGradeMeta,
  getProductTypeLabel,
} from '../utils/formatters';

interface DealInspectorDrawerProps {
  deal: EvaluatedDeal | null;
  fx: FxSnapshot;
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<EvaluatedDeal>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export const DealInspectorDrawer: React.FC<DealInspectorDrawerProps> = ({
  deal,
  fx,
  onClose,
  onUpdate,
  onDelete,
}) => {
  const [cardFormat, setCardFormat] = useState<'html' | 'markdown' | 'canonical'>('html');
  const [copied, setCopied] = useState(false);
  const [sourceCost, setSourceCost] = useState('');
  const [marketBenchmark, setMarketBenchmark] = useState('');
  const [beforeDiscount, setBeforeDiscount] = useState('');
  const [networkFee, setNetworkFee] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (deal) {
      setSourceCost(String(deal.sourceCost));
      setMarketBenchmark(String(deal.marketBenchmarkToman));
      setBeforeDiscount(
        deal.priceBeforeDiscountToman !== null ? String(deal.priceBeforeDiscountToman) : '',
      );
      setNetworkFee(String(deal.networkFeeUsd));
      setCopied(false);
    }
  }, [deal]);

  if (!deal) return null;

  const gradeMeta = getGradeMeta(deal.dealGrade);
  const banMeta = getBanCoverageMeta(deal.banCoverage);
  const activePayload =
    cardFormat === 'html'
      ? deal.telegramHtmlCard
      : cardFormat === 'markdown'
        ? deal.telegramMarkdownCard
        : JSON.stringify(deal.canonicalSignal, null, 2);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activePayload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onUpdate(deal.id, {
        sourceCost: Number(sourceCost) || deal.sourceCost,
        marketBenchmarkToman: Number(marketBenchmark) || deal.marketBenchmarkToman,
        priceBeforeDiscountToman: beforeDiscount.trim() ? Number(beforeDiscount) : null,
        networkFeeUsd: Number(networkFee) || 0,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>{getProductTypeLabel(deal.productType)}</span>
              <span aria-hidden="true">·</span>
              <span className={`font-semibold ${gradeMeta.textClass}`}>{gradeMeta.label}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-[11px]">{deal.canonicalSignal.tracking_id}</span>
            </div>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">{deal.nameEn}</h2>
            <p className="font-persian mt-0.5 text-sm text-slate-600" dir="rtl">
              {deal.nameFa}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
            className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8">
          {/* Anti-Fraud & Warranty Audit */}
          <section>
            <h3 className="text-sm font-semibold text-slate-900">
              Anti-Fraud, Liquidity & Warranty Audit (Phase 5)
            </h3>
            <p className="mt-1 text-xs text-slate-600">{deal.validationReason}</p>
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-y border-slate-200 py-4 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Discount Guard (V2)</span>
                <span
                  className={`inline-flex items-center gap-1 font-medium ${
                    deal.discountVerified ? 'text-emerald-700' : 'text-red-700'
                  }`}
                >
                  {deal.discountVerified ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <ShieldAlert className="h-3.5 w-3.5" />
                  )}
                  {deal.discountVerified ? 'Verified' : 'Fake Promo'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Divar &lt;40% Filter (V3)</span>
                <span
                  className={`inline-flex items-center gap-1 font-medium ${
                    deal.passesScamFloor ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {deal.passesScamFloor ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <ShieldAlert className="h-3.5 w-3.5" />
                  )}
                  {deal.isC2C ? (deal.passesScamFloor ? 'Passed' : 'Manual Review') : 'N/A'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Liquidity Cap (V4)</span>
                <span
                  className={`font-medium ${
                    deal.withinItemCap ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {deal.withinItemCap ? 'Within Cap' : 'Exceeds Cap'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Ban Coverage (V7)</span>
                <span className={`font-medium ${banMeta.textClass}`}>{banMeta.label}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Delivery Method</span>
                <span className="font-medium text-slate-800">{deal.deliveryMethod}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Payment Rail (V5)</span>
                <span className="font-mono text-slate-800">
                  {deal.paymentAsset} · {deal.paymentNetwork}
                </span>
              </div>
            </div>
          </section>

          {/* Financial Breakdown */}
          <section>
            <h3 className="text-sm font-semibold text-slate-900">Quantitative Math (Phase 6)</h3>
            <dl className="mt-3 divide-y divide-slate-100 border-y border-slate-200 text-sm">
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-slate-500">Native Source Price</dt>
                <dd className="font-mono tabular-nums text-slate-900">
                  {formatNativeCost(
                    deal.sourceCost,
                    deal.currency,
                    deal.networkFeeUsd,
                    deal.gatewayFeePct,
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-slate-500">
                  Total Landed Cost (USDT @ {fx.usdtToman.toLocaleString('en-US')})
                </dt>
                <dd className="font-mono tabular-nums font-medium text-slate-900">
                  {formatToman(deal.costInToman)}
                </dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-slate-500">Market Benchmark (Torob / Retail)</dt>
                <dd className="font-mono tabular-nums text-slate-900">
                  {formatToman(deal.marketBenchmarkToman)}
                </dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-slate-500">Net Unit Profit & ROI</dt>
                <dd
                  className={`font-mono tabular-nums font-semibold ${
                    deal.netProfitToman >= 0 ? 'text-emerald-700' : 'text-red-700'
                  }`}
                >
                  {deal.netProfitToman >= 0 ? '+' : ''}
                  {formatToman(deal.netProfitToman)} ({deal.marginPct}%)
                </dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-slate-500">Budget Capacity (100M / Cap)</dt>
                <dd className="font-mono tabular-nums text-slate-900">
                  {deal.maxUnitsWithinBudget} total · {deal.maxUnitsWithinCap} capped
                </dd>
              </div>
            </dl>
          </section>

          {/* Live Price Editor */}
          <section>
            <h3 className="text-sm font-semibold text-slate-900">Adjust Pricing Parameters</h3>
            <form onSubmit={handleSave} className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs text-slate-600">
                  Source Cost ({deal.currency})
                  <input
                    type="number"
                    step="any"
                    value={sourceCost}
                    onChange={(e) => setSourceCost(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </label>
                <label className="block text-xs text-slate-600">
                  Market Benchmark (TMN)
                  <input
                    type="number"
                    step="10000"
                    value={marketBenchmark}
                    onChange={(e) => setMarketBenchmark(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </label>
                {deal.currency === 'TOMAN' ? (
                  <label className="block text-xs text-slate-600">
                    Price Before Discount (TMN)
                    <input
                      type="number"
                      step="10000"
                      placeholder="Optional"
                      value={beforeDiscount}
                      onChange={(e) => setBeforeDiscount(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                    />
                  </label>
                ) : (
                  <label className="block text-xs text-slate-600">
                    Network Gas Fee (USD)
                    <input
                      type="number"
                      step="0.05"
                      value={networkFee}
                      onChange={(e) => setNetworkFee(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                    />
                  </label>
                )}
                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
                  >
                    <Save className="h-4 w-4" />
                    {saving ? 'Updating...' : 'Recalculate'}
                  </button>
                </div>
              </div>
            </form>
          </section>

          {/* Telegram Alert & Canonical Schema Preview */}
          <section>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">
                Dispatch Payload & Canonical Schema
              </h3>
              <div className="flex items-center gap-1 rounded-md bg-slate-100 p-0.5">
                <button
                  type="button"
                  onClick={() => setCardFormat('html')}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    cardFormat === 'html'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  n8n HTML
                </button>
                <button
                  type="button"
                  onClick={() => setCardFormat('markdown')}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    cardFormat === 'markdown'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Hermes Text
                </button>
                <button
                  type="button"
                  onClick={() => setCardFormat('canonical')}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    cardFormat === 'canonical'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Canonical JSON
                </button>
              </div>
            </div>

            {cardFormat === 'canonical' ? (
              <pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-slate-200 bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-100">
                {activePayload}
              </pre>
            ) : (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <pre
                  dir="rtl"
                  className="font-persian whitespace-pre-wrap text-right text-xs leading-6 text-slate-800"
                >
                  {activePayload}
                </pre>
              </div>
            )}

            <div className="mt-3 flex items-center justify-between gap-3">
              <a
                href={deal.buyLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                Open Source URL
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied Payload' : 'Copy Payload'}
              </button>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4">
          <button
            type="button"
            onClick={async () => {
              await onDelete(deal.id);
              onClose();
            }}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 whitespace-nowrap"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove from Watchlist
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
