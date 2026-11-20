import React, { useState } from 'react';
import { ExternalLink, ShieldAlert } from 'lucide-react';
import type { MarketInsightItem, SupplierLead } from '../types/arbitrage';

interface ResearchData {
  checkedDate: string;
  campaignDates: { blackFriday: string; cyberMonday: string };
  suppliers: SupplierLead[];
  marketInsights: MarketInsightItem[];
  safeguards: string[];
}

interface ResearchIntelViewProps {
  research: ResearchData | null;
  loading: boolean;
}

export const ResearchIntelView: React.FC<ResearchIntelViewProps> = ({ research, loading }) => {
  const [filterType, setFilterType] = useState<'all' | 'subscription_storefront' | 'api_gateway'>('all');

  if (loading || !research) {
    return (
      <div className="space-y-4">
        <div className="h-7 w-64 animate-pulse rounded bg-slate-200" />
        <div className="h-64 animate-pulse rounded-lg border border-slate-200 bg-white" />
      </div>
    );
  }

  const visibleSuppliers = research.suppliers.filter((s) =>
    filterType === 'all' ? true : s.type === filterType,
  );

  const riskColor = (tier: SupplierLead['riskTier']) => {
    if (tier === 'shortlisted') return 'text-emerald-700';
    if (tier === 'caution') return 'text-amber-700';
    return 'text-red-700';
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Supplier Vetting & Market Intelligence
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Field research verified {research.checkedDate} covering crypto-settled digital suppliers, API gateways, and Tehran Black Friday 2026 consumer demand.
          </p>
        </div>
        <div className="text-xs text-slate-500 whitespace-nowrap">
          Black Friday: <span className="font-mono text-slate-800">{research.campaignDates.blackFriday}</span>
          <span className="mx-2 text-slate-300">·</span>
          Cyber Monday: <span className="font-mono text-slate-800">{research.campaignDates.cyberMonday}</span>
        </div>
      </div>

      {/* Supplier Vetting Table */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Crypto-Settled Suppliers & API Gateways
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Treat all storefronts as unvetted sourcing leads until written regional eligibility and refund terms are confirmed.
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setFilterType('all')}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                filterType === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All ({research.suppliers.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterType('subscription_storefront')}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                filterType === 'subscription_storefront'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Subscriptions
            </button>
            <button
              type="button"
              onClick={() => setFilterType('api_gateway')}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                filterType === 'api_gateway'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              API Gateways
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                <th className="px-6 py-3">Provider</th>
                <th className="px-4 py-3">Advertised Pricing & Scope</th>
                <th className="px-4 py-3">Crypto Networks</th>
                <th className="px-4 py-3">Vetting Status</th>
                <th className="px-6 py-3">Risk & Action Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleSuppliers.map((sup) => (
                <tr key={sup.id} className="align-top hover:bg-slate-50/70">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <a
                      href={sup.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-slate-900 hover:underline"
                    >
                      {sup.name}
                      <ExternalLink className="h-3 w-3 text-slate-400" />
                    </a>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {sup.type === 'subscription_storefront' ? 'Storefront' : 'API Gateway'}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-xs leading-5 text-slate-700 max-w-xs">
                    {sup.productsAndPricing}
                  </td>
                  <td className="px-4 py-4 font-mono text-xs text-slate-700">
                    {sup.cryptoNetworks.join(' / ')}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className={`text-xs font-semibold ${riskColor(sup.riskTier)}`}>
                      {sup.riskLabel}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">{sup.blackFridayStatus}</div>
                  </td>
                  <td className="px-6 py-4 text-xs leading-5 text-slate-600 max-w-sm">
                    {sup.assessment}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Persian Market Demand Insights */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">
            Tehran Black Friday 2026 Demand Signals
          </h2>
          <div className="mt-4 divide-y divide-slate-100">
            {research.marketInsights.map((insight) => (
              <div key={insight.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="text-sm font-semibold text-slate-900">{insight.title}</h3>
                  <span className="font-mono text-xs text-slate-500 whitespace-nowrap">
                    {insight.targetPriceBand}
                  </span>
                </div>
                <p className="font-persian mt-0.5 text-xs text-slate-500" dir="rtl">
                  {insight.titleFa}
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-600">{insight.summary}</p>
                <p className="mt-1.5 text-xs text-amber-800">Key watchpoint: {insight.keyRisk}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Iran-Specific & Wallet Safeguards */}
        <div className="rounded-lg border border-slate-200 bg-white p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-700" />
              <h2 className="text-base font-semibold text-slate-900">
                Payment & Regional Operational Safeguards
              </h2>
            </div>
            <ul className="mt-4 space-y-3 text-xs leading-5 text-slate-700">
              {research.safeguards.map((rule, idx) => (
                <li key={idx} className="flex gap-3 border-b border-slate-100 pb-3 last:border-b-0">
                  <span className="font-mono text-slate-400">0{idx + 1}.</span>
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-6 border-t border-slate-200 pt-4 text-xs text-slate-600">
            <span className="font-semibold text-slate-900">Operator Boundary (Hermes Protocol):</span>{' '}
            This radar discovers, validates, and formats arbitrage opportunities only. Final purchase execution and wallet signing remain strictly manual with the trader.
          </div>
        </div>
      </section>
    </div>
  );
};
