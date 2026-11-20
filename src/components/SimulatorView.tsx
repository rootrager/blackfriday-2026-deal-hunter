import React, { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { EngineConfig, EvaluatedDeal, FxSnapshot } from '../types/arbitrage';
import { formatToman, formatTomanShort } from '../utils/formatters';

interface SimulatorViewProps {
  deals: EvaluatedDeal[];
  config: EngineConfig;
  fx: FxSnapshot;
}

export const SimulatorView: React.FC<SimulatorViewProps> = ({ deals, config, fx }) => {
  const [physicalSharePct, setPhysicalSharePct] = useState(60);

  const digitalDeals = useMemo(
    () =>
      deals.filter(
        (d) => d.stream === 'digital' && (d.currency === 'USDT' || d.currency === 'USDC'),
      ),
    [deals],
  );

  // Build USDT sensitivity curve from 230k to 320k TMN in 10k increments
  const sensitivityData = useMemo(() => {
    const points: Array<Record<string, number>> = [];
    for (let rate = 230_000; rate <= 320_000; rate += 10_000) {
      const row: Record<string, number> = { usdtRate: rate };
      for (const item of digitalDeals) {
        const feeMul = 1 + (item.gatewayFeePct ?? 0) / 100;
        const costTmn = (item.sourceCost * feeMul + item.networkFeeUsd) * rate;
        const margin = ((item.marketBenchmarkToman - costTmn) / costTmn) * 100;
        row[item.id] = Number(margin.toFixed(1));
      }
      points.push(row);
    }
    return points;
  }, [digitalDeals]);

  // Capital Allocation Plan across verified deals respecting the 35M single-item liquidity cap
  const allocationPlan = useMemo(() => {
    const physicalBudget = Math.round((config.budgetToman * physicalSharePct) / 100);
    const digitalBudget = config.budgetToman - physicalBudget;

    const allocateStream = (streamDeals: EvaluatedDeal[], streamCap: number) => {
      let remaining = streamCap;
      const rows: Array<{
        deal: EvaluatedDeal;
        units: number;
        capitalUsed: number;
        expectedProfit: number;
      }> = [];

      const sorted = [...streamDeals]
        .filter((d) => d.isDeal)
        .sort((a, b) => b.marginPct - a.marginPct);

      for (const deal of sorted) {
        if (remaining < deal.costInToman) continue;
        const maxPerSku =
          deal.stream === 'physical'
            ? Math.min(config.maxItemCommitmentToman, remaining)
            : Math.min(Math.round(streamCap * 0.5), remaining);
        const units = Math.floor(maxPerSku / deal.costInToman);
        if (units <= 0) continue;
        const capitalUsed = units * deal.costInToman;
        const expectedProfit = units * deal.netProfitToman;
        remaining -= capitalUsed;
        rows.push({ deal, units, capitalUsed, expectedProfit });
      }
      return { rows, remaining };
    };

    const phys = allocateStream(
      deals.filter((d) => d.stream === 'physical'),
      physicalBudget,
    );
    const dig = allocateStream(
      deals.filter((d) => d.stream === 'digital'),
      digitalBudget,
    );

    const allRows = [...phys.rows, ...dig.rows];
    const totalDeployed = allRows.reduce((acc, r) => acc + r.capitalUsed, 0);
    const totalProfit = allRows.reduce((acc, r) => acc + r.expectedProfit, 0);
    const blendedRoi = totalDeployed > 0 ? Number(((totalProfit / totalDeployed) * 100).toFixed(1)) : 0;

    return {
      physicalBudget,
      digitalBudget,
      rows: allRows,
      totalDeployed,
      unallocatedCash: config.budgetToman - totalDeployed,
      totalProfit,
      blendedRoi,
    };
  }, [deals, config, physicalSharePct]);

  const lineColors = ['#0f172a', '#059669', '#2563eb', '#d97706'];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-slate-900">
          FX Sensitivity & Capital Allocation Simulator
        </h1>
        <p className="text-sm text-slate-600">
          Stress-test crypto-settled AI subscription margins against USDT/TMN volatility and model deployment of your{' '}
          <span className="font-mono tabular-nums font-medium text-slate-900">
            {formatToman(config.budgetToman)}
          </span>{' '}
          operating budget under the{' '}
          <span className="font-mono tabular-nums font-medium text-slate-900">
            {formatTomanShort(config.maxItemCommitmentToman)}
          </span>{' '}
          single-item cap.
        </p>
      </div>

      {/* FX Sensitivity Chart */}
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Stream B Net Margin vs. USDT/TMN Exchange Rate
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Dashed horizontal threshold marks your {config.minMarginPct}% minimum margin trigger; current USDT is{' '}
              <span className="font-mono tabular-nums text-slate-800">
                {fx.usdtToman.toLocaleString('en-US')} TMN
              </span>
              .
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
            {digitalDeals.map((d, idx) => (
              <span key={d.id} className="inline-flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-xs"
                  style={{ backgroundColor: lineColors[idx % lineColors.length] }}
                />
                {d.nameEn.split('(')[0].trim()}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-6 h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sensitivityData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="usdtRate"
                tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                tick={{ fontSize: 12, fill: '#64748b', fontFamily: 'IBM Plex Mono' }}
                stroke="#cbd5e1"
              />
              <YAxis
                tickFormatter={(v: number) => `${v}%`}
                tick={{ fontSize: 12, fill: '#64748b', fontFamily: 'IBM Plex Mono' }}
                stroke="#cbd5e1"
                width={44}
              />
              <Tooltip
                formatter={(value: number, name: string) => {
                  const found = digitalDeals.find((d) => d.id === name);
                  return [`${value}%`, found ? found.nameEn.split('(')[0].trim() : name];
                }}
                labelFormatter={(rate: number) => `USDT Rate: ${Number(rate).toLocaleString('en-US')} TMN`}
                contentStyle={{
                  backgroundColor: '#ffffff',
                  borderColor: '#e2e8f0',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontFamily: 'IBM Plex Mono',
                }}
              />
              <ReferenceLine
                y={config.minMarginPct}
                stroke="#d97706"
                strokeDasharray="4 4"
                label={{
                  value: `Min ${config.minMarginPct}%`,
                  position: 'insideTopRight',
                  fill: '#b45309',
                  fontSize: 11,
                }}
              />
              <ReferenceLine x={Math.round(fx.usdtToman / 10_000) * 10_000} stroke="#94a3b8" strokeDasharray="2 2" />
              {digitalDeals.map((d, idx) => (
                <Line
                  key={d.id}
                  type="monotone"
                  dataKey={d.id}
                  stroke={lineColors[idx % lineColors.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Budget Split & Deployment Ledger */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-col gap-4 border-b border-slate-200 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Dual-Stream Capital Deployment Plan
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Adjust split between Physical Tech (Stream A) and Crypto AI Subscriptions (Stream B).
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-xs text-slate-600 whitespace-nowrap">
              Physical <span className="font-mono tabular-nums font-semibold text-slate-900">{physicalSharePct}%</span>
              <span className="mx-1.5 text-slate-300">/</span>
              Digital <span className="font-mono tabular-nums font-semibold text-slate-900">{100 - physicalSharePct}%</span>
            </div>
            <input
              type="range"
              min={20}
              max={85}
              step={5}
              value={physicalSharePct}
              onChange={(e) => setPhysicalSharePct(Number(e.target.value))}
              aria-label="Physical stream allocation percentage"
              className="w-36 accent-slate-900"
            />
          </div>
        </div>

        {/* Summary Strip */}
        <div className="grid grid-cols-2 divide-x divide-slate-200 border-b border-slate-200 sm:grid-cols-4">
          <div className="p-4">
            <div className="text-xs text-slate-500">Capital Deployed</div>
            <div className="mt-1 font-mono tabular-nums text-base font-semibold text-slate-900">
              {formatTomanShort(allocationPlan.totalDeployed)}
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-slate-500">Cash Reserve</div>
            <div className="mt-1 font-mono tabular-nums text-base font-semibold text-slate-900">
              {formatTomanShort(allocationPlan.unallocatedCash)}
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-slate-500">Projected Net Profit</div>
            <div className="mt-1 font-mono tabular-nums text-base font-semibold text-emerald-700">
              +{formatTomanShort(allocationPlan.totalProfit)}
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-slate-500">Blended Cycle ROI</div>
            <div className="mt-1 font-mono tabular-nums text-base font-semibold text-emerald-700">
              {allocationPlan.blendedRoi}%
            </div>
          </div>
        </div>

        {/* Allocation Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                <th className="px-6 py-3">Verified Opportunity</th>
                <th className="px-4 py-3">Stream</th>
                <th className="px-4 py-3 text-right">Unit Cost</th>
                <th className="px-4 py-3 text-right">Units</th>
                <th className="px-4 py-3 text-right">Capital Allocated</th>
                <th className="px-6 py-3 text-right">Expected Net Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {allocationPlan.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-slate-500">
                    No verified deals qualify under current margin ({config.minMarginPct}%) and cap thresholds. Lower minimum margin or adjust FX rates to model capital deployment.
                  </td>
                </tr>
              ) : (
                allocationPlan.rows.map(({ deal, units, capitalUsed, expectedProfit }) => (
                  <tr key={deal.id} className="hover:bg-slate-50/80">
                    <td className="px-6 py-3">
                      <div className="font-medium text-slate-900">{deal.nameEn}</div>
                      <div className="font-persian text-xs text-slate-500">{deal.nameFa}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                      {deal.stream === 'physical' ? 'Physical Tech' : 'Digital AI'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                      {formatToman(deal.costInToman)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums font-medium text-slate-900">
                      {units}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                      {formatToman(capitalUsed)}
                    </td>
                    <td className="px-6 py-3 text-right font-mono tabular-nums font-semibold text-emerald-700 whitespace-nowrap">
                      +{formatToman(expectedProfit)} ({deal.marginPct}%)
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
