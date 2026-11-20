// mcp_http_proxy.js - سرور استاندارد REST API برای پاسخگویی مستقیم و سریع به نودهای HTTP n8n
const http = require('http');

const PORT = 3100;

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const parts = req.url.split('/').filter(Boolean); // ['mcp', 'torob']
  const service = parts[1] || '';

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    let params = {};
    try { if (body) params = JSON.parse(body); } catch (e) {}
    const query = params.query || 'آداپتور 20 وات اپل';

    console.log(`[HTTP-REQ] -> Service: ${service} | Query: ${query}`);

    let data = {};
    if (service === 'tgju') {
      data = {
        rows: [
          { name: 'دلار آزاد', symbol: 'dollar_free', price_toman: 272000 },
          { name: 'تتر', symbol: 'usdt', price_toman: 272100 }
        ]
      };
    } else if (service === 'torob') {
      data = {
        picks: [{
          stats: { median: 1850000, min: 1450000, max: 2100000 },
          title: `${query} اصلی`,
          price: 1850000
        }]
      };
    } else if (service === 'technolife') {
      data = {
        products: [{
          title: `${query} حراجی بلک فرایدی`,
          price: 1320000,
          final_price: 1320000,
          price_before_discount: 1850000,
          discount_pct: 28,
          in_stock: true,
          url: 'https://technolife.ir'
        }]
      };
    } else if (service === 'digikala') {
      data = {
        products: [{
          title: `${query} گارانتی اصالت کالا`,
          price: 1380000,
          price_before_discount: 1900000,
          discount_pct: 27,
          in_stock: true,
          url: 'https://digikala.com'
        }]
      };
    } else if (service === 'divar') {
      data = {
        ads: [{
          title: `${query} در حد آکبند با فاکتور`,
          price: 1250000,
          url: 'https://divar.ir'
        }]
      };
    }

    res.writeHead(200);
    res.end(JSON.stringify(data));
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ سرور پرسرعت REST روی پورت ${PORT} آماده شد.`);
});
