// mcp_http_proxy.js - High-speed REST API proxy for n8n HTTP Request nodes (ESM)
import http from 'node:http';

const PORT = Number(process.env.MCP_PROXY_PORT) || 3100;

const PRODUCT_CATALOG = [
  {
    match: ['آداپتور', 'شارژر', '20 وات', 'apple'],
    title: 'شارژر ۲۰ وات اورجینال اپل (پارت B/A اصلی)',
    median: 1850000,
    technolife: 1320000,
    digikala: 1380000,
    before: 1850000,
    divarClean: 1450000,
    divarSuspicious: 550000,
  },
  {
    match: ['ایرپاد', 'airpods'],
    title: 'ایرپاد پرو ۲ تایپ‌سی اپل',
    median: 14200000,
    technolife: 11800000,
    digikala: 11800000,
    before: 11500000, // Deliberate inflated-promo sample for V2 Fake Discount Detector
    divarClean: 11200000,
    divarSuspicious: 4200000,
  },
  {
    match: ['dualsense', 'دسته'],
    title: 'دسته پلی‌استیشن ۵ DualSense (سفید/مشکی)',
    median: 4400000,
    technolife: 3650000,
    digikala: 3720000,
    before: 4550000,
    divarClean: 3500000,
    divarSuspicious: 1200000,
  },
  {
    match: ['اسلیم', 'ps5', 'پلی استیشن 5'],
    title: 'کنسول پلی‌استیشن ۵ اسلیم دیسک‌خور',
    median: 198000000,
    technolife: 162000000,
    digikala: 165000000,
    before: 198000000,
    divarClean: 158000000,
    divarSuspicious: 55000000,
  },
  {
    match: ['nvme', 'ssd', '1tb'],
    title: 'اس‌اس‌دی ۱ ترابایت NVMe PCIe 4.0',
    median: 29800000,
    technolife: 23500000,
    digikala: 24200000,
    before: 29500000,
    divarClean: 22000000,
    divarSuspicious: 8500000,
  },
  {
    match: ['آیفون 13', 'آیفون ۱۳', 'iphone 13'],
    title: 'آیفون ۱۳ کارکرده ۱۲۸ گیگ تمیز (رجیسترشده)',
    median: 48200000,
    technolife: 46500000,
    digikala: 47000000,
    before: 49500000,
    divarClean: 39500000,
    divarSuspicious: 14000000,
  },
  {
    match: ['آیفون 14', 'آیفون ۱۴', 'iphone 14'],
    title: 'آیفون ۱۴ پرو ۲۵۶ گیگ (آگهی زیر ۴۰٪ دیوار)',
    median: 185000000,
    technolife: 182000000,
    digikala: 184000000,
    before: 190000000,
    divarClean: 155000000,
    divarSuspicious: 58000000, // 31% of Torob median -> triggers V3 Manual Review Queue
  },
];

function findProduct(query) {
  const q = String(query || '').toLowerCase();
  return (
    PRODUCT_CATALOG.find((item) => item.match.some((kw) => q.includes(kw.toLowerCase()))) ||
    PRODUCT_CATALOG[0]
  );
}

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const parts = String(req.url || '')
    .split('?')[0]
    .split('/')
    .filter(Boolean); // ['mcp', 'torob']
  const service = (parts[1] || '').toLowerCase();

  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    let params = {};
    try {
      if (body) params = JSON.parse(body);
    } catch {
      params = {};
    }
    const query = String(params.query || 'آداپتور 20 وات اپل');
    const prod = findProduct(query);

    let data = {};
    if (service === 'tgju') {
      data = {
        service: 'tgju',
        rows: [
          { name: 'دلار آزاد', symbol: 'dollar_free', price_toman: 272000 },
          { name: 'تتر', symbol: 'usdt', price_toman: 272100 },
          { name: 'یورو', symbol: 'eur', price_toman: 293800 },
          { name: 'درهم امارات', symbol: 'aed', price_toman: 74100 },
        ],
      };
    } else if (service === 'torob') {
      data = {
        service: 'torob',
        query,
        picks: [
          {
            stats: {
              median: prod.median,
              min: Math.round(prod.median * 0.88),
              max: Math.round(prod.median * 1.12),
            },
            title: prod.title,
            price: prod.median,
          },
        ],
      };
    } else if (service === 'technolife') {
      const pct = Math.max(0, Math.round(((prod.before - prod.technolife) / prod.before) * 100));
      data = {
        service: 'technolife',
        query,
        products: [
          {
            title: `${prod.title} - حراجی بلک فرایدی`,
            price: prod.technolife,
            final_price: prod.technolife,
            price_before_discount: prod.before,
            discount_pct: pct,
            in_stock: true,
            url: 'https://www.technolife.ir',
          },
        ],
      };
    } else if (service === 'digikala') {
      const pct = Math.max(0, Math.round(((prod.before - prod.digikala) / prod.before) * 100));
      data = {
        service: 'digikala',
        query,
        products: [
          {
            title: `${prod.title} گارانتی اصالت کالا`,
            price: prod.digikala,
            price_before_discount: prod.before,
            discount_pct: pct,
            in_stock: true,
            url: 'https://www.digikala.com',
          },
        ],
      };
    } else if (service === 'divar') {
      const isSuspiciousQuery =
        query.includes('14') || query.includes('۱۴') || query.includes('زیر ۴۰');
      data = {
        service: 'divar',
        query,
        ads: [
          {
            title: `${prod.title} در حد آکبند با فاکتور`,
            price: isSuspiciousQuery ? prod.divarSuspicious : prod.divarClean,
            tag: 'فوری',
            url: 'https://divar.ir',
          },
        ],
      };
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: `Unknown service: ${service}` }));
      return;
    }

    res.writeHead(200);
    res.end(JSON.stringify(data));
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ MCP HTTP Proxy REST server ready on http://0.0.0.0:${PORT}`);
});
