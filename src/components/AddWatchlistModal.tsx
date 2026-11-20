import React, { useState } from 'react';
import { X } from 'lucide-react';
import type {
  BanCoverage,
  CurrencyCode,
  FxSnapshot,
  ProductType,
  WatchlistItem,
} from '../types/arbitrage';
import { formatToman } from '../utils/formatters';

interface AddWatchlistModalProps {
  open: boolean;
  fx: FxSnapshot;
  onClose: () => void;
  onAdd: (item: Partial<WatchlistItem>) => Promise<void>;
}

export const AddWatchlistModal: React.FC<AddWatchlistModalProps> = ({
  open,
  fx,
  onClose,
  onAdd,
}) => {
  const [productType, setProductType] = useState<ProductType>('physical_tech');
  const [nameEn, setNameEn] = useState('');
  const [nameFa, setNameFa] = useState('');
  const [source, setSource] = useState('تکنولایف · فلش‌سیل');
  const [currency, setCurrency] = useState<CurrencyCode>('TOMAN');
  const [paymentNetwork, setPaymentNetwork] = useState('Shaparak');
  const [sourceCost, setSourceCost] = useState('2500000');
  const [networkFeeUsd, setNetworkFeeUsd] = useState('0');
  const [gatewayFeePct, setGatewayFeePct] = useState('0');
  const [beforeDiscount, setBeforeDiscount] = useState('3200000');
  const [marketBenchmark, setMarketBenchmark] = useState('3250000');
  const [banCoverage, setBanCoverage] = useState<BanCoverage>('supported');
  const [buyLink, setBuyLink] = useState('https://www.technolife.ir');
  const [isC2C, setIsC2C] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const parsedCost = Number(sourceCost) || 0;
  const parsedGas = Number(networkFeeUsd) || 0;
  const parsedFeePct = Number(gatewayFeePct) || 0;
  const parsedMarket = Number(marketBenchmark) || 0;
  const feeMul = 1 + parsedFeePct / 100;

  const estimatedTomanCost =
    currency === 'TOMAN'
      ? Math.round(parsedCost * feeMul)
      : currency === 'USDT' || currency === 'USDC'
        ? Math.round((parsedCost * feeMul + parsedGas) * fx.usdtToman)
        : Math.round((parsedCost * fx.cnyToUsd * feeMul + parsedGas) * fx.usdtToman);
  const estimatedProfit = parsedMarket - estimatedTomanCost;
  const estimatedMargin =
    estimatedTomanCost > 0 ? ((estimatedProfit / estimatedTomanCost) * 100).toFixed(1) : '0.0';

  const handleProductTypeSwitch = (next: ProductType) => {
    setProductType(next);
    if (next === 'consumer_subscription') {
      setCurrency('USDT');
      setPaymentNetwork('BSC/BEP20');
      setSource('AIPAY99 · BEP20');
      setSourceCost('20');
      setNetworkFeeUsd('0.15');
      setGatewayFeePct('0');
      setBeforeDiscount('');
      setMarketBenchmark('6500000');
      setBanCoverage('excluded');
      setBuyLink('https://aipay99.com/en/');
      setIsC2C(false);
    } else if (next === 'api_credit') {
      setCurrency('USDC');
      setPaymentNetwork('Base / Polygon');
      setSource('OpenRouter · USDC');
      setSourceCost('50');
      setNetworkFeeUsd('0.20');
      setGatewayFeePct('5.5');
      setBeforeDiscount('');
      setMarketBenchmark('17800000');
      setBanCoverage('supported');
      setBuyLink('https://openrouter.ai/pricing');
      setIsC2C(false);
    } else {
      setCurrency('TOMAN');
      setPaymentNetwork('Shaparak');
      setSource('تکنولایف · فلش‌سیل');
      setSourceCost('2500000');
      setNetworkFeeUsd('0');
      setGatewayFeePct('0');
      setBeforeDiscount('3200000');
      setMarketBenchmark('3250000');
      setBanCoverage('supported');
      setBuyLink('https://www.technolife.ir');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameEn.trim()) return;
    setSubmitting(true);
    try {
      await onAdd({
        productType,
        stream: productType === 'physical_tech' ? 'physical' : 'digital',
        nameEn: nameEn.trim(),
        nameFa: nameFa.trim() || nameEn.trim(),
        source: source.trim(),
        currency,
        paymentAsset: currency === 'TOMAN' ? 'TMN' : currency,
        paymentNetwork: paymentNetwork.trim(),
        sourceCost: parsedCost,
        networkFeeUsd: parsedGas,
        gatewayFeePct: parsedFeePct,
        priceBeforeDiscountToman: beforeDiscount.trim() ? Number(beforeDiscount) : null,
        declaredDiscountPct:
          beforeDiscount.trim() && Number(beforeDiscount) > estimatedTomanCost
            ? Math.round(
                ((Number(beforeDiscount) - estimatedTomanCost) / Number(beforeDiscount)) * 100,
              )
            : 0,
        marketBenchmarkToman: parsedMarket,
        banCoverage,
        buyLink: buyLink.trim() || 'https://www.technolife.ir',
        isC2C,
      });
      setNameEn('');
      setNameFa('');
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-lg border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">Add Tracked Opportunity</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          {/* Isolated 3-Track Product Type Selector */}
          <div className="grid grid-cols-3 gap-1 rounded-md bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => handleProductTypeSwitch('physical_tech')}
              className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                productType === 'physical_tech'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Physical Tech
            </button>
            <button
              type="button"
              onClick={() => handleProductTypeSwitch('consumer_subscription')}
              className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                productType === 'consumer_subscription'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Consumer AI Sub
            </button>
            <button
              type="button"
              onClick={() => handleProductTypeSwitch('api_credit')}
              className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                productType === 'api_credit'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              API Credit Gateway
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-slate-700">
              Product Title (English)
              <input
                type="text"
                required
                placeholder="e.g. Apple MagSafe Charger 25W"
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Persian Title (For Telegram Card)
              <input
                type="text"
                dir="rtl"
                placeholder="مثلاً شارژر مگ‌سیف اپل"
                value={nameFa}
                onChange={(e) => setNameFa(e.target.value)}
                className="font-persian mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block text-xs font-medium text-slate-700">
              Sourcing Feed
              <input
                type="text"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Currency Basis
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                <option value="TOMAN">Iranian Toman (TMN)</option>
                <option value="USDT">USDT (Crypto)</option>
                <option value="USDC">USDC (API Gateway)</option>
                <option value="CNY">Chinese Yuan (CNY)</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Payment Network
              <input
                type="text"
                value={paymentNetwork}
                onChange={(e) => setPaymentNetwork(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="block text-xs font-medium text-slate-700">
              Cost ({currency})
              <input
                type="number"
                step="any"
                required
                value={sourceCost}
                onChange={(e) => setSourceCost(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Market Median (TMN)
              <input
                type="number"
                step="10000"
                required
                value={marketBenchmark}
                onChange={(e) => setMarketBenchmark(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </label>
            {currency === 'TOMAN' ? (
              <label className="block text-xs font-medium text-slate-700">
                Pre-Discount (TMN)
                <input
                  type="number"
                  step="10000"
                  placeholder="Optional"
                  value={beforeDiscount}
                  onChange={(e) => setBeforeDiscount(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </label>
            ) : (
              <label className="block text-xs font-medium text-slate-700">
                Gas Fee (USD)
                <input
                  type="number"
                  step="0.05"
                  value={networkFeeUsd}
                  onChange={(e) => setNetworkFeeUsd(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </label>
            )}
            <label className="block text-xs font-medium text-slate-700">
              Ban Coverage
              <select
                value={banCoverage}
                onChange={(e) => setBanCoverage(e.target.value as BanCoverage)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                <option value="supported">Supported</option>
                <option value="excluded">Excluded</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 items-center">
            <label className="block text-xs font-medium text-slate-700">
              Purchase URL
              <input
                type="url"
                value={buyLink}
                onChange={(e) => setBuyLink(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </label>
            {productType === 'physical_tech' ? (
              <label className="mt-4 flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isC2C}
                  onChange={(e) => setIsC2C(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-slate-900"
                />
                Route &lt;40% Torob C2C to Manual Review
              </label>
            ) : (
              <label className="block text-xs font-medium text-slate-700">
                Gateway Checkout Fee (%)
                <input
                  type="number"
                  step="0.5"
                  value={gatewayFeePct}
                  onChange={(e) => setGatewayFeePct(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </label>
            )}
          </div>

          {/* Live Calculation Preview */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4 text-xs">
            <div className="text-slate-600">
              Landed Cost:{' '}
              <span className="font-mono tabular-nums font-medium text-slate-900">
                {formatToman(estimatedTomanCost)}
              </span>
            </div>
            <div className="text-slate-600">
              Est. Net Profit:{' '}
              <span
                className={`font-mono tabular-nums font-semibold ${
                  estimatedProfit >= 0 ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {estimatedProfit >= 0 ? '+' : ''}
                {formatToman(estimatedProfit)} ({estimatedMargin}%)
              </span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
            >
              {submitting ? 'Adding...' : 'Add to Radar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
