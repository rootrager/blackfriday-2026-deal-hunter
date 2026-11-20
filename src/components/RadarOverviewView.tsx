import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpDown,
  CheckCircle2,
  Eye,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react';
import type {
  ArbitrageStateResponse,
  EngineConfig,
  EvaluatedDeal,
} from '../types/arbitrage';
import {
  formatNativeCost,
  formatTimeAgo,
  formatToman,
  formatTomanShort,
  getBanCoverageMeta,
  getGradeMeta,
  getProductTypeLabel,
  getValidationMeta,
} from '../utils/formatters';

interface RadarOverviewViewProps {
  state: ArbitrageStateResponse;
  onSelectDeal: (deal: EvaluatedDeal) => void;
  onOpenAddModal: () => void;
  onUpdateConfig: (patch: Partial<EngineConfig>) => Promise<void>;
  onClearDedupe: () => Promise<void>;
}

type FilterTab =
  | 'all'
  | 'verified'
  | 'physical_tech'
  | 'consumer_subscription'
  | 'api_credit'
  | 'manual_review'
  | 'dropped';
type SortField = 'margin' | 'profit' | 'cost';

export const RadarOverviewView: React.FC<RadarOverviewViewProps> = ({
  state,
  onSelectDeal,
  onOpenAddModal,
  onUpdateConfig,
  onClearDedupe,
}) => {
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('margin');
  const [sortAsc, setSortAsc] = useState(false);
  const [showControls, setShowControls] = useState(false);

  const [budgetM, setBudgetM] = useState(String(Math.round(state.config.budgetToman / 1_000_000)));
  const [capM, setCapM] = useState(
    String(Math.round(state.config.maxItemCommitmentToman / 1_000_000)),
  );
  const [minMargin, setMinMargin] = useState(String(state.config.minMarginPct));
  const [goldenMargin, setGoldenMargin] = useState(String(state.config.goldenMarginPct));
  const [usdtOverride, setUsdtOverride] = useState(String(state.fx.usdtToman));
  const [useLiveUsdt, setUseLiveUsdt] = useState(state.config.useLiveUsdt);
  const [applyingConfig, setApplyingConfig] = useState(false);

  useEffect(() => {
    setBudgetM(String(Math.round(state.config.budgetToman / 1_000_000)));
    setCapM(String(Math.round(state.config.maxItemCommitmentToman / 1_000_000)));
    setMinMargin(String(state.config.minMarginPct));
    setGoldenMargin(String(state.config.goldenMarginPct));
    setUseLiveUsdt(state.config.useLiveUsdt);
    setUsdtOverride(String(state.config.useLiveUsdt ? state.fx.usdtToman : state.config.manualUsdtToman));
  }, [state.config, state.fx.usdtToman]);

  const filteredDeals = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = state.deals.filter((deal) => {
      if (filterTab === 'verified' && !deal.isDeal) return false;
      if (filterTab === 'physical_tech' && deal.productType !== 'physical_tech') return false;
      if (filterTab === 'consumer_subscription' && deal.productType !== 'consumer_subscription')
        return false;
      if (filterTab === 'api_credit' && deal.productType !== 'api_credit') return false;
      if (filterTab === 'manual_review' && !deal.manualReviewRequired) return false;
      if (filterTab === 'dropped' && (deal.isDeal || deal.manualReviewRequired)) return false;
      if (!q) return true;
      return (
        deal.nameEn.toLowerCase().includes(q) ||
        deal.nameFa.toLowerCase().includes(q) ||
        deal.source.toLowerCase().includes(q) ||
        deal.category.toLowerCase().includes(q) ||
        deal.paymentNetwork.toLowerCase().includes(q)
      );
    });

    return [...list].sort((a, b) => {
      const mul = sortAsc ? 1 : -1;
      if (sortField === 'margin') return (a.marginPct - b.marginPct) * mul;
      if (sortField === 'profit') return (a.netProfitToman - b.netProfitToman) * mul;
      return (a.costInToman - b.costInToman) * mul;
    });
  }, [state.deals, filterTab, searchQuery, sortField, sortAsc]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const handleApplyConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setApplyingConfig(true);
    try {
      await onUpdateConfig({
        budgetToman: Math.max(1, Number(budgetM) || 100) * 1_000_000,
        maxItemCommitmentToman: Math.max(1, Number(capM) || 45) * 1_000_000,
        minMarginPct: Math.max(0, Number(minMargin) || 18),
        goldenMarginPct: Math.max(5, Number(goldenMargin) || 30),
        useLiveUsdt,
        manualUsdtToman: Math.max(10_000, Number(usdtOverride) || 270_000),
      });
    } finally {
      setApplyingConfig(false);
    }
  };

  const fxSourceLabel =
    state.fx.source === 'wallex_live'
      ? 'Wallex Live API'
      : state.fx.source === 'manual_override'
        ? 'Manual Override'
        : 'Default 2026 Baseline';

  return (
    <div className="space-y-8">
      {/* KPI Metric Strip */}
      <section className="grid grid-cols-1 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Live USDT / Toman Rate</div>
          <div className="mt-2 font-mono tabular-nums text-2xl font-semibold text-slate-900">
            {state.fx.usdtToman.toLocaleString('en-US')}{' '}
            <span className="text-xs font-normal text-slate-500">TMN</span>
          </div>
          <div className="mt-1.5 text-xs text-slate-500">
            {fxSourceLabel} · CNY {state.fx.cnyToman.toLocaleString('en-US')} TMN
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">4-Branch Deal Grading</div>
          <div className="mt-2 font-mono tabular-nums text-2xl font-semibold text-emerald-700">
            {state.summary.goldenDealsCount} A+{' '}
            <span className="text-base font-medium text-slate-700">
              · {state.summary.standardDealsCount} A
            </span>
          </div>
          <div className="mt-1.5 text-xs text-slate-500">
            {state.summary.physicalDealsCount} Physical · {state.summary.consumerSubDealsCount} Subs ·{' '}
            {state.summary.apiCreditDealsCount} API Credits
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Average Verified Margin</div>
          <div className="mt-2 font-mono tabular-nums text-2xl font-semibold text-slate-900">
            {state.summary.avgVerifiedMarginPct}%
          </div>
          <div className="mt-1.5 text-xs text-slate-500">
            Peak {state.summary.bestDealMarginPct}% · A+ &ge;{state.config.goldenMarginPct}% · A &ge;
            {state.config.minMarginPct}%
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">
            Deployable Cycle Profit ({Math.round(state.config.budgetToman / 1_000_000)}M Cap)
          </div>
          <div className="mt-2 font-mono tabular-nums text-2xl font-semibold text-emerald-700">
            +{formatTomanShort(state.summary.deployableProfitPotentialToman)}
          </div>
          <div className="mt-1.5 text-xs text-slate-500">
            {state.summary.manualReviewCount} Manual Review · {state.summary.rejectedCount} Dropped
          </div>
        </div>
      </section>

      {/* Main Arbitrage Ledger */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-col gap-4 border-b border-slate-200 p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            {/* Functional Segmented Filter Bar */}
            <div className="flex flex-wrap items-center gap-1 rounded-md bg-slate-100 p-1">
              {(
                [
                  { id: 'all', label: `All (${state.deals.length})` },
                  { id: 'verified', label: `Verified (${state.summary.verifiedDealsCount})` },
                  {
                    id: 'physical_tech',
                    label: `Physical (${state.deals.filter((d) => d.productType === 'physical_tech').length})`,
                  },
                  {
                    id: 'consumer_subscription',
                    label: `Consumer AI (${state.deals.filter((d) => d.productType === 'consumer_subscription').length})`,
                  },
                  {
                    id: 'api_credit',
                    label: `API Credits (${state.deals.filter((d) => d.productType === 'api_credit').length})`,
                  },
                  {
                    id: 'manual_review',
                    label: `Review Queue (${state.summary.manualReviewCount})`,
                  },
                  { id: 'dropped', label: `Dropped (${state.summary.rejectedCount})` },
                ] as Array<{ id: FilterTab; label: string }>
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterTab(tab.id)}
                  className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    filterTab === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Search + Controls + Add */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 sm:flex-initial">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter SKU, source, network..."
                  className="w-full rounded-md border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none sm:w-48"
                />
              </div>
              <button
                type="button"
                onClick={() => setShowControls(!showControls)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  showControls
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Risk Rules
              </button>
              <button
                type="button"
                onClick={onOpenAddModal}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 transition-colors hover:bg-slate-50 whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Item
              </button>
            </div>
          </div>

          {/* Expandable Risk & FX Parameter Bar */}
          {showControls && (
            <form
              onSubmit={handleApplyConfig}
              className="grid grid-cols-1 gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2 lg:grid-cols-7 items-end"
            >
              <label className="block text-xs text-slate-600">
                Budget (M TMN)
                <input
                  type="number"
                  min={1}
                  value={budgetM}
                  onChange={(e) => setBudgetM(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono text-xs text-slate-900"
                />
              </label>
              <label className="block text-xs text-slate-600">
                Liquidity Cap (M)
                <input
                  type="number"
                  min={1}
                  value={capM}
                  onChange={(e) => setCapM(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono text-xs text-slate-900"
                />
              </label>
              <label className="block text-xs text-slate-600">
                Grade A Floor (%)
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  value={minMargin}
                  onChange={(e) => setMinMargin(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono text-xs text-slate-900"
                />
              </label>
              <label className="block text-xs text-slate-600">
                Grade A+ Floor (%)
                <input
                  type="number"
                  min={5}
                  step="1"
                  value={goldenMargin}
                  onChange={(e) => setGoldenMargin(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono text-xs text-slate-900"
                />
              </label>
              <label className="block text-xs text-slate-600">
                USDT Feed Mode
                <select
                  value={useLiveUsdt ? 'live' : 'manual'}
                  onChange={(e) => setUseLiveUsdt(e.target.value === 'live')}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                >
                  <option value="live">Wallex Live</option>
                  <option value="manual">Manual Override</option>
                </select>
              </label>
              <label className="block text-xs text-slate-600">
                Manual USDT (TMN)
                <input
                  type="number"
                  step="1000"
                  disabled={useLiveUsdt}
                  value={usdtOverride}
                  onChange={(e) => setUsdtOverride(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono text-xs text-slate-900 disabled:bg-slate-100 disabled:text-slate-400"
                />
              </label>
              <button
                type="submit"
                disabled={applyingConfig}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
              >
                {applyingConfig ? 'Applying...' : 'Apply Rules'}
              </button>
            </form>
          )}
        </div>

        {/* High-Density Data Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                <th className="px-5 py-3">Product, Type & Network</th>
                <th className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('cost')}
                    className="inline-flex items-center gap-1 hover:text-slate-900 whitespace-nowrap"
                  >
                    Landed Cost
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-4 py-3 text-right whitespace-nowrap">Market Median</th>
                <th className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('profit')}
                    className="inline-flex items-center gap-1 hover:text-slate-900 whitespace-nowrap"
                  >
                    Net Profit
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('margin')}
                    className="inline-flex items-center gap-1 hover:text-slate-900 whitespace-nowrap"
                  >
                    Margin
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-4 py-3 whitespace-nowrap">Ban / Delivery</th>
                <th className="px-5 py-3 whitespace-nowrap">Grade & Route</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredDeals.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <p className="text-sm font-medium text-slate-700">No matching opportunities</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Clear your search filter or add a new SKU to evaluate against the live FX feed.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setFilterTab('all');
                        setSearchQuery('');
                      }}
                      className="mt-3 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Reset Filters
                    </button>
                  </td>
                </tr>
              ) : (
                filteredDeals.map((deal) => {
                  const gradeMeta = getGradeMeta(deal.dealGrade);
                  const statusMeta = getValidationMeta(deal.validationStatus);
                  const banMeta = getBanCoverageMeta(deal.banCoverage);
                  return (
                    <tr
                      key={deal.id}
                      onClick={() => onSelectDeal(deal)}
                      className="cursor-pointer transition-colors hover:bg-slate-50"
                    >
                      <td className="px-5 py-3.5">
                        <div className="font-medium text-slate-900">{deal.nameEn}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                          <span className="font-medium text-slate-700">
                            {getProductTypeLabel(deal.productType)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-persian">{deal.source}</span>
                          {deal.currency !== 'TOMAN' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono text-[11px] text-slate-600">
                                {formatNativeCost(
                                  deal.sourceCost,
                                  deal.currency,
                                  deal.networkFeeUsd,
                                  deal.gatewayFeePct,
                                )}
                              </span>
                            </>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                        {formatToman(deal.costInToman)}
                      </td>

                      <td className="px-4 py-3.5 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {formatToman(deal.marketBenchmarkToman)}
                      </td>

                      <td
                        className={`px-4 py-3.5 text-right font-mono tabular-nums font-medium whitespace-nowrap ${
                          deal.netProfitToman >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {deal.netProfitToman >= 0 ? '+' : ''}
                        {formatToman(deal.netProfitToman)}
                      </td>

                      <td
                        className={`px-4 py-3.5 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                          deal.dealGrade === 'A+'
                            ? 'text-emerald-700'
                            : deal.dealGrade === 'A'
                              ? 'text-slate-900'
                              : deal.dealGrade === 'MANUAL_REVIEW'
                                ? 'text-amber-700'
                                : 'text-slate-500'
                        }`}
                      >
                        {deal.marginPct.toFixed(1)}%
                      </td>

                      <td className="px-4 py-3.5 text-xs whitespace-nowrap">
                        <div className={`font-medium ${banMeta.textClass}`}>{banMeta.label}</div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          {deal.deliveryMethod} · {deal.paymentNetwork}
                        </div>
                      </td>

                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <div className={`inline-flex items-center gap-1.5 text-xs font-semibold ${gradeMeta.textClass}`}>
                          {deal.isDeal ? (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          ) : deal.manualReviewRequired ? (
                            <Eye className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                          )}
                          <span>{gradeMeta.label}</span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          {deal.isDeal
                            ? `${deal.maxUnitsWithinBudget} units · ${deal.isNewAlert ? 'Ready' : '6h cooldown'}`
                            : statusMeta.label}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Scan Execution Log */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Recent Radar Scans</h2>
            <p className="text-xs text-slate-500">
              6-hour deduplication memory (Node R4) tracking{' '}
              <span className="font-mono tabular-nums font-medium text-slate-800">
                {state.summary.dedupedActiveCount}
              </span>{' '}
              alerted signal keys.
            </p>
          </div>
          {state.summary.dedupedActiveCount > 0 && (
            <button
              type="button"
              onClick={onClearDedupe}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset 6h Dedupe Memory
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-slate-500">
                <th className="px-5 py-2.5 font-medium">Run Time</th>
                <th className="px-4 py-2.5 text-right font-medium">USDT / TMN</th>
                <th className="px-4 py-2.5 text-right font-medium">Evaluated</th>
                <th className="px-4 py-2.5 text-right font-medium">Grade A+ / A</th>
                <th className="px-4 py-2.5 text-right font-medium">Manual Review</th>
                <th className="px-5 py-2.5 text-right font-medium">Dropped</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono tabular-nums text-slate-700">
              {state.scanHistory.map((run) => (
                <tr key={run.id}>
                  <td className="px-5 py-2.5 font-sans text-slate-600">
                    {new Date(run.timestamp).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}{' '}
                    · {formatTimeAgo(run.timestamp)}
                  </td>
                  <td className="px-4 py-2.5 text-right">{run.usdtToman.toLocaleString('en-US')}</td>
                  <td className="px-4 py-2.5 text-right">{run.totalScanned}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-emerald-700">
                    {run.goldenDeals} A+ / {Math.max(0, run.verifiedDeals - run.goldenDeals)} A
                  </td>
                  <td className="px-4 py-2.5 text-right text-amber-700">{run.manualReviewCount}</td>
                  <td className="px-5 py-2.5 text-right text-red-700">{run.rejectedFakeOrCap}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
