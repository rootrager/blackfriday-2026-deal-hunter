import json

with open('/home/mhdi/Project/open-learn/blackfriday/enterprise_54_node_workflow.json') as f:
    wf = json.load(f)

# 1. Fix port 3100 -> 3000 in all nodes
for node in wf['nodes']:
    params = node.get('parameters', {})
    if 'url' in params and '3100' in params['url']:
        params['url'] = params['url'].replace('3100', '3000')
    if node['name'] == 'FX1. Wallex Live USDT/TMN':
        # Point to local MCP proxy which never times out and handles live + fallback
        node['parameters']['url'] = 'http://172.17.0.1:3000/mcp/tgju'
        node['parameters']['method'] = 'POST'
        node['parameters']['sendBody'] = True
        node['parameters']['specifyBody'] = 'json'
        node['parameters']['jsonBody'] = '{"service":"tgju"}'
        node['parameters']['options'] = {'timeout': 5000}
        if 'onError' in node:
            del node['onError']

    if node['name'] == 'FX5. Toman FX Normalizer':
        node['parameters']['jsCode'] = """let usdtToman = 274749;
let usdFreeToman = 275848;
let fxSource = 'fallback_calibrated';
let cnyToUsd = 0.14;
let gasUsd = { 'BSC/BEP20': 0.15, 'TRON/TRC20': 1.00, 'Base/Polygon': 0.20, 'Alipay/CNY': 0.25, 'Shaparak': 0.00 };

try {
  const wallex = $('FX1. Wallex Live USDT/TMN').first()?.json;
  const p1 = parseFloat(wallex?.result?.symbols?.USDTTMN?.stats?.lastPrice);
  const p2 = parseFloat(wallex?.rows?.find(r => r.symbol === 'usdt')?.price_toman);
  if (Number.isFinite(p1) && p1 > 10000) { usdtToman = Math.round(p1); fxSource = 'wallex_live'; }
  else if (Number.isFinite(p2) && p2 > 10000) { usdtToman = Math.round(p2); fxSource = wallex?.source || 'mcp_proxy'; }
} catch (e) {}

try {
  const tgju = $('FX2. TGJU Free FX (USD/EUR/AED)').first()?.json;
  const rows = tgju?.rows || [];
  const usdRow = rows.find(r => /dollar/i.test(String(r.symbol || '')) || String(r.name || '').includes('دلار'));
  const usdtRow = rows.find(r => /usdt/i.test(String(r.symbol || '')) || String(r.name || '').includes('تتر'));
  if (usdRow?.price_toman) usdFreeToman = Math.round(Number(usdRow.price_toman));
  if (!usdtToman && usdtRow?.price_toman) { usdtToman = Math.round(Number(usdtRow.price_toman)); fxSource = 'tgju_proxy'; }
} catch (e) {}

try {
  const cny = $('FX3. CNY/USD Parity Converter').first()?.json?.cny_to_usd;
  if (cny) cnyToUsd = cny;
} catch (e) {}

try {
  const gas = $('FX4. Network Gas Estimator (BSC/TRC20)').first()?.json?.gas_usd;
  if (gas) gasUsd = gas;
} catch (e) {}

return [{ json: {
  usdt_toman: usdtToman,
  usd_free_toman: usdFreeToman,
  cny_to_usd: cnyToUsd,
  gas_usd: gasUsd,
  fx_source: fxSource,
  fx_error: false,
  fetched_at: new Date().toISOString()
} }];"""

    if node['name'] == 'V1. Canonical JSON Schema Normalizer':
        code = node['parameters']['jsCode']
        code = code.replace(
            "const fx = $('FX6. FX Cache & Outage Fallback').first()?.json || { usdt_toman: 272100, cny_to_usd: 0.14 };",
            "const fx = (() => { try { return $('FX6. FX Cache & Outage Fallback').first()?.json; } catch(e) { return null; } })() || { usdt_toman: 274749, cny_to_usd: 0.14 };"
        )
        node['parameters']['jsCode'] = code

# 2. Build clean, deterministic pipeline connections
conns = {}

def connect(src, dsts, branch=0):
    if src not in conns:
        conns[src] = {'main': []}
    while len(conns[src]['main']) <= branch:
        conns[src]['main'].append([])
    for d in dsts:
        conns[src]['main'][branch].append({'node': d, 'type': 'main', 'index': 0})

# Triggers
connect('T1. Schedule (Every 20m)', ['FX1. Wallex Live USDT/TMN'])
connect('T2. Manual Live Test Webhook', ['FX1. Wallex Live USDT/TMN'])
connect('T4. Nightly Sync Cron', ['FX1. Wallex Live USDT/TMN'])
connect('T3. Emergency Reset Webhook', ['R4. 6-Hour Deduplication Memory'])

# Stage 2 FX Pipeline (Sequential to guarantee order and zero race conditions)
connect('FX1. Wallex Live USDT/TMN', ['FX2. TGJU Free FX (USD/EUR/AED)'])
connect('FX2. TGJU Free FX (USD/EUR/AED)', ['FX3. CNY/USD Parity Converter'])
connect('FX3. CNY/USD Parity Converter', ['FX4. Network Gas Estimator (BSC/TRC20)'])
connect('FX4. Network Gas Estimator (BSC/TRC20)', ['FX5. Toman FX Normalizer'])
connect('FX5. Toman FX Normalizer', ['FX6. FX Cache & Outage Fallback'])

# Stage 3 Watchlists (Sequential seed propagation)
connect('FX6. FX Cache & Outage Fallback', ['W1. Apple Ecosystem Watchlist'])
connect('W1. Apple Ecosystem Watchlist', ['W2. Gaming Consoles Watchlist'])
connect('W2. Gaming Consoles Watchlist', ['W3. PC Hardware & NVMe SSD'])
connect('W3. PC Hardware & NVMe SSD', ['W4. Used C2C Mobile (iPhone 13/14)'])
connect('W4. Used C2C Mobile (iPhone 13/14)', ['W5. Consumer AI Subscriptions'])
connect('W5. Consumer AI Subscriptions', ['W6. AI Coding IDEs (Cursor Pro)'])
connect('W6. AI Coding IDEs (Cursor Pro)', ['W7. Creative & Media Tools'])
connect('W7. Creative & Media Tools', ['W8. API Credit Gateways'])

# Stage 4 Collectors (Sequential market queries)
connect('W8. API Credit Gateways', ['C1. Torob Median Baseline'])
connect('C1. Torob Median Baseline', ['C2. Torob Price History'])
connect('C2. Torob Price History', ['C3. Digikala Flash Campaigns'])
connect('C3. Digikala Flash Campaigns', ['C4. Digikala Buybox Offers'])
connect('C4. Digikala Buybox Offers', ['C5. Technolife Flash Deals'])
connect('C5. Technolife Flash Deals', ['C6. Technolife Installment Rates'])
connect('C6. Technolife Installment Rates', ['C7. Divar Tehran C2C Ads'])
connect('C7. Divar Tehran C2C Ads', ['C8. Divar Urgent Filter'])
connect('C8. Divar Urgent Filter', ['C9. AIPAY99 USDT Storefront'])
connect('C9. AIPAY99 USDT Storefront', ['C10. SuZhe AI Storefront'])
connect('C10. SuZhe AI Storefront', ['C11. OpenRouter USDC Gateway'])
connect('C11. OpenRouter USDC Gateway', ['C12. TeamoRouter Multi-Net'])

# Stage 5 Valuation & Anti-Fraud
connect('C12. TeamoRouter Multi-Net', ['V1. Canonical JSON Schema Normalizer'])
connect('V1. Canonical JSON Schema Normalizer', ['V2. Fake Discount Detector'])
connect('V2. Fake Discount Detector', ['V3. Divar <40% Manual Review Filter'])
connect('V3. Divar <40% Manual Review Filter', ['V4. Liquidity Cap Guard (>45M TMN)'])
connect('V4. Liquidity Cap Guard (>45M TMN)', ['V5. MetaMask Network Validator'])
connect('V5. MetaMask Network Validator', ['V6. Evidence & Source Logger'])
connect('V6. Evidence & Source Logger', ['V7. Ban & Warranty Classifier'])
connect('V7. Ban & Warranty Classifier', ['V8. Price Volatility Calculator'])

# Stage 6 Arbitrage Engine
connect('V8. Price Volatility Calculator', ['M1. Total Landed Cost Engine'])
connect('M1. Total Landed Cost Engine', ['M2. Net Profit Calculator'])
connect('M2. Net Profit Calculator', ['M3. Net Margin % Calculator'])
connect('M3. Net Margin % Calculator', ['M4. Cycle ROI Calculator'])
connect('M4. Cycle ROI Calculator', ['M5. 100M TMN Budget Allocator'])
connect('M5. 100M TMN Budget Allocator', ['M6. Deal Quality Grader & Card Formatter'])

# Stage 7 Memory & Router
connect('M6. Deal Quality Grader & Card Formatter', ['R4. 6-Hour Deduplication Memory'])
connect('R4. 6-Hour Deduplication Memory', ['R1. 4-Branch Switch Router'])

# Switch router outputs: 0=A+, 1=A, 2=ManualReview, 3=Drop
connect('R1. 4-Branch Switch Router', ['R2. Grade A+ Golden Guard (>30%)'], branch=0)
connect('R1. 4-Branch Switch Router', ['R3. Grade A Standard Guard (18-30%)'], branch=1)
connect('R1. 4-Branch Switch Router', ['D3. Admin Manual Review Queue (<40% Divar)'], branch=2)
connect('R1. 4-Branch Switch Router', ['D5. PostgreSQL / JSON Deal Ledger Logger'], branch=3)

# R2 Guard: True -> D1 + D5, False -> D5
connect('R2. Grade A+ Golden Guard (>30%)', ['D1. Telegram Golden Deal Card (A+)', 'D5. PostgreSQL / JSON Deal Ledger Logger'], branch=0)
connect('R2. Grade A+ Golden Guard (>30%)', ['D5. PostgreSQL / JSON Deal Ledger Logger'], branch=1)

# R3 Guard: True -> D2 + D5, False -> D5
connect('R3. Grade A Standard Guard (18-30%)', ['D2. Telegram Standard Archive Feed (A)', 'D5. PostgreSQL / JSON Deal Ledger Logger'], branch=0)
connect('R3. Grade A Standard Guard (18-30%)', ['D5. PostgreSQL / JSON Deal Ledger Logger'], branch=1)

# D3 Manual Review -> D5
connect('D3. Admin Manual Review Queue (<40% Divar)', ['D5. PostgreSQL / JSON Deal Ledger Logger'])

# Stage 8 Dispatchers -> D6 Output
connect('D1. Telegram Golden Deal Card (A+)', ['D6. Pipeline Health Summary Output'])
connect('D2. Telegram Standard Archive Feed (A)', ['D6. Pipeline Health Summary Output'])
connect('D4. Admin System Error Alert', ['D6. Pipeline Health Summary Output'])
connect('D5. PostgreSQL / JSON Deal Ledger Logger', ['D6. Pipeline Health Summary Output'])

wf['connections'] = conns

with open('/home/mhdi/Project/open-learn/blackfriday/enterprise_54_node_workflow_fixed.json', 'w') as f:
    json.dump(wf, f, indent=2)

print('Generated enterprise_54_node_workflow_fixed.json successfully!')

