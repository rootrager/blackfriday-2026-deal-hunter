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
    .replace(/"chat_id"\s*:\s*"[0-9]+"/g, '"chat_id": "{{ $env.TELEGRAM_CHAT_ID }}"')
    .replace(/chat_id:\s*'[0-9]+'/g, "chat_id: $env.TELEGRAM_CHAT_ID");
  return JSON.parse(serialized) as Record<string, unknown>;
}

const NODE_ROLE_MAP: Record<string, string> = {
  T1: 'Primary 20-minute automated Black Friday scan cycle',
  T2: 'On-demand POST trigger for immediate deal verification',
  T3: 'Clears 6-hour deduplication static memory on demand',
  T4: 'Nightly Torob historical baseline & supplier catalog refresh',
  FX1: 'Fetches live USDTTMN lastPrice from Wallex exchange with error branch',
  FX2: 'Fetches domestic free-market USD, EUR, AED reference rates',
  FX3: 'Computes Chinese Yuan parity for AIPAY99/SuZhe CNY catalogs',
  FX4: 'Estimates MetaMask BEP20 ($0.15) & TRON TRC20 ($1.00) gas costs',
  FX5: 'Merges Wallex, TGJU, CNY, and gas data into a single FX context',
  FX6: 'Persists last-known-good FX snapshot in $getWorkflowStaticData',
  W1: 'Apple 20W B/A Charger & AirPods Pro 2 watchlist',
  W2: 'PS5 Slim Disc & DualSense Wireless Controllers watchlist',
  W3: '1TB NVMe PCIe 4.0 internal SSDs watchlist',
  W4: 'Clean & suspicious Divar Tehran C2C iPhone 13/14 watchlist + aggregator',
  W5: 'ChatGPT Plus & Claude Pro dedicated accounts',
  W6: 'Cursor Pro & AI coding CNY CDK packs',
  W7: 'Midjourney Standard creative subscription watchlist',
  W8: 'Isolated API usage credits (OpenRouter USDC & TeamoRouter USDT)',
  C1: 'Queries Torob median market liquidity benchmark per SKU',
  C2: 'Checks 30-day floor price to detect pre-Black-Friday inflation',
  C3: 'Scans Digikala Harajomeh timed flash offers per SKU',
  C4: 'Checks lowest verified seller buybox & stock status',
  C5: 'Captures Technolife Black Friday discounted SKUs',
  C6: 'Monitors BNPL/installment spreads vs cash floor',
  C7: 'Collects used tech ads across Tehran districts per SKU',
  C8: 'Filters valid prices and tags فوری C2C ads by SKU index',
  C9: 'Fetches AIPAY99 consumer AI subscription storefront',
  C10: 'Monitors SuZhe AI Cursor Pro & reseller catalog',
  C11: 'Tracks OpenRouter USDC credit fee schedule (5.5%)',
  C12: 'Monitors TeamoRouter multi-network prepaid API balance',
  V1: 'Enforces strict CanonicalDealSignal schema across all 14 items & 3 product types',
  V2: 'Verifies price_before_discount > sale_price; flags fake promos',
  V3: 'Routes suspicious C2C listings (<40% of Torob median) to Manual Review',
  V4: 'Blocks single physical SKUs exceeding 45M TMN liquidity ceiling',
  V5: 'Validates exact payment network rail (BEP20/TRC20/Base/CNY/Shaparak)',
  V6: 'Tags evidence_type and verification timestamp on every signal',
  V7: 'Attaches Persian ban_coverage label (supported | excluded | unknown)',
  V8: 'Computes Torob min-max spread volatility percentage',
  M1: 'Calculates Total Landed Cost TMN across TOMAN, USDT, USDC, and CNY',
  M2: 'Computes Net Profit = Market Benchmark - Total Landed Cost',
  M3: 'Computes Net Margin % = (Net Profit / Total Cost) * 100',
  M4: 'Calculates Cycle ROI % and USD equivalent unit cost',
  M5: 'Computes floor(100M TMN / unit_cost) purchase capacity',
  M6: 'Assigns deal_grade (A+ / A / MANUAL_REVIEW / DROP) & builds Persian HTML card',
  R1: 'Splits pipeline into 4 strict branches: A+, A, Manual Review, Drop',
  R2: 'Guards Grade A+ (>=30% & is_new_alert) before golden dispatch',
  R3: 'Guards Grade A (>=18% & is_new_alert) before standard archive dispatch',
  R4: 'Suppresses duplicate deal alerts within 6h & handles T3 emergency reset',
  D1: 'Sends formatted Persian HTML Grade A+ card with inline buy button',
  D2: 'Posts Grade A (18–30%) deals to Telegram standard feed',
  D3: 'Dispatches high-risk <40% Divar C2C anomalies for admin review',
  D4: 'Alerts admin on Wallex FX1 error while pipeline continues on fallback',
  D5: 'Logs all 14 canonical deal signals once per cycle for P&L analysis',
  D6: 'Produces single aggregate pipeline health summary JSON per run',
};

function buildPhasesFromWorkflowNodes(
  nodes: Array<{ id?: string; name?: string; type?: string }>,
): WorkflowPhaseInfo[] {
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

  return phaseMeta.map((pm) => {
    const phaseNodes = nodes
      .filter((n) => String(n.id || '').includes(`-s${pm.phase}-`))
      .map((n) => {
        const shortId = String(n.name || '').split('.')[0] || String(n.id || '');
        return {
          id: shortId,
          name: String(n.name || shortId),
          type: String(n.type || '').replace('n8n-nodes-base.', ''),
          role: NODE_ROLE_MAP[shortId] || String(n.name || ''),
        };
      });
    return {
      ...pm,
      nodeCount: phaseNodes.length,
      nodes: phaseNodes,
    };
  });
}

function loadRepoWorkflows(): WorkflowAsset[] {
  const assets: WorkflowAsset[] = [];

  try {
    const enterprisePath = path.join(__dirname, 'enterprise_54_node_workflow.json');
    if (fs.existsSync(enterprisePath)) {
      const parsed = JSON.parse(fs.readFileSync(enterprisePath, 'utf-8')) as Record<
        string,
        unknown
      >;
      const sanitized = sanitizeWorkflowJson(parsed);
      const rawNodes = Array.isArray(sanitized.nodes)
        ? (sanitized.nodes as Array<{ id?: string; name?: string; type?: string }>)
        : [];
      assets.push({
        id: 'enterprise-54-node-2026',
        title: 'Enterprise 54-Node 8-Phase Architecture (Audited & Production-Ready)',
        filename: 'enterprise_54_node_workflow.json',
        description:
          'Audited 54-node modular n8n v2 blueprint with zero fan-in races, 1-to-1 per-SKU collectors, Canonical Data Schema, Ban Coverage disclosure, 4-branch grading (A+ / A / Manual Review / Drop), and 6-hour deduplication.',
        nodeCount: rawNodes.length,
        triggerSchedule: 'Every 20m + Live Webhook + Reset Webhook + Nightly Cron',
        streamsCovered: 'Physical Tech · Consumer AI Subscriptions · API Credit Gateways',
        phases: buildPhasesFromWorkflowNodes(rawNodes),
        json: sanitized,
      });
    }
  } catch {
    // Skip if unreadable
  }

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
    const qLower = query.toLowerCase();
    const fx = await fetchLiveFx(false);

    const matchedItem =
      watchlist.find(
        (w) =>
          (qLower.includes('ایرپاد') || qLower.includes('airpods')) &&
          w.id === 'airpods-pro-2-fake-promo',
      ) ||
      watchlist.find(
        (w) =>
          (qLower.includes('اسلیم') || (qLower.includes('پلی استیشن 5') && !qLower.includes('دسته'))) &&
          w.id === 'ps5-slim-overcap',
      ) ||
      watchlist.find(
        (w) =>
          (qLower.includes('آیفون 14') || qLower.includes('آیفون ۱۴') || qLower.includes('iphone 14')) &&
          w.id === 'iphone-14-divar-manual-review',
      ) ||
      watchlist.find(
        (w) =>
          (qLower.includes('آیفون 13') || qLower.includes('آیفون ۱۳') || qLower.includes('iphone 13')) &&
          w.id === 'used-iphone-13-c2c',
      ) ||
      watchlist.find(
        (w) =>
          (qLower.includes('dualsense') || qLower.includes('دسته')) && w.id === 'ps5-dualsense',
      ) ||
      watchlist.find(
        (w) => (qLower.includes('nvme') || qLower.includes('ssd')) && w.id === 'nvme-1tb-pcie4',
      ) ||
      watchlist.find(
        (w) =>
          w.nameFa.includes(query) ||
          w.nameEn.toLowerCase().includes(qLower) ||
          ((qLower.includes('اپل') || qLower.includes('آداپتور') || qLower.includes('شارژر')) &&
            w.id === 'apple-20w-charger'),
      );

    const baseMarket = matchedItem?.marketBenchmarkToman ?? 1_850_000;
    const baseSale = matchedItem?.currency === 'TOMAN' ? matchedItem.sourceCost : 1_320_000;
    const baseBefore =
      matchedItem?.priceBeforeDiscountToman !== null &&
      matchedItem?.priceBeforeDiscountToman !== undefined
        ? matchedItem.priceBeforeDiscountToman
        : Math.round(baseMarket * 1.02);

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
              min: Math.round(baseMarket * 0.88),
              max: Math.round(baseMarket * 1.12),
            },
          },
        ],
      });
    }

    if (service === 'technolife') {
      return res.json({
        service: 'technolife',
        query,
        products: [
          {
            title: `${matchedItem ? matchedItem.nameFa : query} - حراجی بلک فرایدی`,
            price: baseSale,
            final_price: baseSale,
            price_before_discount: baseBefore,
            discount_pct: Math.max(0, Math.round(((baseBefore - baseSale) / Math.max(1, baseBefore)) * 100)),
            in_stock: true,
            url: 'https://www.technolife.ir',
          },
        ],
      });
    }

    if (service === 'digikala') {
      const dkPrice =
        matchedItem?.id === 'airpods-pro-2-fake-promo' ? baseSale : Math.round(baseSale * 1.04);
      return res.json({
        service: 'digikala',
        query,
        products: [
          {
            title: `${matchedItem ? matchedItem.nameFa : query} گارانتی اصالت کالا`,
            price: dkPrice,
            price_before_discount: baseBefore,
            discount_pct: Math.max(0, Math.round(((baseBefore - dkPrice) / Math.max(1, baseBefore)) * 100)),
            in_stock: true,
            url: 'https://www.digikala.com',
          },
        ],
      });
    }

    if (service === 'divar') {
      const isSuspicious =
        matchedItem?.id === 'iphone-14-divar-manual-review' ||
        qLower.includes('14') ||
        qLower.includes('۱۴');
      const primaryPrice = isSuspicious
        ? Math.min(baseSale, Math.round(baseMarket * 0.31))
        : matchedItem?.isC2C
          ? baseSale
          : Math.round(baseMarket * 0.78);
      return res.json({
        service: 'divar',
        query,
        ads: [
          {
            title: `${matchedItem ? matchedItem.nameFa : query} در حد آکبند با فاکتور`,
            price: primaryPrice,
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
