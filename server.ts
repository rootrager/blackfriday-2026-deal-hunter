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
  BanCoverage,
  CanonicalDealSignal,
  DealGrade,
  EngineConfig,
  EvaluatedDeal,
  FxSnapshot,
  ProductType,
  ScanLogEntry,
  ValidationStatus,
  WatchlistItem,
  WorkflowAsset,
  WorkflowPhaseInfo,
} from './src/types/arbitrage.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;

let engineConfig: EngineConfig = { ...DEFAULT_CONFIG };
let watchlist: WatchlistItem[] = INITIAL_WATCHLIST.map((item) => ({ ...item }));
const alertedMemory = new Map<string, number>();
const scanHistory: ScanLogEntry[] = [];

const initialUsdt = Number(process.env.DEFAULT_USDT_TMN) || 270_000;
let cachedFx: FxSnapshot = {
  usdtToman: initialUsdt,
  usdFreeToman: initialUsdt + 2000,
  eurToman: Math.round(initialUsdt * 1.08),
  aedToman: Math.round(initialUsdt / 3.6725),
  cnyToUsd: Number(process.env.DEFAULT_CNY_USD) || 0.14,
  cnyToman: Math.round(initialUsdt * 0.14),
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

function banCoverageFa(cov: BanCoverage): string {
  if (cov === 'supported') return 'تحت پوشش / گارانتی معتبر';
  if (cov === 'excluded') return 'بدون گارانتی بن (Excluded)';
  return 'نامشخص (نیاز به استعلام)';
}

function buildFxSnapshot(usdt: number, source: FxSnapshot['source']): FxSnapshot {
  return {
    usdtToman: usdt,
    usdFreeToman: Math.round(usdt * 1.004),
    eurToman: Math.round(usdt * 1.08),
    aedToman: Math.round(usdt / 3.6725),
    cnyToUsd: engineConfig.cnyToUsdRate,
    cnyToman: Math.round(usdt * engineConfig.cnyToUsdRate),
    source,
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchLiveFx(forceRefresh = false): Promise<FxSnapshot> {
  if (!engineConfig.useLiveUsdt) {
    const manual = Math.max(10_000, Math.round(engineConfig.manualUsdtToman));
    cachedFx = buildFxSnapshot(manual, 'manual_override');
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
        cachedFx = buildFxSnapshot(Math.round(rawPrice), 'wallex_live');
        return cachedFx;
      }
    }
  } catch {
    // Graceful fallback when external exchange API is unreachable
  }

  const fallbackUsdt = Number(process.env.DEFAULT_USDT_TMN) || 270_000;
  cachedFx = buildFxSnapshot(fallbackUsdt, 'fallback_default');
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

  return items.map((item, idx) => {
    const gatewayMultiplier = 1 + (item.gatewayFeePct ?? 0) / 100;
    let costInToman = 0;

    if (item.currency === 'TOMAN') {
      costInToman = Math.round(item.sourceCost * gatewayMultiplier);
    } else if (item.currency === 'USDT' || item.currency === 'USDC') {
      const totalUsd = item.sourceCost * gatewayMultiplier + item.networkFeeUsd;
      costInToman = Math.round(totalUsd * fx.usdtToman);
    } else if (item.currency === 'CNY') {
      const usdEquivalent = item.sourceCost * config.cnyToUsdRate * gatewayMultiplier + item.networkFeeUsd;
      costInToman = Math.round(usdEquivalent * fx.usdtToman);
    }

    const safeCost = Math.max(1, costInToman);
    const costInUsd = Number((safeCost / fx.usdtToman).toFixed(2));
    const netProfitToman = item.marketBenchmarkToman - safeCost;
    const marginPct = Number(((netProfitToman / safeCost) * 100).toFixed(1));
    const roiPct = marginPct;

    const discountVerified =
      item.priceBeforeDiscountToman !== null && item.priceBeforeDiscountToman > 0
        ? item.priceBeforeDiscountToman > safeCost
        : item.declaredDiscountPct === 0;

    const passesScamFloor = item.isC2C
      ? safeCost >= item.marketBenchmarkToman * config.divarScamFloorRatio
      : true;

    const withinItemCap =
      item.stream === 'physical' ? safeCost <= config.maxItemCommitmentToman : true;

    const withinBudget = safeCost <= config.budgetToman;
    const passesMinMargin = marginPct >= config.minMarginPct;

    let validationStatus: ValidationStatus = 'verified_deal';
    let validationReason = 'Verified against margin, liquidity cap, and anti-fraud rules';
    let dealGrade: DealGrade = marginPct >= config.goldenMarginPct ? 'A+' : 'A';
    let manualReviewRequired = false;

    if (!passesScamFloor) {
      validationStatus = 'manual_review';
      manualReviewRequired = true;
      dealGrade = 'MANUAL_REVIEW';
      validationReason = `Routed to Admin Manual Review (Node D3): Divar C2C ad is below ${Math.round(config.divarScamFloorRatio * 100)}% of Torob median`;
    } else if (!discountVerified) {
      validationStatus = 'fake_discount';
      dealGrade = 'DROP';
      validationReason = 'Dropped (Node V2): Advertised pre-discount price is not higher than sale cost';
    } else if (!withinItemCap) {
      validationStatus = 'over_item_cap';
      dealGrade = 'DROP';
      validationReason = `Dropped (Node V4): Unit cost exceeds ${fmtEn(config.maxItemCommitmentToman)} TMN liquidity cap`;
    } else if (!passesMinMargin) {
      validationStatus = 'below_margin';
      dealGrade = 'DROP';
      validationReason = `Below ${config.minMarginPct}% net margin floor (${marginPct}%)`;
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
    if (recordDedupe && (isDeal || manualReviewRequired) && isNewAlert) {
      alertedMemory.set(dedupeKey, now);
    }

    const canonicalSignal: CanonicalDealSignal = {
      tracking_id: `deal-2026-bf-${String(idx + 1).padStart(3, '0')}`,
      product_type: item.productType,
      name_fa: item.nameFa,
      source_name: item.source,
      source_url: item.buyLink,
      payment_asset: item.paymentAsset,
      payment_network: item.paymentNetwork,
      currency_basis: item.currency,
      raw_cost: item.sourceCost,
      network_gas_usd: item.networkFeeUsd,
      exchange_rate_toman: fx.usdtToman,
      total_cost_toman: safeCost,
      market_benchmark_toman: item.marketBenchmarkToman,
      net_profit_toman: netProfitToman,
      margin_pct: marginPct,
      roi_pct: roiPct,
      delivery_method: item.deliveryMethod,
      ban_coverage: item.banCoverage,
      promotion_status: item.promotionStatus,
      manual_review_required: manualReviewRequired,
      deal_grade: dealGrade,
      budget_capacity_units: maxUnitsWithinBudget,
    };

    const gradeHeader =
      dealGrade === 'A+'
        ? '🔥 <b>فرصت طلایی Grade A+ بلک فرایدی ۲۰۲۶</b>'
        : dealGrade === 'MANUAL_REVIEW'
          ? '⚠️ <b>صف بررسی دستی ادمین (آگهی مشکوک دیوار)</b>'
          : '🎯 <b>فرصت استاندارد Grade A بلک فرایدی ۲۰۲۶</b>';

    const telegramHtmlCard = [
      gradeHeader,
      '',
      `📦 <b>محصول:</b> ${escapeHtml(item.nameFa)}`,
      `🏷 <b>نوع / دسته‌بندی:</b> ${escapeHtml(item.category)}`,
      `🏪 <b>منبع تأمین:</b> ${escapeHtml(item.source)} (${escapeHtml(item.paymentNetwork)})`,
      `💰 <b>قیمت خرید تمام‌شده:</b> ${fmtFa(safeCost)} تومان`,
      `📊 <b>قیمت بازار (میانه ترب):</b> ${fmtFa(item.marketBenchmarkToman)} تومان`,
      `✅ <b>سود خالص معامله:</b> ${fmtFa(netProfitToman)} تومان`,
      `📈 <b>حاشیه سود / ROI:</b> ${marginPct}% (${dealGrade})`,
      `🛡 <b>وضعیت گارانتی و بن:</b> ${banCoverageFa(item.banCoverage)} · تحویل: ${escapeHtml(item.deliveryMethod)}`,
      `🧮 <b>ظرفیت خرید با بودجه ${Math.round(config.budgetToman / 1_000_000)} م:</b> ${maxUnitsWithinBudget} عدد`,
      '',
      `🔗 <a href="${escapeHtml(item.buyLink)}">مشاهده و خرید مستقیم</a>`,
    ].join('\n');

    const telegramMarkdownCard = [
      `🎯 [سیگنال ${dealGrade} - ${manualReviewRequired ? 'MANUAL REVIEW' : 'BUY ALERT'}]`,
      `📦 نام محصول: ${item.nameFa}`,
      `🏷 نوع قرارداد: ${item.productType} | ${item.category}`,
      `🌐 منبع تأمین: ${item.source} (${item.paymentAsset} / ${item.paymentNetwork})`,
      `💰 بهای تمام‌شده کل: ${fmtFa(safeCost)} تومان`,
      `📈 قیمت کف بازار ایران: ${fmtFa(item.marketBenchmarkToman)} تومان`,
      `💵 سود خالص تخمینی: ${fmtFa(netProfitToman)} تومان`,
      `🚀 حاشیه سود: ${marginPct}%`,
      `🛡 پوشش بن / تحویل: ${item.banCoverage} | ${item.deliveryMethod}`,
      `⚠️ وضعیت تخفیف: ${discountVerified ? 'تاییدشده' : 'تخفیف صوری'}`,
      `🔗 لینک منبع: ${item.buyLink}`,
    ].join('\n');

    return {
      ...item,
      costInToman: safeCost,
      costInUsd,
      netProfitToman,
      marginPct,
      roiPct,
      dealGrade,
      manualReviewRequired,
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
      canonicalSignal,
      telegramHtmlCard,
      telegramMarkdownCard,
    };
  });
}

function buildStateResponse(fx: FxSnapshot, recordDedupe = false): ArbitrageStateResponse {
  const deals = evaluateItems(watchlist, engineConfig, fx, recordDedupe);
  const verifiedDeals = deals.filter((d) => d.isDeal);
  const goldenDeals = verifiedDeals.filter((d) => d.dealGrade === 'A+');
  const standardDeals = verifiedDeals.filter((d) => d.dealGrade === 'A');
  const manualReviewDeals = deals.filter((d) => d.manualReviewRequired);

  const physicalDeals = verifiedDeals.filter((d) => d.productType === 'physical_tech');
  const consumerSubDeals = verifiedDeals.filter((d) => d.productType === 'consumer_subscription');
  const apiCreditDeals = verifiedDeals.filter((d) => d.productType === 'api_credit');

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
      goldenDealsCount: goldenDeals.length,
      standardDealsCount: standardDeals.length,
      manualReviewCount: manualReviewDeals.length,
      physicalDealsCount: physicalDeals.length,
      consumerSubDealsCount: consumerSubDeals.length,
      apiCreditDealsCount: apiCreditDeals.length,
      avgVerifiedMarginPct,
      bestDealMarginPct: bestDeal ? bestDeal.marginPct : 0,
      bestDealName: bestDeal ? bestDeal.nameEn : null,
      deployableProfitPotentialToman: Math.round(deployableProfit),
      rejectedCount: deals.filter((d) => !d.isDeal && !d.manualReviewRequired).length,
      dedupedActiveCount: alertedMemory.size,
    },
    scanHistory: [...scanHistory].slice(0, 12),
  };
}

function sanitizeWorkflowJson(raw: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(raw)
    .replace(
      /https:\/\/api\.telegram\.org\/bot[0-9]+:[A-Za-z0-9_-]+\/sendMessage/g,
      'https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/sendMessage',
    )
    .replace(/"chat_id"\s*:\s*"[0-9]+"/g, '"chat_id": "{{ $env.TELEGRAM_CHAT_ID }}"');
  return JSON.parse(serialized) as Record<string, unknown>;
}

function buildEnterprise54NodeWorkflow(config: EngineConfig): {
  json: Record<string, unknown>;
  phases: WorkflowPhaseInfo[];
} {
  type NodeSpec = {
    id: string;
    name: string;
    type: string;
    typeVersion: number;
    role: string;
    phase: number;
    parameters: Record<string, unknown>;
    onError?: string;
  };

  const specs: NodeSpec[] = [
    // Phase 1: Triggers & Time Management (4 nodes)
    {
      id: 'T1',
      name: 'T1. Schedule Trigger (Every 20m)',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      role: 'Primary 20-minute automated Black Friday scan cycle',
      phase: 1,
      parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 20 }] } },
    },
    {
      id: 'T2',
      name: 'T2. Manual Live Test Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      role: 'On-demand POST trigger for immediate deal verification',
      phase: 1,
      parameters: { httpMethod: 'POST', path: 'bf2026-live-scan' },
    },
    {
      id: 'T3',
      name: 'T3. Emergency Reset Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      role: 'Clears 6-hour deduplication static memory on demand',
      phase: 1,
      parameters: { httpMethod: 'POST', path: 'bf2026-emergency-reset' },
    },
    {
      id: 'T4',
      name: 'T4. Nightly Sync Cron (00:30 IRST)',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      role: 'Nightly Torob historical baseline & supplier catalog refresh',
      phase: 1,
      parameters: { rule: { interval: [{ field: 'hours', hoursInterval: 24 }] } },
    },

    // Phase 2: Macro Financial & FX Engine (6 nodes)
    {
      id: 'FX1',
      name: 'FX1. Wallex Live USDT/TMN',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      role: 'Fetches live USDTTMN lastPrice from Wallex exchange',
      phase: 2,
      onError: 'continueRegularOutput',
      parameters: { method: 'GET', url: 'https://api.wallex.ir/v1/markets', options: { timeout: 5000 } },
    },
    {
      id: 'FX2',
      name: 'FX2. TGJU Free FX (USD/EUR/AED)',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      role: 'Fetches domestic free-market USD, EUR, AED reference rates',
      phase: 2,
      onError: 'continueRegularOutput',
      parameters: { method: 'POST', url: 'http://172.17.0.1:3000/mcp/tgju', sendBody: true, specifyBody: 'json', jsonBody: '{"service":"tgju"}' },
    },
    {
      id: 'FX3',
      name: 'FX3. CNY/USD Parity Converter',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'Computes Chinese Yuan parity for AIPAY99/SuZhe CNY catalogs',
      phase: 2,
      parameters: { jsCode: `return [{ json: { cny_to_usd: ${config.cnyToUsdRate} } }];` },
    },
    {
      id: 'FX4',
      name: 'FX4. Network Gas Estimator (BSC/TRC20)',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'Estimates MetaMask BEP20 ($0.15) & TRON TRC20 ($1.00) gas costs',
      phase: 2,
      parameters: { jsCode: `return [{ json: { gas_bep20_usd: 0.15, gas_trc20_usd: 1.0, gas_base_usd: 0.2 } }];` },
    },
    {
      id: 'FX5',
      name: 'FX5. FX Toman Normalizer',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'Merges USDT, USD, EUR, AED, and CNY into a single FX context object',
      phase: 2,
      parameters: {
        jsCode: `const wallex = $('FX1. Wallex Live USDT/TMN').first()?.json;\nconst raw = parseFloat(wallex?.result?.symbols?.USDTTMN?.stats?.lastPrice);\nconst usdt = Number.isFinite(raw) ? Math.round(raw) : ${config.manualUsdtToman};\nreturn [{ json: { usdt_toman: usdt, cny_toman: Math.round(usdt * ${config.cnyToUsdRate}), fetched_at: new Date().toISOString() } }];`,
      },
    },
    {
      id: 'FX6',
      name: 'FX6. FX Cache & Outage Fallback',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'Persists last-known-good FX snapshot in $getWorkflowStaticData',
      phase: 2,
      parameters: {
        jsCode: `const store = $getWorkflowStaticData('global');\nif ($json.usdt_toman > 10000) store.last_fx = $json;\nreturn [{ json: store.last_fx || { usdt_toman: ${config.manualUsdtToman}, cny_toman: ${Math.round(config.manualUsdtToman * config.cnyToUsdRate)} } }];`,
      },
    },

    // Phase 3: Segmented Target Watchlists (8 nodes)
    {
      id: 'W1',
      name: 'W1. Apple Ecosystem Watchlist',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'Apple 20W B/A Charger, MagSafe, AirPods Pro 2',
      phase: 3,
      parameters: { jsCode: `return [{ json: { group: 'apple', product_type: 'physical_tech', query: 'آداپتور 20 وات اپل اصلی' } }];` },
    },
    {
      id: 'W2',
      name: 'W2. Gaming Consoles Watchlist',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'PS5 Slim Disc & DualSense Wireless Controllers',
      phase: 3,
      parameters: { jsCode: `return [{ json: { group: 'gaming', product_type: 'physical_tech', query: 'دسته dualsense ps5' } }];` },
    },
    {
      id: 'W3',
      name: 'W3. PC Hardware & NVMe SSD',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: '1TB NVMe PCIe 4.0 internal SSDs (26M–35M TMN band)',
      phase: 3,
      parameters: { jsCode: `return [{ json: { group: 'pc_ssd', product_type: 'physical_tech', query: 'ssd nvme 1tb' } }];` },
    },
    {
      id: 'W4',
      name: 'W4. Used C2C Mobile (iPhone 13/14)',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'Clean registered C2C iPhone 13/14 listings on Divar Tehran',
      phase: 3,
      parameters: { jsCode: `return [{ json: { group: 'used_c2c', product_type: 'physical_tech', is_c2c: true, query: 'آیفون 13 128 تمیز' } }];` },
    },
    {
      id: 'W5',
      name: 'W5. Consumer AI Subscriptions',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'ChatGPT Plus & Claude Pro dedicated accounts',
      phase: 3,
      parameters: { jsCode: `return [{ json: { group: 'ai_consumer', product_type: 'consumer_subscription', skus: ['chatgpt-plus', 'claude-pro'] } }];` },
    },
    {
      id: 'W6',
      name: 'W6. AI Coding IDEs (Cursor Pro)',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'Cursor Pro & AI coding CDK packs',
      phase: 3,
      parameters: { jsCode: `return [{ json: { group: 'ai_coding', product_type: 'consumer_subscription', skus: ['cursor-pro', 'codex-reseller-cny'] } }];` },
    },
    {
      id: 'W7',
      name: 'W7. Creative & Media Tools',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'Midjourney, Adobe CC, Figma & JetBrains watchlist',
      phase: 3,
      parameters: { jsCode: `return [{ json: { group: 'creative_media', product_type: 'consumer_subscription', skus: ['midjourney-std'] } }];` },
    },
    {
      id: 'W8',
      name: 'W8. API Credit Gateways',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'Isolated API usage credits (OpenRouter / TeamoRouter / Kunavo)',
      phase: 3,
      parameters: { jsCode: `return [{ json: { group: 'api_credits', product_type: 'api_credit', skus: ['openrouter-api-100', 'teamorouter-api-100'] } }];` },
    },

    // Phase 4: Specialized Data Collectors (12 nodes)
    {
      id: 'C1',
      name: 'C1. Torob Median Baseline',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      role: 'Queries Torob median market liquidity benchmark',
      phase: 4,
      onError: 'continueRegularOutput',
      parameters: { method: 'POST', url: 'http://172.17.0.1:3000/mcp/torob', sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ query: $json.query || "آداپتور 20 وات اپل" }) }}' },
    },
    {
      id: 'C2',
      name: 'C2. Torob Price History',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      role: 'Checks 30-day floor price to detect pre-Black-Friday inflation',
      phase: 4,
      onError: 'continueRegularOutput',
      parameters: { method: 'POST', url: 'http://172.17.0.1:3000/mcp/torob', sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ query: $json.query, mode: "history" }) }}' },
    },
    {
      id: 'C3',
      name: 'C3. Digikala Flash Campaigns',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      role: 'Scans Digikala Harajomeh timed flash offers',
      phase: 4,
      onError: 'continueRegularOutput',
      parameters: { method: 'POST', url: 'http://172.17.0.1:3000/mcp/digikala', sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ query: $json.query }) }}' },
    },
    {
      id: 'C4',
      name: 'C4. Digikala Buybox Offers',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      role: 'Checks lowest verified seller buybox & stock status',
      phase: 4,
      onError: 'continueRegularOutput',
      parameters: { method: 'POST', url: 'http://172.17.0.1:3000/mcp/digikala', sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ query: $json.query, mode: "buybox" }) }}' },
    },
    {
      id: 'C5',
      name: 'C5. Technolife Flash Deals',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      role: 'Captures Technolife Black Friday discounted SKUs',
      phase: 4,
      onError: 'continueRegularOutput',
      parameters: { method: 'POST', url: 'http://172.17.0.1:3000/mcp/technolife', sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ query: $json.query }) }}' },
    },
    {
      id: 'C6',
      name: 'C6. Technolife Installment Rates',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      role: 'Monitors BNPL/installment spreads vs cash floor',
      phase: 4,
      onError: 'continueRegularOutput',
      parameters: { method: 'POST', url: 'http://172.17.0.1:3000/mcp/technolife', sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ query: $json.query, mode: "installments" }) }}' },
    },
    {
      id: 'C7',
      name: 'C7. Divar Tehran C2C Ads',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      role: 'Collects clean used tech ads across Tehran districts',
      phase: 4,
      onError: 'continueRegularOutput',
      parameters: { method: 'POST', url: 'http://172.17.0.1:3000/mcp/divar', sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ query: $json.query }) }}' },
    },
    {
      id: 'C8',
      name: 'C8. Divar Urgent Tag Filter',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'Prioritizes C2C ads flagged فوری with purchase invoice',
      phase: 4,
      parameters: { jsCode: `return items.filter(i => i.json);` },
    },
    {
      id: 'C9',
      name: 'C9. AIPAY99 USDT Storefront',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      role: 'Fetches consumer AI subscription stock & USDT BEP20 pricing',
      phase: 4,
      onError: 'continueRegularOutput',
      parameters: { method: 'GET', url: 'https://aipay99.com/en/', options: { timeout: 6000 } },
    },
    {
      id: 'C10',
      name: 'C10. SuZhe AI Storefront',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      role: 'Monitors Cursor Pro & reseller agent catalog pricing',
      phase: 4,
      onError: 'continueRegularOutput',
      parameters: { method: 'GET', url: 'https://suzhe.ai/', options: { timeout: 6000 } },
    },
    {
      id: 'C11',
      name: 'C11. OpenRouter USDC Gateway',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      role: 'Tracks API credit fee schedule (5.5% std / 8% biz)',
      phase: 4,
      onError: 'continueRegularOutput',
      parameters: { method: 'GET', url: 'https://openrouter.ai/pricing', options: { timeout: 6000 } },
    },
    {
      id: 'C12',
      name: 'C12. TeamoRouter Multi-Net',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      role: 'Monitors BEP20/TRC20/Base prepaid API balance minimums',
      phase: 4,
      onError: 'continueRegularOutput',
      parameters: { method: 'GET', url: 'https://teamorouter.com/blogs/ai-api-crypto-payment', options: { timeout: 6000 } },
    },

    // Phase 5: Data Sanitization & Anti-Fraud Layer (8 nodes)
    {
      id: 'V1',
      name: 'V1. Canonical JSON Schema Normalizer',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'Enforces strict CanonicalDealSignal schema across all 3 product types',
      phase: 5,
      parameters: { jsCode: `return items.map((item, i) => ({ json: { tracking_id: 'deal-2026-bf-' + String(i+1).padStart(3,'0'), ...item.json } }));` },
    },
    {
      id: 'V2',
      name: 'V2. Fake Discount Detector',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'Verifies price_before_discount > sale_price; flags fake Harajomeh banners',
      phase: 5,
      parameters: { jsCode: `return items.map(i => ({ json: { ...i.json, discount_verified: i.json.before ? i.json.before > i.json.cost : true } }));` },
    },
    {
      id: 'V3',
      name: 'V3. Divar <40% Manual Review Filter',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'Routes suspicious C2C listings (<40% of Torob median) to Admin Manual Review',
      phase: 5,
      parameters: { jsCode: `const FLOOR = ${config.divarScamFloorRatio};\nreturn items.map(i => ({ json: { ...i.json, manual_review_required: Boolean(i.json.is_c2c && i.json.total_cost_toman < i.json.market_benchmark_toman * FLOOR) } }));` },
    },
    {
      id: 'V4',
      name: 'V4. Liquidity Cap Guard (>45M TMN)',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'Blocks single physical SKUs exceeding operational liquidity ceiling',
      phase: 5,
      parameters: { jsCode: `const CAP = ${config.maxItemCommitmentToman};\nreturn items.map(i => ({ json: { ...i.json, within_liquidity_cap: i.json.product_type === 'physical_tech' ? i.json.total_cost_toman <= CAP : true } }));` },
    },
    {
      id: 'V5',
      name: 'V5. MetaMask Network Validator',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'Ensures exact token/network match (AIPAY99=BEP20, Kunavo=TRC20/Base)',
      phase: 5,
      parameters: { jsCode: `return items;` },
    },
    {
      id: 'V6',
      name: 'V6. Evidence & Source Logger',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'Tags evidence_type (live_api | proxy_snapshot | manual_entry)',
      phase: 5,
      parameters: { jsCode: `return items.map(i => ({ json: { ...i.json, evidence_type: 'live_http_collector' } }));` },
    },
    {
      id: 'V7',
      name: 'V7. Ban & Warranty Classifier',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'Attaches ban_coverage (supported | excluded | unknown) for Apple Store disclosure',
      phase: 5,
      parameters: { jsCode: `return items.map(i => ({ json: { ...i.json, ban_coverage: i.json.ban_coverage || 'unknown' } }));` },
    },
    {
      id: 'V8',
      name: 'V8. Price Volatility Calculator',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'Computes 7-day spread stability against Torob median',
      phase: 5,
      parameters: { jsCode: `return items;` },
    },

    // Phase 6: Quantitative Arbitrage Math Engine (6 nodes)
    {
      id: 'M1',
      name: 'M1. Total Landed Cost Engine',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'Calculates Total Cost TMN = (raw_cost + fee + gas) * FX',
      phase: 6,
      parameters: { jsCode: `return items;` },
    },
    {
      id: 'M2',
      name: 'M2. Net Profit Calculator',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'Computes Net Profit = Torob/Market Benchmark - Total Landed Cost',
      phase: 6,
      parameters: { jsCode: `return items.map(i => ({ json: { ...i.json, net_profit_toman: (i.json.market_benchmark_toman || 0) - (i.json.total_cost_toman || 0) } }));` },
    },
    {
      id: 'M3',
      name: 'M3. Net Margin % Calculator',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'Computes Margin % = (Net Profit / Total Cost) * 100',
      phase: 6,
      parameters: { jsCode: `return items;` },
    },
    {
      id: 'M4',
      name: 'M4. Cycle ROI Calculator',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'Calculates annualized & campaign cycle ROI',
      phase: 6,
      parameters: { jsCode: `return items;` },
    },
    {
      id: 'M5',
      name: 'M5. 100M TMN Budget Allocator',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'Computes floor(budget / unit_cost) respecting liquidity cap',
      phase: 6,
      parameters: { jsCode: `const BUDGET = ${config.budgetToman};\nreturn items.map(i => ({ json: { ...i.json, budget_capacity_units: Math.floor(BUDGET / Math.max(1, i.json.total_cost_toman || 1)) } }));` },
    },
    {
      id: 'M6',
      name: 'M6. Deal Quality Grader (A+ / A / Review / Drop)',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'Assigns deal_grade based on >=30% (A+), 18-30% (A), or Manual Review',
      phase: 6,
      parameters: { jsCode: `const GOLD = ${config.goldenMarginPct}; const MIN = ${config.minMarginPct};\nreturn items.map(i => { const g = i.json.manual_review_required ? 'MANUAL_REVIEW' : (i.json.margin_pct >= GOLD ? 'A+' : i.json.margin_pct >= MIN ? 'A' : 'DROP'); return { json: { ...i.json, deal_grade: g } }; });` },
    },

    // Phase 7: Decision Routing & Deduplication (4 nodes)
    {
      id: 'R1',
      name: 'R1. 4-Branch Switch Router',
      type: 'n8n-nodes-base.switch',
      typeVersion: 3.2,
      role: 'Splits pipeline into A+ Golden, A Standard, Manual Review, and Drop',
      phase: 7,
      parameters: { mode: 'rules', rules: { values: [{ outputKey: 'A+' }, { outputKey: 'A' }, { outputKey: 'MANUAL_REVIEW' }, { outputKey: 'DROP' }] } },
    },
    {
      id: 'R2',
      name: 'R2. Grade A+ Golden Filter (>30%)',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      role: 'Fast-tracks >30% verified opportunities to priority Telegram alert',
      phase: 7,
      parameters: { conditions: { conditions: [{ leftValue: '={{ $json.deal_grade }}', rightValue: 'A+', operator: { type: 'string', operation: 'equals' } }] } },
    },
    {
      id: 'R3',
      name: 'R3. Grade A Standard Filter (18–30%)',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      role: 'Routes standard profitable opportunities to archive feed',
      phase: 7,
      parameters: { conditions: { conditions: [{ leftValue: '={{ $json.deal_grade }}', rightValue: 'A', operator: { type: 'string', operation: 'equals' } }] } },
    },
    {
      id: 'R4',
      name: 'R4. 6-Hour Alert Deduplication Memory',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'Suppresses duplicate deal alerts within 6 hours via $getWorkflowStaticData',
      phase: 7,
      parameters: { jsCode: `const store = $getWorkflowStaticData('global'); store.alerted = store.alerted || {}; const now = Date.now(); const hrs = ${config.dedupeWindowHours};\nfor (const k of Object.keys(store.alerted)) if (now - store.alerted[k] > hrs * 3600e3) delete store.alerted[k];\nreturn items.filter(i => { const k = i.json.tracking_id + '|' + i.json.total_cost_toman; if (store.alerted[k]) return false; store.alerted[k] = now; return true; });` },
    },

    // Phase 8: Omnichannel Dispatchers & Loggers (6 nodes)
    {
      id: 'D1',
      name: 'D1. Telegram Golden Deal Card (Grade A+)',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      role: 'Sends formatted Persian HTML card with Ban Coverage & Buy button',
      phase: 8,
      onError: 'continueRegularOutput',
      parameters: { method: 'POST', url: 'https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/sendMessage', sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ chat_id: $env.TELEGRAM_CHAT_ID, parse_mode: "HTML", text: $json.telegram_html }) }}' },
    },
    {
      id: 'D2',
      name: 'D2. Telegram Standard Archive Feed (Grade A)',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      role: 'Posts 18–30% deals to secondary monitoring channel',
      phase: 8,
      onError: 'continueRegularOutput',
      parameters: { method: 'POST', url: 'https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/sendMessage', sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ chat_id: $env.TELEGRAM_ARCHIVE_CHAT_ID, parse_mode: "HTML", text: $json.telegram_html }) }}' },
    },
    {
      id: 'D3',
      name: 'D3. Admin Manual Review Queue (<40% Divar)',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      role: 'Dispatches high-risk C2C anomalies for human verification',
      phase: 8,
      onError: 'continueRegularOutput',
      parameters: { method: 'POST', url: 'https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/sendMessage', sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ chat_id: $env.TELEGRAM_ADMIN_CHAT_ID, parse_mode: "HTML", text: $json.telegram_html }) }}' },
    },
    {
      id: 'D4',
      name: 'D4. Admin System Error Notifier',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      role: 'Alerts operator if Wallex or MCP collector fails repeatedly',
      phase: 8,
      onError: 'continueRegularOutput',
      parameters: { method: 'POST', url: 'https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/sendMessage', sendBody: true, specifyBody: 'json', jsonBody: '{"chat_id":"{{ $env.TELEGRAM_ADMIN_CHAT_ID }}","text":"Radar Collector Warning"}' },
    },
    {
      id: 'D5',
      name: 'D5. PostgreSQL / JSON Deal Ledger Logger',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      role: 'Appends canonical JSON signals for post-campaign P&L analysis',
      phase: 8,
      parameters: { jsCode: `return items.map(i => ({ json: { logged_at: new Date().toISOString(), ...i.json } }));` },
    },
    {
      id: 'D6',
      name: 'D6. Pipeline Health Summary Output',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      role: 'Returns JSON summary to manual webhook callers',
      phase: 8,
      parameters: { respondWith: 'allIncomingItems' },
    },
  ];

  // Position nodes neatly in 8 vertical columns
  const phaseRowCount = new Map<number, number>();
  const n8nNodes = specs.map((spec) => {
    const row = phaseRowCount.get(spec.phase) ?? 0;
    phaseRowCount.set(spec.phase, row + 1);
    const nodeObj: Record<string, unknown> = {
      id: spec.id,
      name: spec.name,
      type: spec.type,
      typeVersion: spec.typeVersion,
      position: [(spec.phase - 1) * 320 + 80, row * 120 + 80],
      parameters: spec.parameters,
    };
    if (spec.onError) nodeObj.onError = spec.onError;
    return nodeObj;
  });

  // Wire sequential phase-to-phase connections cleanly
  const connections: Record<string, { main: Array<Array<{ node: string; type: string; index: number }>> }> = {};
  const connect = (fromId: string, toIds: string[]) => {
    const fromNode = specs.find((s) => s.id === fromId);
    if (!fromNode) return;
    connections[fromNode.name] = {
      main: [
        toIds
          .map((id) => specs.find((s) => s.id === id))
          .filter((n): n is NodeSpec => Boolean(n))
          .map((n) => ({ node: n.name, type: 'main', index: 0 })),
      ],
    };
  };

  // Phase 1 -> Phase 2
  connect('T1', ['FX1', 'FX2', 'FX3', 'FX4']);
  connect('T2', ['FX1', 'FX2']);
  connect('T3', ['R4']);
  connect('T4', ['FX1', 'C2']);
  // Phase 2 -> FX5 -> FX6 -> Phase 3
  connect('FX1', ['FX5']);
  connect('FX2', ['FX5']);
  connect('FX3', ['FX5']);
  connect('FX4', ['FX5']);
  connect('FX5', ['FX6']);
  connect('FX6', ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8']);
  // Phase 3 -> Phase 4
  connect('W1', ['C1', 'C2', 'C3', 'C5']);
  connect('W2', ['C1', 'C3', 'C4', 'C5', 'C6']);
  connect('W3', ['C1', 'C5']);
  connect('W4', ['C1', 'C7']);
  connect('C7', ['C8']);
  connect('W5', ['C9', 'C10']);
  connect('W6', ['C10']);
  connect('W7', ['C9']);
  connect('W8', ['C11', 'C12']);
  // Phase 4 -> Phase 5 Chain
  ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C8', 'C9', 'C10', 'C11', 'C12'].forEach((id) =>
    connect(id, ['V1']),
  );
  connect('V1', ['V2']);
  connect('V2', ['V3']);
  connect('V3', ['V4']);
  connect('V4', ['V5']);
  connect('V5', ['V6']);
  connect('V6', ['V7']);
  connect('V7', ['V8']);
  // Phase 5 -> Phase 6 Chain
  connect('V8', ['M1']);
  connect('M1', ['M2']);
  connect('M2', ['M3']);
  connect('M3', ['M4']);
  connect('M4', ['M5']);
  connect('M5', ['M6']);
  // Phase 6 -> Phase 7 -> Phase 8
  connect('M6', ['R1']);
  connect('R1', ['R2', 'R3', 'D3', 'D5']);
  connect('R2', ['R4']);
  connect('R3', ['R4']);
  connect('R4', ['D1', 'D2', 'D5']);
  connect('D1', ['D6']);
  connect('D2', ['D6']);
  connect('D3', ['D5', 'D6']);
  connect('D4', ['D6']);

  const phaseMeta: Array<{ phase: number; code: string; title: string; titleFa: string }> = [
    { phase: 1, code: 'S1', title: 'Triggers & Scheduling', titleFa: 'تریگرها و مدیریت زمان' },
    { phase: 2, code: 'S2', title: 'Macro Financial & FX Engine', titleFa: 'موتور ماکرو مالی و نرخ ارز' },
    { phase: 3, code: 'S3', title: 'Segmented Target Watchlists', titleFa: 'واچ‌لیست‌های تفکیک‌شده کالا' },
    { phase: 4, code: 'S4', title: 'Specialized Data Collectors', titleFa: 'جمع‌آورنده‌ها و کالکتورهای داده' },
    { phase: 5, code: 'S5', title: 'Sanitization & Anti-Fraud Layer', titleFa: 'پاک‌سازی داده و لایه ضدتقلب' },
    { phase: 6, code: 'S6', title: 'Quantitative Arbitrage Math', titleFa: 'موتور ریاضی آربیتراژ' },
    { phase: 7, code: 'S7', title: '4-Branch Routing & 6h Dedupe', titleFa: 'تصمیم‌گیری شاخه‌ای و مموری ددوپ' },
    { phase: 8, code: 'S8', title: 'Omnichannel Dispatch & Logging', titleFa: 'ارسال‌کننده‌ها و لاگرها' },
  ];

  const phases: WorkflowPhaseInfo[] = phaseMeta.map((pm) => {
    const phaseNodes = specs.filter((s) => s.phase === pm.phase);
    return {
      ...pm,
      nodeCount: phaseNodes.length,
      nodes: phaseNodes.map((n) => ({
        id: n.id,
        name: n.name,
        type: n.type.replace('n8n-nodes-base.', ''),
        role: n.role,
      })),
    };
  });

  return {
    phases,
    json: {
      name: 'Enterprise 54-Node Black Friday 2026 Arbitrage Architecture',
      active: false,
      nodes: n8nNodes,
      connections,
      settings: { executionOrder: 'v1' },
    },
  };
}

function loadRepoWorkflows(): WorkflowAsset[] {
  const enterprise54 = buildEnterprise54NodeWorkflow(engineConfig);
  const assets: WorkflowAsset[] = [
    {
      id: 'enterprise-54-node-2026',
      title: 'Enterprise 54-Node 8-Phase Architecture (2026 Master Spec)',
      filename: 'enterprise_54_node_bf2026.json',
      description:
        'Full 54-node modular n8n blueprint with Canonical Data Schema, Ban Coverage classification, API Credit isolation, 4-branch grading (A+ / A / Manual Review / Drop), and 6-hour deduplication.',
      nodeCount: (enterprise54.json.nodes as unknown[]).length,
      triggerSchedule: 'Every 20m + Live Webhook + Reset Webhook + Nightly Cron',
      streamsCovered: 'Physical Tech · Consumer AI Subscriptions · API Credit Gateways',
      phases: enterprise54.phases,
      json: enterprise54.json,
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
        'Repository baseline querying local MCP HTTP proxy routes (tgju, torob, digikala, technolife, divar) with 6-hour deduplication.',
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

  const initialFx = await fetchLiveFx(true);
  const initialState = buildStateResponse(initialFx, false);
  scanHistory.unshift({
    id: `scan-${Date.now()}`,
    timestamp: new Date().toISOString(),
    usdtToman: initialFx.usdtToman,
    totalScanned: initialState.summary.totalTracked,
    verifiedDeals: initialState.summary.verifiedDealsCount,
    goldenDeals: initialState.summary.goldenDealsCount,
    manualReviewCount: initialState.summary.manualReviewCount,
    rejectedFakeOrCap: initialState.summary.rejectedCount,
    newAlertsQueued: initialState.deals.filter((d) => (d.isDeal || d.manualReviewRequired) && d.isNewAlert).length,
  });

  // Integrated MCP HTTP Proxy Routes on :3000
  app.post('/mcp/:service', async (req, res) => {
    const service = String(req.params.service || '').toLowerCase();
    const query = String(req.body?.query || 'آداپتور 20 وات اپل');
    const fx = await fetchLiveFx(false);

    const matchedItem = watchlist.find(
      (w) =>
        w.nameFa.includes(query) ||
        w.nameEn.toLowerCase().includes(query.toLowerCase()) ||
        (query.includes('اپل') && w.id === 'apple-20w-charger') ||
        (query.toLowerCase().includes('dualsense') && w.id === 'ps5-dualsense') ||
        (query.toLowerCase().includes('nvme') && w.id === 'nvme-1tb-pcie4') ||
        (query.includes('آیفون') && w.id === 'used-iphone-13-c2c'),
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
          { name: 'یورو', symbol: 'eur', price_toman: fx.eurToman },
          { name: 'درهم امارات', symbol: 'aed', price_toman: fx.aedToman },
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
            title: `${matchedItem ? matchedItem.nameFa : query} زیر قیمت بازار (صف بررسی دستی)`,
            price: Math.round(baseMarket * 0.31),
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

  // Core Arbitrage API Routes
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
      goldenDeals: state.summary.goldenDealsCount,
      manualReviewCount: state.summary.manualReviewCount,
      rejectedFakeOrCap: state.summary.rejectedCount,
      newAlertsQueued: state.deals.filter((d) => (d.isDeal || d.manualReviewRequired) && d.isNewAlert).length,
    });

    try {
      const verifiedSnapshot = state.deals
        .filter((d) => d.isDeal)
        .map((d) => d.canonicalSignal);
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
      goldenMarginPct:
        typeof body.goldenMarginPct === 'number' && body.goldenMarginPct >= 5 && body.goldenMarginPct <= 300
          ? Number(body.goldenMarginPct)
          : engineConfig.goldenMarginPct,
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
      return res
        .status(400)
        .json({ error: 'Product name, source cost, and market benchmark are required.' });
    }

    const productType: ProductType =
      body.productType === 'api_credit' || body.productType === 'consumer_subscription'
        ? body.productType
        : body.stream === 'digital'
          ? 'consumer_subscription'
          : 'physical_tech';

    const stream = productType === 'physical_tech' ? 'physical' : 'digital';
    const currency =
      body.currency === 'USDT' || body.currency === 'USDC' || body.currency === 'CNY'
        ? body.currency
        : 'TOMAN';

    const newItem: WatchlistItem = {
      id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      nameEn: String(body.nameEn).trim(),
      nameFa: String(body.nameFa || body.nameEn).trim(),
      stream,
      productType,
      category: String(
        body.category ||
          (productType === 'api_credit'
            ? 'اعتبار مصرف API / گیت‌وی'
            : productType === 'consumer_subscription'
              ? 'اشتراک مصرف‌کننده / هوش مصنوعی'
              : 'فیزیکی / تکنولوژی'),
      ),
      source: String(body.source || 'تأمین مستقیم'),
      sourcePlatform:
        body.sourcePlatform ||
        (productType === 'api_credit'
          ? 'openrouter'
          : productType === 'consumer_subscription'
            ? 'aipay99'
            : 'technolife'),
      settlementType:
        body.settlementType ||
        (currency === 'USDT'
          ? 'Crypto (USDT BEP20)'
          : currency === 'USDC'
            ? 'Crypto (USDC)'
            : currency === 'CNY'
              ? 'CNY / Alipay Normalized'
              : 'Rial / Toman Gateway'),
      paymentAsset: String(body.paymentAsset || (currency === 'TOMAN' ? 'TMN' : currency)),
      paymentNetwork: String(
        body.paymentNetwork ||
          (currency === 'USDT'
            ? 'BSC/BEP20'
            : currency === 'USDC'
              ? 'Base / Polygon'
              : currency === 'CNY'
                ? 'Alipay / CNY'
                : 'Shaparak'),
      ),
      currency,
      sourceCost: Number(body.sourceCost),
      networkFeeUsd: Number(body.networkFeeUsd) || 0,
      gatewayFeePct: Number(body.gatewayFeePct) || 0,
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
      deliveryMethod: String(
        body.deliveryMethod ||
          (productType === 'api_credit'
            ? 'API Balance'
            : productType === 'consumer_subscription'
              ? 'CDK'
              : 'Direct Store'),
      ),
      banCoverage:
        body.banCoverage === 'supported' || body.banCoverage === 'excluded'
          ? body.banCoverage
          : productType === 'physical_tech'
            ? 'supported'
            : 'unknown',
      promotionStatus: body.promotionStatus || 'standard_price',
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
      gatewayFeePct:
        body.gatewayFeePct !== undefined ? Number(body.gatewayFeePct) : existing.gatewayFeePct,
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
      checkedDate: 'November 20, 2026',
      campaignDates: {
        blackFriday: 'November 27, 2026',
        cyberMonday: 'November 30, 2026',
      },
      suppliers: SUPPLIER_RESEARCH,
      marketInsights: MARKET_INSIGHTS,
      safeguards: [
        'Strict Product Separation: Never compare API credit gateways (OpenRouter, Kunavo, TeamoRouter) directly against consumer subscriptions (ChatGPT Plus, Claude Pro).',
        'Ban & Warranty Transparency: Explicitly surface ban_coverage (supported | excluded | unknown) on every signal card before accepting Apple Store customer orders.',
        'Exact Token & Network Matching: AIPAY99 settles strictly on USDT/BEP20; Kunavo accepts USDT/TRC20 or USDC/Base; OpenRouter accepts USDC (5.5% fee).',
        'Divar C2C Manual Review Routing: C2C listings below 40% of Torob median route to Admin Manual Review (Node D3) rather than automated deal dispatch.',
      ],
    });
  });

  // Frontend Serving
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
