// engine.js - موتور هوشمند سنجش قیمت و سود واقعی بلک‌فرایدی
const fs = require('fs');

async function getLiveUsdtPrice() {
  try {
    const res = await fetch('https://api.wallex.ir/v1/markets', { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    const price = parseFloat(data?.result?.symbols?.USDTTMN?.stats?.lastPrice);
    if (price && !isNaN(price)) return Math.round(price);
  } catch (err) {
    console.warn('⚠️ خطا در دریافت نرخ لحظه‌ای والکس، نرخ تتر روی ۲۷۰,۰۰۰ تومان تنظیم شد.');
  }
  return 270000; // نرخ پیش‌فرض تتر به تومان در سال ۲۰۲۶
}

// دیتابیس واقعی کالاها و اشتراک‌ها با قیمت‌های روز ۲۰۲۶
const targetWatchlist = [
  {
    id: 'chatgpt-plus',
    name: 'ChatGPT Plus (اکانت اختصاصی ماهانه)',
    category: 'دیجیتال / هوش مصنوعی',
    source: 'AIPAY99 (شبکه BEP20 با متامسک)',
    currency: 'USDT',
    cost: 18.80,
    // قیمت فروش روز در ایران در سال ۲۰۲۶ متناسب با دلار ۲۷۰ هزار تومانی:
    marketSellPriceToman: 5950000,
    networkFeeUsd: 0.15
  },
  {
    id: 'claude-pro',
    name: 'Claude Pro (اشتراک اختصاصی ماهانه)',
    category: 'دیجیتال / هوش مصنوعی',
    source: 'AIPAY99 / متامسک',
    currency: 'USDT',
    cost: 25.50,
    marketSellPriceToman: 7900000,
    networkFeeUsd: 0.15
  },
  {
    id: 'cursor-pro',
    name: 'Cursor Pro (اشتراک توسعه‌دهندگان AI)',
    category: 'دیجیتال / برنامه‌نویسی',
    source: 'suzhe.ai / تأمین کریپتو',
    currency: 'USDT',
    cost: 16.00,
    marketSellPriceToman: 5100000,
    networkFeeUsd: 0.15
  },
  {
    id: 'apple-20w-charger',
    name: 'شارژر ۲۰ وات اورجینال اپل (پارت B/A اصلی)',
    category: 'فیزیکی / اکسسوری استور',
    source: 'حراجی تأمین‌کننده بازار تهران / بلک‌فرایدی',
    currency: 'TOMAN',
    cost: 1320000,
    marketSellPriceToman: 1850000,
    networkFeeUsd: 0
  },
  {
    id: 'ps5-dualsense',
    name: 'دسته پلی‌استیشن ۵ DualSense (سفید/مشکی)',
    category: 'فیزیکی / گیمینگ',
    source: 'فلش‌سیل داخلی',
    currency: 'TOMAN',
    cost: 3650000,
    marketSellPriceToman: 4400000,
    networkFeeUsd: 0
  }
];

async function runArbitrageEngine() {
  console.log('🚀 در حال اجرای زنده موتور شکار فرصت‌های بلک‌فرایدی...\n');
  const usdtRate = await getLiveUsdtPrice();
  console.log(`💵 نرخ استعلام‌شده تتر (والکس): ${Number(usdtRate).toLocaleString('fa-IR')} تومان\n`);
  console.log('='.repeat(65));

  const opportunities = [];

  for (const item of targetWatchlist) {
    let costInToman = 0;
    if (item.currency === 'TOMAN') {
      costInToman = item.cost;
    } else if (item.currency === 'USDT') {
      const totalUsdt = item.cost + item.networkFeeUsd;
      costInToman = Math.round(totalUsdt * usdtRate);
    }

    const netProfit = item.marketSellPriceToman - costInToman;
    const margin = ((netProfit / costInToman) * 100).toFixed(1);

    const isDeal = margin >= 12.0;

    const result = {
      ...item,
      costInToman,
      netProfit,
      margin: parseFloat(margin),
      isDeal
    };

    if (isDeal) {
      opportunities.push(result);
    }

    const badge = isDeal ? '🎯 [شکار سودآور]' : '⏳ [سود معمولی]';
    console.log(`${badge} ${item.name}`);
    console.log(`   منبع: ${item.source}`);
    console.log(`   قیمت تمام‌شده: ${Number(costInToman).toLocaleString('fa-IR')} تومان`);
    console.log(`   قیمت فروش در بازار: ${Number(item.marketSellPriceToman).toLocaleString('fa-IR')} تومان`);
    console.log(`   سود خالص: ${Number(netProfit).toLocaleString('fa-IR')} تومان (${margin}٪ حاشیه سود)`);
    console.log('-'.repeat(65));
  }

  console.log(`\n✅ کل موقعیت‌های سودآور تأییدشده: ${opportunities.length} مورد`);
  fs.writeFileSync('active_deals.json', JSON.stringify(opportunities, null, 2));
  console.log('📁 فایل فرصت‌های فعال در active_deals.json بروزرسانی شد.');
}

runArbitrageEngine();
