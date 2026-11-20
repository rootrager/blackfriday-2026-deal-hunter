import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import {
  DEFAULT_CONFIG,
  INITIAL_WATCHLIST,
  MARKET_INSIGHTS,
  SUPPLIER_RESEARCH,
} from './src/data/initialData.ts';
import type {
  ArbitrageStateResponse,
  EngineConfig,
  EvaluatedDeal,
  FxSnapshot,
  ScanLogEntry,
  ValidationStatus,
  WatchlistItem,
  WorkflowAsset,
} from './src/types/arbitrage.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;

let engineConfig: EngineConfig = { ...DEFAULT_CONFIG };
let watchlist: WatchlistItem[] = INITIAL_WATCHLIST.map((item) => ({ ...item }));
const alertedMemory = new Map<string, number>();
const scanHistory: ScanLogEntry[] = [];

let cachedFx: FxSnapshot = {
  usdtToman: Number(process.env.DEFAULT_USDT_TMN) || 270_000,
  usdFreeToman: 272_000,
  cnyToUsd: Number(process.env.DEFAULT_CNY_USD) || 0.14,
  cnyToman: Math.round((Number(process.env.DEFAULT_USDT_TMN) || 270_000) * 0.14),
  source: 'fallback_default',
  fetchedAt: new Date().toISOString(),
};

function escapeHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtEn(num: number): string {
  return Math.round(num).toLocaleString('en-US');
}

function fmtFa(num: number): string {
  return Math.round(num).toLocaleString('fa-IR');
}

async function fetchLiveFx(forceRefresh = false): Promise<FxSnapshot> {
  if (!engineConfig.useLiveUsdt) {
    const manual = Math.max(10_000, Math.round(engineConfig.manualUsdtToman));
    cachedFx = {
      usdtToman: manual,
      usdFreeToman: Math.round(manual * 1.005),
      cnyToUsd: engineConfig.cnyToUsdRate,
      cnyToman: Math.round(manual * engineConfig.cnyToUsdRate),
      source: 'manual_override',
      fetchedAt: new Date().toISOString(),
    };
    return cachedFx;
  }

  const ageMs = Date.now() - new Date(cachedFx.fetchedAt).getTime();
  if (!forceRefresh && cachedFx.source === 'wallex_live' && ageMs < 60_000) {
    return cachedFx;
  }

  try {
    const res = await fetch('https://api.wallex.ir/v1/markets', {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const payload = (await res.json()) as {
        result?: { symbols?: { USDTTMN?: { stats?: { lastPrice?: string } } } };
      };
      const rawPrice = Number.parseFloat(
        payload?.result?.symbols?.USDTTMN?.stats?.lastPrice ?? '',
      );
      if (Number.isFinite(rawPrice) && rawPrice > 10_000) {
        const rounded = Math.round(rawPrice);
        cachedFx = {
          usdtToman: rounded,
          usdFreeToman: Math.round(rounded * 1.004),
          cnyToUsd: engineConfig.cnyToUsdRate,
          cnyToman: Math.round(rounded * engineConfig.cnyToUsdRate),
          source: 'wallex_live',
          fetchedAt: new Date().toISOString(),
        };
        return cachedFx;
      }
    }
  } catch {
    // Graceful fallback when external exchange API is unreachable
  }

  const fallbackUsdt = Number(process.env.DEFAULT_USDT_TMN) || 270_000;
  cachedFx = {
    usdtToman: fallbackUsdt,
    usdFreeToman: fallbackUsdt + 2000,
    cnyToUsd: engineConfig.cnyToUsdRate,
    cnyToman: Math.round(fallbackUsdt * engineConfig.cnyToUsdRate),
    source: 'fallback_default',
    fetchedAt: new Date().toISOString(),
  };
  return cachedFx;
}

function pruneDedupeMemory(windowHours: number): void {
  const cutoff = Date.now() - windowHours * 3600 * 1000;
  for (const [key, ts] of alertedMemory.entries()) {
    if (ts < cutoff) {
      alertedMemory.delete(key);
    }
  }
}

function evaluateItems(
  items: WatchlistItem[],
  config: EngineConfig,
  fx: FxSnapshot,
  recordDedupe = false,
): EvaluatedDeal[] {
  pruneDedupeMemory(config.dedupeWindowHours);
  const now = Date.now();

  return items.map((item) => {
    let costInToman = 0;
    if (item.currency === 'TOMAN') {
      costInToman = Math.round(item.sourceCost);
    } else if (item.currency === 'USDT') {
      costInToman = Math.round((item.sourceCost + item.networkFeeUsd) * fx.usdtToman);
    } else if (item.currency === 'CNY') {
      const usdEquivalent = item.sourceCost * config.cnyToUsdRate + item.networkFeeUsd;
      costInToman = Math.round(usdEquivalent * fx.usdtToman);
    }

    const safeCost = Math.max(1, costInToman);
    const costInUsd = Number((safeCost / fx.usdtToman).toFixed(2));
    const netProfitToman = item.marketBenchmarkToman - safeCost;
    const marginPct = Number(((netProfitToman / safeCost) * 100).toFixed(1));

    // Discount verification rule: if priceBeforeDiscount is provided, it must exceed sale price;
    // otherwise if a discount percentage is advertised without a valid higher reference price, flag it.
    const discountVerified =
      item.priceBeforeDiscountToman !== null && item.priceBeforeDiscountToman > 0
        ? item.priceBeforeDiscountToman > safeCost
        : item.declaredDiscountPct === 0;

    // Divar C2C scam floor rule: drop C2C ads listed below floor ratio (default 40%) of Torob median
    const passesScamFloor = item.isC2C
      ? safeCost >= item.marketBenchmarkToman * config.divarScamFloorRatio
      : true;

    // Single-item commitment rule (physical items <= 35M TMN to prevent liquidity lockup)
    const withinItemCap =
      item.stream === 'physical' ? safeCost <= config.maxItemCommitmentToman : true;

    const withinBudget = safeCost <= config.budgetToman;
    const passesMinMargin = marginPct >= config.minMarginPct;

    let validationStatus: ValidationStatus = 'verified_deal';
    let validationReason = 'Meets margin, liquidity cap, and authenticity checks';

    if (!passesScamFloor) {
      validationStatus = 'scam_floor';
      validationReason = `Rejected: C2C price is below ${Math.round(config.divarScamFloorRatio * 100)}% of Torob median (scam guard)`;
    } else if (!discountVerified) {
      validationStatus = 'fake_discount';
      validationReason = 'Rejected: Advertised pre-discount price is not higher than sale cost';
    } else if (!withinItemCap) {
      validationStatus = 'over_item_cap';
      validationReason = `Rejected: Unit cost exceeds ${fmtEn(config.maxItemCommitmentToman)} TMN single-item liquidity cap`;
    } else if (!passesMinMargin) {
      validationStatus = 'below_margin';
      validationReason = `Below ${config.minMarginPct}% net margin threshold (${marginPct}%)`;
    }

    const isDeal = validationStatus === 'verified_deal' && withinBudget;
    const maxUnitsWithinBudget = Math.floor(config.budgetToman / safeCost);
    const maxUnitsWithinCap =
      item.stream === 'physical'
        ? Math.min(maxUnitsWithinBudget, Math.floor(config.maxItemCommitmentToman / safeCost))
        : maxUnitsWithinBudget;

    const potentialTotalProfitToman = isDeal
      ? Math.max(0, netProfitToman * Math.max(1, maxUnitsWithinCap))
      : 0;

    const dedupeKey = `${item.id}|${safeCost}`;
    const isNewAlert = !alertedMemory.has(dedupeKey);
    if (recordDedupe && isDeal && isNewAlert) {
      alertedMemory.set(dedupeKey, now);
    }

    const telegramHtmlCard = [
      '🔥 <b>فرصت طلایی بلک فرایدی ۲۰۲۶</b>',
      '',
      `📦 <b>محصول:</b> ${escapeHtml(item.nameFa)}`,
      `🏷 <b>دسته‌بندی:</b> ${escapeHtml(item.category)}`,
      `🏪 <b>منبع تأمین:</b> ${escapeHtml(item.source)}`,
      `💰 <b>قیمت خرید تمام‌شده:</b> ${fmtFa(safeCost)} تومان`,
      `📊 <b>قیمت بازار (میانه ترب):</b> ${fmtFa(item.marketBenchmarkToman)} تومان`,
      `✅ <b>سود خالص معامله:</b> ${fmtFa(netProfitToman)} تومان`,
      `📈 <b>حاشیه سود:</b> ${marginPct}%`,
      `🧮 <b>ظرفیت خرید با بودجه ${Math.round(config.budgetToman / 1_000_000)} م:</b> ${maxUnitsWithinBudget} عدد`,
      '',
      `🔗 <a href="${escapeHtml(item.buyLink)}">مشاهده و خرید مستقیم</a>`,
    ].join('\n');

    const telegramMarkdownCard = [
      '🎯 [سیگنال شکار کالا - BUY ALERT]',
      `📦 نام محصول: ${item.nameFa}`,
      `🏷 دسته‌بندی: ${item.category}`,
      `🌐 منبع تأمین: ${item.source} (${item.settlementType})`,
      `💰 قیمت خرید (نرمال‌شده به تومان): ${fmtFa(safeCost)} تومان`,
      `📈 قیمت کف بازار ایران: ${fmtFa(item.marketBenchmarkToman)} تومان`,
      `💵 سود خالص تخمینی: ${fmtFa(netProfitToman)} تومان`,
      `🚀 حاشیه سود: ${marginPct}%`,
      `⚠️ وضعیت تخفیف: ${discountVerified ? 'تخفیف واقعی تاییدشده' : 'مشکوک / نیاز به بررسی'}`,
      `🔗 لینک منبع: ${item.buyLink}`,
    ].join('\n');

    return {
      ...item,
      costInToman: safeCost,
      costInUsd,
      netProfitToman,
      marginPct,
      maxUnitsWithinBudget,
      maxUnitsWithinCap,
      potentialTotalProfitToman,
      discountVerified,
      passesScamFloor,
      withinItemCap,
      withinBudget,
      passesMinMargin,
      isDeal,
      validationStatus,
      validationReason,
      isNewAlert,
      dedupeKey,
      telegramHtmlCard,
      telegramMarkdownCard,
    };
  });
}

function buildStateResponse(fx: FxSnapshot, recordDedupe = false): ArbitrageStateResponse {
  const deals = evaluateItems(watchlist, engineConfig, fx, recordDedupe);
  const verifiedDeals = deals.filter((d) => d.isDeal);
  const physicalDeals = verifiedDeals.filter((d) => d.stream === 'physical');
  const digitalDeals = verifiedDeals.filter((d) => d.stream === 'digital');

  const avgVerifiedMarginPct = verifiedDeals.length
    ? Number(
        (
          verifiedDeals.reduce((sum, d) => sum + d.marginPct, 0) / verifiedDeals.length
        ).toFixed(1),
      )
    : 0;

  const bestDeal = verifiedDeals.reduce<EvaluatedDeal | null>(
    (best, curr) => (!best || curr.marginPct > best.marginPct ? curr : best),
    null,
  );

  // Compute balanced deployable net profit across verified deals capped at operational budget
  let remainingBudget = engineConfig.budgetToman;
  let deployableProfit = 0;
  const sortedByMargin = [...verifiedDeals].sort((a, b) => b.marginPct - a.marginPct);
  for (const deal of sortedByMargin) {
    if (remainingBudget <= 0) break;
    const perItemCap =
      deal.stream === 'physical'
        ? Math.min(engineConfig.maxItemCommitmentToman, remainingBudget)
        : Math.min(engineConfig.budgetToman * 0.35, remainingBudget);
    const units = Math.floor(perItemCap / deal.costInToman);
    if (units > 0) {
      deployableProfit += units * deal.netProfitToman;
      remainingBudget -= units * deal.costInToman;
    }
  }

  return {
    config: engineConfig,
    fx,
    deals,
    summary: {
      totalTracked: deals.length,
      verifiedDealsCount: verifiedDeals.length,
      physicalDealsCount: physicalDeals.length,
      digitalDealsCount: digitalDeals.length,
      avgVerifiedMarginPct,
      bestDealMarginPct: bestDeal ? bestDeal.marginPct : 0,
      bestDealName: bestDeal ? bestDeal.nameEn : null,
      deployableProfitPotentialToman: Math.round(deployableProfit),
      rejectedCount: deals.filter((d) => !d.isDeal).length,
      dedupedActiveCount: alertedMemory.size,
    },
    scanHistory: [...scanHistory].slice(0, 12),
  };
}

function sanitizeWorkflowJson(raw: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(raw)
    .replace(/https:\/\/api\.telegram\.org\/bot[0-9]+:[A-Za-z0-9_-]+\/sendMessage/g, 'https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/sendMessage')
    .replace(/"chat_id"\s*:\s*"[0-9]+"/g, '"chat_id": "{{ $env.TELEGRAM_CHAT_ID }}"');
  return JSON.parse(serialized) as Record<string, unknown>;
}

function buildEnterpriseDualEngineWorkflow(config: EngineConfig): Record<string, unknown> {
  return {
    name: 'Enterprise Dual-Engine Black Friday 2026 Arbitrage Radar',
    active: false,
    nodes: [
      {
        id: 'schedule-trigger-20m',
        name: 'Schedule Trigger (Every 20 Mins)',
        type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1.2,
        position: [120, 220],
        parameters: {
          rule: { interval: [{ field: 'minutes', minutesInterval: 20 }] },
        },
      },
      {
        id: 'manual-webhook-trigger',
        name: 'Webhook Trigger (Manual Run)',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2.0,
        position: [120, 420],
        parameters: {
          httpMethod: 'POST',
          path: 'bf2026-dual-engine-scan',
          options: {},
        },
      },
      {
        id: 'fx-rate-fetcher',
        name: '1. Live USD/USDT Exchange Rate Fetcher',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [400, 320],
        onError: 'continueRegularOutput',
        parameters: {
          method: 'GET',
          url: 'https://api.wallex.ir/v1/markets',
          options: { timeout: 5000 },
        },
      },
      {
        id: 'build-dual-watchlist',
        name: '2. Build Dual Target Watchlist (Physical & Digital)',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [660, 320],
        parameters: {
          jsCode: `const watchlist = ${JSON.stringify(
            watchlist.map((w) => ({
              id: w.id,
              name_fa: w.nameFa,
              stream: w.stream,
              category: w.category,
              source: w.source,
              currency: w.currency,
              source_cost: w.sourceCost,
              network_fee_usd: w.networkFeeUsd,
              market_benchmark_toman: w.marketBenchmarkToman,
              is_c2c: w.isC2C,
              buy_link: w.buyLink,
            })),
            null,
            2,
          )};\nreturn watchlist.map((item) => ({ json: item }));`,
        },
      },
      {
        id: 'http-torob-baseline',
        name: '3a. Torob Market Median HTTP Request',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [940, 160],
        onError: 'continueRegularOutput',
        parameters: {
          method: 'POST',
          url: 'http://172.17.0.1:3000/mcp/torob',
          sendBody: true,
          specifyBody: 'json',
          jsonBody: '={{ JSON.stringify({ query: $json.name_fa }) }}',
        },
      },
      {
        id: 'http-technolife-flash',
        name: '3b. Technolife & Digikala Flash HTTP Request',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [940, 320],
        onError: 'continueRegularOutput',
        parameters: {
          method: 'POST',
          url: 'http://172.17.0.1:3000/mcp/technolife',
          sendBody: true,
          specifyBody: 'json',
          jsonBody: '={{ JSON.stringify({ query: $json.name_fa }) }}',
        },
      },
      {
        id: 'http-divar-c2c',
        name: '3c. Divar Urgent C2C HTTP Request',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [940, 480],
        onError: 'continueRegularOutput',
        parameters: {
          method: 'POST',
          url: 'http://172.17.0.1:3000/mcp/divar',
          sendBody: true,
          specifyBody: 'json',
          jsonBody: '={{ JSON.stringify({ query: $json.name_fa }) }}',
        },
      },
      {
        id: 'margin-validation-engine',
        name: '4. Advanced Margin & Discount Validation Engine',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [1240, 320],
        parameters: {
          jsCode: [
            `const BUDGET = ${config.budgetToman};`,
            `const MAX_ITEM_CAP = ${config.maxItemCommitmentToman};`,
            `const MIN_MARGIN = ${config.minMarginPct};`,
            `const DIVAR_FLOOR = ${config.divarScamFloorRatio};`,
            `const DEDUPE_HOURS = ${config.dedupeWindowHours};`,
            `const DEFAULT_USDT = ${config.manualUsdtToman};`,
            `const CNY_TO_USD = ${config.cnyToUsdRate};`,
            `const fxData = $('1. Live USD/USDT Exchange Rate Fetcher').first()?.json || {};`,
            `const parsedUsdt = parseFloat(fxData?.result?.symbols?.USDTTMN?.stats?.lastPrice);`,
            `const usdtRate = Number.isFinite(parsedUsdt) ? Math.round(parsedUsdt) : DEFAULT_USDT;`,
            `const store = $getWorkflowStaticData('global');`,
            `store.alerted = store.alerted || {};`,
            `const now = Date.now();`,
            `for (const k of Object.keys(store.alerted)) if (now - store.alerted[k] > DEDUPE_HOURS * 3600e3) delete store.alerted[k];`,
            `return $('2. Build Dual Target Watchlist (Physical & Digital)').all().map(({ json: item }) => {`,
            `  const costToman = item.currency === 'TOMAN' ? item.source_cost : item.currency === 'USDT' ? Math.round((item.source_cost + item.network_fee_usd) * usdtRate) : Math.round((item.source_cost * CNY_TO_USD + item.network_fee_usd) * usdtRate);`,
            `  const netProfit = item.market_benchmark_toman - costToman;`,
            `  const marginPct = Number(((netProfit / costToman) * 100).toFixed(1));`,
            `  const passesScamFloor = item.is_c2c ? costToman >= item.market_benchmark_toman * DIVAR_FLOOR : true;`,
            `  const withinCap = item.stream === 'physical' ? costToman <= MAX_ITEM_CAP : true;`,
            `  const isDeal = marginPct >= MIN_MARGIN && passesScamFloor && withinCap && costToman <= BUDGET;`,
            `  const dedupeKey = item.id + '|' + costToman;`,
            `  const isNew = !store.alerted[dedupeKey];`,
            `  if (isDeal && isNew) store.alerted[dedupeKey] = now;`,
            `  const units = Math.floor(BUDGET / costToman);`,
            `  return { json: { ...item, cost_toman: costToman, net_profit: netProfit, margin_pct: marginPct, units, is_deal: isDeal, is_new_alert: isNew, usdt_rate: usdtRate } };`,
            `});`,
          ].join('\n'),
        },
      },
      {
        id: 'high-yield-filter',
        name: `5. High-Yield & 6h Dedupe Filter (Margin >= ${config.minMarginPct}%)`,
        type: 'n8n-nodes-base.if',
        typeVersion: 2.2,
        position: [1520, 320],
        parameters: {
          conditions: {
            combinator: 'and',
            conditions: [
              {
                leftValue: '={{ $json.is_deal }}',
                operator: { type: 'boolean', operation: 'true', singleValue: true },
              },
              {
                leftValue: '={{ $json.is_new_alert }}',
                operator: { type: 'boolean', operation: 'true', singleValue: true },
              },
            ],
          },
        },
      },
      {
        id: 'telegram-deal-dispatcher',
        name: '6. Telegram Deal Card Dispatcher (HTML + Inline Button)',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [1800, 320],
        onError: 'continueRegularOutput',
        parameters: {
          method: 'POST',
          url: 'https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/sendMessage',
          sendBody: true,
          specifyBody: 'json',
          jsonBody:
            '={{ JSON.stringify({ chat_id: $env.TELEGRAM_CHAT_ID, parse_mode: "HTML", text: `🔥 <b>فرصت طلایی بلک فرایدی ۲۰۲۶</b>\\n\\n📦 <b>محصول:</b> ${$json.name_fa}\\n🏷 <b>دسته‌بندی:</b> ${$json.category}\\n🏪 <b>منبع تأمین:</b> ${$json.source}\\n💰 <b>قیمت خرید تمام‌شده:</b> ${$json.cost_toman.toLocaleString("fa-IR")} تومان\\n📊 <b>قیمت بازار (میانه ترب):</b> ${$json.market_benchmark_toman.toLocaleString("fa-IR")} تومان\\n✅ <b>سود خالص معامله:</b> ${$json.net_profit.toLocaleString("fa-IR")} تومان\\n📈 <b>حاشیه سود:</b> ${$json.margin_pct}%\\n🧮 <b>ظرفیت خرید با بودجه ۱۰۰ م:</b> ${$json.units} عدد`, reply_markup: { inline_keyboard: [[{ text: "مشاهده و خرید مستقیم", url: $json.buy_link }]] } }) }}',
        },
      },
    ],
    connections: {
      'Schedule Trigger (Every 20 Mins)': {
        main: [[{ node: '1. Live USD/USDT Exchange Rate Fetcher', type: 'main', index: 0 }]],
      },
      'Webhook Trigger (Manual Run)': {
        main: [[{ node: '1. Live USD/USDT Exchange Rate Fetcher', type: 'main', index: 0 }]],
      },
      '1. Live USD/USDT Exchange Rate Fetcher': {
        main: [[{ node: '2. Build Dual Target Watchlist (Physical & Digital)', type: 'main', index: 0 }]],
      },
      '2. Build Dual Target Watchlist (Physical & Digital)': {
        main: [
          [
            { node: '3a. Torob Market Median HTTP Request', type: 'main', index: 0 },
            { node: '3b. Technolife & Digikala Flash HTTP Request', type: 'main', index: 0 },
            { node: '3c. Divar Urgent C2C HTTP Request', type: 'main', index: 0 },
          ],
        ],
      },
      '3a. Torob Market Median HTTP Request': {
        main: [[{ node: '4. Advanced Margin & Discount Validation Engine', type: 'main', index: 0 }]],
      },
      '3b. Technolife & Digikala Flash HTTP Request': {
        main: [[{ node: '4. Advanced Margin & Discount Validation Engine', type: 'main', index: 0 }]],
      },
      '3c. Divar Urgent C2C HTTP Request': {
        main: [[{ node: '4. Advanced Margin & Discount Validation Engine', type: 'main', index: 0 }]],
      },
      '4. Advanced Margin & Discount Validation Engine': {
        main: [[{ node: `5. High-Yield & 6h Dedupe Filter (Margin >= ${config.minMarginPct}%)`, type: 'main', index: 0 }]],
      },
      [`5. High-Yield & 6h Dedupe Filter (Margin >= ${config.minMarginPct}%)`]: {
        main: [[{ node: '6. Telegram Deal Card Dispatcher (HTML + Inline Button)', type: 'main', index: 0 }]],
      },
    },
    settings: { executionOrder: 'v1' },
  };
}

function loadRepoWorkflows(): WorkflowAsset[] {
  const generated = buildEnterpriseDualEngineWorkflow(engineConfig);
  const assets: WorkflowAsset[] = [
    {
      id: 'enterprise-dual-engine-2026',
      title: 'Enterprise Dual-Engine Radar (2026 Master Spec)',
      filename: 'enterprise_dual_engine_bf2026.json',
      description:
        'Dynamically synchronized with your active budget, margin floor, Divar scam guard, and dual Physical + Crypto AI watchlist.',
      nodeCount: (generated.nodes as unknown[]).length,
      triggerSchedule: 'Every 20 minutes + Manual POST Webhook',
      streamsCovered: 'Stream A (Physical Tech) + Stream B (Crypto AI Subscriptions)',
      json: generated,
    },
  ];

  const repoFiles: Array<{
    id: string;
    file: string;
    title: string;
    description: string;
    triggerSchedule: string;
    streamsCovered: string;
  }> = [
    {
      id: 'workflow-stable-http',
      file: 'workflow_stable_http.json',
      title: 'Stable HTTP Proxy Workflow (Repository Baseline)',
      description:
        'Original repository workflow querying local MCP HTTP proxy routes (tgju, torob, digikala, technolife, divar) with 6-hour deduplication.',
      triggerSchedule: 'Every 25 minutes + Manual Webhook',
      streamsCovered: 'Stream A (Physical Consumer Tech)',
    },
    {
      id: 'blackfriday-arbitrage-workflow',
      file: 'blackfriday_arbitrage_workflow.json',
      title: 'Multi-Currency Arbitrage Prototype (Repository Baseline)',
      description:
        'Multi-currency CNY/USD/TMN prototype evaluating Claude Pro, Cursor Pro, Apple 20W Charger, and PS5 DualSense.',
      triggerSchedule: 'Every 30 minutes + Manual Webhook',
      streamsCovered: 'Dual Stream Prototype (CNY / USD / TMN)',
    },
  ];

  for (const spec of repoFiles) {
    try {
      const fullPath = path.join(__dirname, spec.file);
      if (fs.existsSync(fullPath)) {
        const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as Record<string, unknown>;
        const sanitized = sanitizeWorkflowJson(parsed);
        assets.push({
          id: spec.id,
          title: spec.title,
          filename: spec.file,
          description: spec.description,
          nodeCount: Array.isArray(sanitized.nodes) ? sanitized.nodes.length : 0,
          triggerSchedule: spec.triggerSchedule,
          streamsCovered: spec.streamsCovered,
          json: sanitized,
        });
      }
    } catch {
      // Skip unreadable JSON files gracefully
    }
  }

  return assets;
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());

  // Initial FX warm-up and seed first scan entry
  const initialFx = await fetchLiveFx(true);
  const initialState = buildStateResponse(initialFx, false);
  scanHistory.unshift({
    id: `scan-${Date.now()}`,
    timestamp: new Date().toISOString(),
    usdtToman: initialFx.usdtToman,
    totalScanned: initialState.summary.totalTracked,
    verifiedDeals: initialState.summary.verifiedDealsCount,
    rejectedFakeOrScam: initialState.deals.filter(
      (d) => d.validationStatus === 'fake_discount' || d.validationStatus === 'scam_floor',
    ).length,
    newAlertsQueued: initialState.deals.filter((d) => d.isDeal && d.isNewAlert).length,
  });

  // ---------------------------------------------------------------------------
  // Integrated MCP HTTP Proxy Routes (migrated from mcp_http_proxy.js onto :3000)
  // ---------------------------------------------------------------------------
  app.post('/mcp/:service', async (req, res) => {
    const service = String(req.params.service || '').toLowerCase();
    const query = String(req.body?.query || 'آداپتور 20 وات اپل');
    const fx = await fetchLiveFx(false);

    const matchedItem = watchlist.find(
      (w) =>
        w.nameFa.includes(query) ||
        w.nameEn.toLowerCase().includes(query.toLowerCase()) ||
        query.includes('اپل') && w.id === 'apple-20w-charger' ||
        query.toLowerCase().includes('dualsense') && w.id === 'ps5-dualsense' ||
        query.toLowerCase().includes('nvme') && w.id === 'nvme-1tb-pcie4' ||
        query.includes('آیفون') && w.id === 'used-iphone-13-c2c',
    );

    const baseMarket = matchedItem?.marketBenchmarkToman ?? 1_850_000;
    const baseSale = matchedItem?.currency === 'TOMAN' ? matchedItem.sourceCost : 1_320_000;

    if (service === 'tgju') {
      return res.json({
        service: 'tgju',
        fetched_at: fx.fetchedAt,
        source: fx.source,
        rows: [
          { name: 'دلار آزاد', symbol: 'dollar_free', price_toman: fx.usdFreeToman },
          { name: 'تتر', symbol: 'usdt', price_toman: fx.usdtToman },
          { name: 'یوان چین', symbol: 'cny', price_toman: fx.cnyToman },
        ],
      });
    }

    if (service === 'torob') {
      return res.json({
        service: 'torob',
        query,
        picks: [
          {
            title: matchedItem ? matchedItem.nameFa : `${query} اصلی`,
            price: baseMarket,
            stats: {
              median: baseMarket,
              min: Math.round(baseMarket * 0.86),
              max: Math.round(baseMarket * 1.14),
            },
          },
        ],
      });
    }

    if (service === 'technolife') {
      const before = Math.round(baseMarket * 1.02);
      return res.json({
        service: 'technolife',
        query,
        products: [
          {
            title: `${matchedItem ? matchedItem.nameFa : query} - حراجی بلک فرایدی`,
            price: baseSale,
            final_price: baseSale,
            price_before_discount: before,
            discount_pct: Math.max(0, Math.round(((before - baseSale) / before) * 100)),
            in_stock: true,
            url: 'https://www.technolife.ir',
          },
        ],
      });
    }

    if (service === 'digikala') {
      const dkPrice = Math.round(baseSale * 1.04);
      const before = Math.round(baseMarket * 1.05);
      return res.json({
        service: 'digikala',
        query,
        products: [
          {
            title: `${matchedItem ? matchedItem.nameFa : query} گارانتی اصالت کالا`,
            price: dkPrice,
            price_before_discount: before,
            discount_pct: Math.max(0, Math.round(((before - dkPrice) / before) * 100)),
            in_stock: true,
            url: 'https://www.digikala.com',
          },
        ],
      });
    }

    if (service === 'divar') {
      return res.json({
        service: 'divar',
        query,
        ads: [
          {
            title: `${matchedItem ? matchedItem.nameFa : query} در حد آکبند با فاکتور`,
            price: Math.round(baseMarket * 0.78),
            tag: 'فوری',
            url: 'https://divar.ir',
          },
          {
            title: `${matchedItem ? matchedItem.nameFa : query} زیر قیمت بازار (مشکوک)`,
            price: Math.round(baseMarket * 0.28),
            tag: 'فوری',
            url: 'https://divar.ir',
          },
        ],
      });
    }

    return res.status(404).json({
      error: `Unknown MCP service "${service}". Supported: tgju, torob, technolife, digikala, divar.`,
    });
  });

  // ---------------------------------------------------------------------------
  // Core Arbitrage API Routes
  // ---------------------------------------------------------------------------
  app.get('/api/state', async (_req, res) => {
    const fx = await fetchLiveFx(false);
    return res.json(buildStateResponse(fx, false));
  });

  app.post('/api/scan', async (req, res) => {
    const markAlerted = Boolean(req.body?.recordDedupe);
    const fx = await fetchLiveFx(true);
    const state = buildStateResponse(fx, markAlerted);

    scanHistory.unshift({
      id: `scan-${Date.now()}`,
      timestamp: new Date().toISOString(),
      usdtToman: fx.usdtToman,
      totalScanned: state.summary.totalTracked,
      verifiedDeals: state.summary.verifiedDealsCount,
      rejectedFakeOrScam: state.deals.filter(
        (d) => d.validationStatus === 'fake_discount' || d.validationStatus === 'scam_floor',
      ).length,
      newAlertsQueued: state.deals.filter((d) => d.isDeal && d.isNewAlert).length,
    });

    // Keep active_deals.json synced with verified deals just like engine.js
    try {
      const verifiedSnapshot = state.deals
        .filter((d) => d.isDeal)
        .map((d) => ({
          id: d.id,
          name: d.nameFa,
          category: d.category,
          source: d.source,
          currency: d.currency,
          cost: d.sourceCost,
          marketSellPriceToman: d.marketBenchmarkToman,
          networkFeeUsd: d.networkFeeUsd,
          costInToman: d.costInToman,
          netProfit: d.netProfitToman,
          margin: d.marginPct,
          isDeal: d.isDeal,
        }));
      fs.writeFileSync(
        path.join(__dirname, 'active_deals.json'),
        JSON.stringify(verifiedSnapshot, null, 2),
      );
    } catch {
      // Non-fatal in ephemeral containers
    }

    return res.json({
      ...state,
      scanHistory: [...scanHistory].slice(0, 12),
    });
  });

  app.post('/api/config', async (req, res) => {
    const body = req.body as Partial<EngineConfig>;
    engineConfig = {
      budgetToman:
        typeof body.budgetToman === 'number' && body.budgetToman >= 1_000_000
          ? Math.round(body.budgetToman)
          : engineConfig.budgetToman,
      maxItemCommitmentToman:
        typeof body.maxItemCommitmentToman === 'number' && body.maxItemCommitmentToman >= 500_000
          ? Math.round(body.maxItemCommitmentToman)
          : engineConfig.maxItemCommitmentToman,
      minMarginPct:
        typeof body.minMarginPct === 'number' && body.minMarginPct >= 0 && body.minMarginPct <= 200
          ? Number(body.minMarginPct)
          : engineConfig.minMarginPct,
      divarScamFloorRatio:
        typeof body.divarScamFloorRatio === 'number' &&
        body.divarScamFloorRatio >= 0.1 &&
        body.divarScamFloorRatio <= 0.9
          ? Number(body.divarScamFloorRatio)
          : engineConfig.divarScamFloorRatio,
      dedupeWindowHours:
        typeof body.dedupeWindowHours === 'number' && body.dedupeWindowHours >= 1
          ? Math.round(body.dedupeWindowHours)
          : engineConfig.dedupeWindowHours,
      useLiveUsdt:
        typeof body.useLiveUsdt === 'boolean' ? body.useLiveUsdt : engineConfig.useLiveUsdt,
      manualUsdtToman:
        typeof body.manualUsdtToman === 'number' && body.manualUsdtToman >= 10_000
          ? Math.round(body.manualUsdtToman)
          : engineConfig.manualUsdtToman,
      cnyToUsdRate:
        typeof body.cnyToUsdRate === 'number' && body.cnyToUsdRate > 0.05 && body.cnyToUsdRate < 1
          ? Number(body.cnyToUsdRate)
          : engineConfig.cnyToUsdRate,
    };

    const fx = await fetchLiveFx(true);
    return res.json(buildStateResponse(fx, false));
  });

  app.post('/api/dedupe/clear', async (_req, res) => {
    alertedMemory.clear();
    const fx = await fetchLiveFx(false);
    return res.json(buildStateResponse(fx, false));
  });

  app.post('/api/watchlist', async (req, res) => {
    const body = req.body as Partial<WatchlistItem>;
    if (!body.nameEn || !body.sourceCost || !body.marketBenchmarkToman) {
      return res.status(400).json({ error: 'Product name, source cost, and market benchmark are required.' });
    }

    const newItem: WatchlistItem = {
      id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      nameEn: String(body.nameEn).trim(),
      nameFa: String(body.nameFa || body.nameEn).trim(),
      stream: body.stream === 'digital' ? 'digital' : 'physical',
      category: String(
        body.category || (body.stream === 'digital' ? 'دیجیتال / هوش مصنوعی' : 'فیزیکی / تکنولوژی'),
      ),
      source: String(body.source || 'تأمین مستقیم'),
      sourcePlatform: body.sourcePlatform || (body.stream === 'digital' ? 'aipay99' : 'technolife'),
      settlementType:
        body.settlementType ||
        (body.currency === 'USDT'
          ? 'Crypto (USDT BEP20)'
          : body.currency === 'CNY'
            ? 'CNY / Alipay Normalized'
            : 'Rial / Toman Gateway'),
      currency: body.currency === 'USDT' || body.currency === 'CNY' ? body.currency : 'TOMAN',
      sourceCost: Number(body.sourceCost),
      networkFeeUsd: Number(body.networkFeeUsd) || 0,
      priceBeforeDiscountToman:
        body.priceBeforeDiscountToman !== null &&
        body.priceBeforeDiscountToman !== undefined &&
        Number(body.priceBeforeDiscountToman) > 0
          ? Number(body.priceBeforeDiscountToman)
          : null,
      declaredDiscountPct: Number(body.declaredDiscountPct) || 0,
      marketBenchmarkToman: Number(body.marketBenchmarkToman),
      buyLink: String(body.buyLink || 'https://www.technolife.ir'),
      isC2C: Boolean(body.isC2C),
      notes: body.notes ? String(body.notes) : undefined,
    };

    watchlist.unshift(newItem);
    const fx = await fetchLiveFx(false);
    return res.status(201).json(buildStateResponse(fx, false));
  });

  app.put('/api/watchlist/:id', async (req, res) => {
    const id = req.params.id;
    const idx = watchlist.findIndex((item) => item.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Watchlist item not found.' });
    }
    const existing = watchlist[idx];
    const body = req.body as Partial<WatchlistItem>;
    watchlist[idx] = {
      ...existing,
      ...body,
      id: existing.id,
      sourceCost: body.sourceCost !== undefined ? Number(body.sourceCost) : existing.sourceCost,
      networkFeeUsd:
        body.networkFeeUsd !== undefined ? Number(body.networkFeeUsd) : existing.networkFeeUsd,
      marketBenchmarkToman:
        body.marketBenchmarkToman !== undefined
          ? Number(body.marketBenchmarkToman)
          : existing.marketBenchmarkToman,
      priceBeforeDiscountToman:
        body.priceBeforeDiscountToman === null
          ? null
          : body.priceBeforeDiscountToman !== undefined
            ? Number(body.priceBeforeDiscountToman)
            : existing.priceBeforeDiscountToman,
    };
    const fx = await fetchLiveFx(false);
    return res.json(buildStateResponse(fx, false));
  });

  app.delete('/api/watchlist/:id', async (req, res) => {
    const id = req.params.id;
    watchlist = watchlist.filter((item) => item.id !== id);
    const fx = await fetchLiveFx(false);
    return res.json(buildStateResponse(fx, false));
  });

  app.get('/api/workflows', (_req, res) => {
    return res.json({ workflows: loadRepoWorkflows() });
  });

  app.get('/api/research', (_req, res) => {
    return res.json({
      checkedDate: 'November 19, 2026',
      campaignDates: {
        blackFriday: 'November 27, 2026',
        cyberMonday: 'November 30, 2026',
      },
      suppliers: SUPPLIER_RESEARCH,
      marketInsights: MARKET_INSIGHTS,
      safeguards: [
        'Crypto checkout does not override upstream regional terms of service (OpenAI / Anthropic unsupported-region restrictions).',
        'Match the exact token and blockchain network requested at checkout: AIPAY99 uses USDT on BEP20 only; Kunavo uses USDT/TRC20 or USDC/Base.',
        'Do not preload large reseller balances or market unverified Education licenses as commercial JetBrains seats.',
        'Never infer arbitrage margins by directly converting CNY catalog items against USDT storefront SKUs without verifying region locks.',
      ],
    });
  });

  // ---------------------------------------------------------------------------
  // Frontend Serving (Vite Dev Middleware or Built Static Dist)
  // ---------------------------------------------------------------------------
  const isProd = process.env.NODE_ENV === 'production';
  const distDir = path.join(__dirname, 'dist');

  if (isProd && fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Black Friday 2026 Arbitrage Radar running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
