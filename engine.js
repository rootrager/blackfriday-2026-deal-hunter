// engine.js - Live Black Friday 2026 Dual-Engine Arbitrage Calculator (ESM)
import fs from 'node:fs';

async function getLiveUsdtPrice() {
  try {
    const res = await fetch('https://api.wallex.ir/v1/markets', {
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    const price = parseFloat(data?.result?.symbols?.USDTTMN?.stats?.lastPrice);
    if (price && !Number.isNaN(price)) return Math.round(price);
  } catch {
    console.warn('⚠️ خطا در دریافت نرخ لحظه‌ای والکس، نرخ تتر روی ۲۷۲,۱۰۰ تومان تنظیم شد.');
  }
  return 272100;
}

const targetWatchlist = [
  {
    id: 'chatgpt-plus',
    product_type: 'consumer_subscription',
    name: 'ChatGPT Plus (اکانت اختصاصی ماهانه)',
    category: 'اشتراک مصرف‌کننده / هوش مصنوعی',
    source: 'AIPAY99 (شبکه BEP20 با متامسک)',
    currency: 'USDT',
    cost: 18.8,
    marketSellPriceToman: 6150000,
    networkFeeUsd: 0.15,
    ban_coverage: 'excluded',
  },
  {
    id: 'claude-pro',
    product_type: 'consumer_subscription',
    name: 'Claude Pro (اشتراک اختصاصی ماهانه)',
    category: 'اشتراک مصرف‌کننده / هوش مصنوعی',
    source: 'AIPAY99 / متامسک',
    currency: 'USDT',
    cost: 25.5,
    marketSellPriceToman: 7500000,
    networkFeeUsd: 0.15,
    ban_coverage: 'excluded',
  },
  {
    id: 'cursor-pro',
    product_type: 'consumer_subscription',
    name: 'Cursor Pro (اشتراک توسعه‌دهندگان AI)',
    category: 'اشتراک مصرف‌کننده / برنامه‌نویسی',
    source: 'suzhe.ai / تأمین کریپتو',
    currency: 'USDT',
    cost: 16.0,
    marketSellPriceToman: 5450000,
    networkFeeUsd: 0.15,
    ban_coverage: 'unknown',
  },
  {
    id: 'apple-20w-charger',
    product_type: 'physical_tech',
    name: 'شارژر ۲۰ وات اورجینال اپل (پارت B/A اصلی)',
    category: 'فیزیکی / اکسسوری اپل',
    source: 'تکنولایف / حراجی بلک‌فرایدی',
    currency: 'TOMAN',
    cost: 1320000,
    marketSellPriceToman: 1850000,
    networkFeeUsd: 0,
    ban_coverage: 'supported',
  },
  {
    id: 'ps5-dualsense',
    product_type: 'physical_tech',
    name: 'دسته پلی‌استیشن ۵ DualSense (سفید/مشکی)',
    category: 'فیزیکی / گیمینگ',
    source: 'دیجی‌کالا / فلش‌سیل داخلی',
    currency: 'TOMAN',
    cost: 3650000,
    marketSellPriceToman: 4400000,
    networkFeeUsd: 0,
    ban_coverage: 'supported',
  },
  {
    id: 'nvme-1tb-pcie4',
    product_type: 'physical_tech',
    name: 'اس‌اس‌دی ۱ ترابایت NVMe PCIe 4.0',
    category: 'فیزیکی / سخت‌افزار PC',
    source: 'تکنولایف / کمپین ذخیره‌ساز',
    currency: 'TOMAN',
    cost: 23500000,
    marketSellPriceToman: 29800000,
    networkFeeUsd: 0,
    ban_coverage: 'supported',
  },
];

async function runArbitrageEngine() {
  console.log('🚀 در حال اجرای زنده موتور شکار فرصت‌های بلک‌فرایدی ۲۰۲۶...\n');
  const usdtRate = await getLiveUsdtPrice();
  console.log(`💵 نرخ استعلام‌شده تتر (والکس): ${Number(usdtRate).toLocaleString('fa-IR')} تومان\n`);

  const opportunities = [];

  for (const item of targetWatchlist) {
    const costInToman =
      item.currency === 'TOMAN'
        ? item.cost
        : Math.round((item.cost + item.networkFeeUsd) * usdtRate);

    const netProfit = item.marketSellPriceToman - costInToman;
    const margin = Number(((netProfit / costInToman) * 100).toFixed(1));
    const dealGrade = margin >= 30 ? 'A+' : margin >= 18 ? 'A' : 'DROP';
    const isDeal = dealGrade !== 'DROP';

    const result = {
      ...item,
      costInToman,
      netProfit,
      margin,
      dealGrade,
      isDeal,
    };

    if (isDeal) opportunities.push(result);

    console.log(
      `[${dealGrade}] ${item.name} | Cost: ${costInToman.toLocaleString('en-US')} TMN | Margin: ${margin}% | Ban: ${item.ban_coverage}`,
    );
  }

  fs.writeFileSync('active_deals.json', JSON.stringify(opportunities, null, 2));
  console.log(`\n✅ کل موقعیت‌های سودآور تأییدشده (>=18%): ${opportunities.length} مورد`);
}

runArbitrageEngine();
