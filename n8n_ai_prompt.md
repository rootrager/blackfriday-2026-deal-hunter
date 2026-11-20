# n8n AI Assistant Prompt: Black Friday Deal Hunter & Iran-MCP Arbitrage Engine
## Repository: https://github.com/sepehr071/iran-mcp

---

### Project Overview & Mission
We are building an automated **Black Friday 2026 Deal Hunter & Price Arbitrage System** for a consumer electronics trader in Tehran who operates inside an active Apple Store with a 100M Toman operating budget.

The goal of this workflow is NOT to execute purchases autonomously, but to act as a **24/7 opportunity radar** that:
1. Periodically queries Iranian e-commerce platforms and pricing aggregators via MCP (Model Context Protocol).
2. Normalizes prices and currencies to Iranian Toman (TMN).
3. Compares flash-sale / promotional prices against historical market benchmarks.
4. Filters high-probability arbitrage opportunities (Net profit margin >= 18% - 20%).
5. Sends structured "Deal Alert Cards" to the trader's private Telegram bot with instant purchase links.

---

### Phase 1 Target MCP Servers (Top 5 Tested Servers)
From the `iran-mcp` ecosystem, this workflow specifically integrates and orchestrates the following 5 servers:

1. **`torob-mcp` (Torob Price Aggregator):**
   - Command: `uvx torob-mcp`
   - Primary Tool: `tb_cheapest` (Finds the lowest trustworthy market offer for electronics).
   - Secondary Tool: `tb_compare` & price history (Validates whether a discount is real or artificially inflated).

2. **`technolife-mcp` (Technolife Consumer Tech Store):**
   - Command: `uvx technolife-mcp`
   - Primary Tool: `tl_category_products` & `tl_deals` (Monitors flash sales, installment rates, and gaming/phone deals).

3. **`digikala-mcp` (Digikala Marketplace):**
   - Command: `uvx digikala-mcp`
   - Primary Tool: `dk_find_cheapest` & `dk_search` (Scans Black Friday / Harajomeh campaigns from Nov 20 to Dec 1).

4. **`divar-mcp` (Divar Second-hand C2C Marketplace):**
   - Command: `uvx divar-mcp`
   - Primary Tool: `dv_categories` & search (Monitors urgent consumer-to-consumer listings for clean used iPhones, PS5 consoles, and MacBooks).

5. **`tgju-mcp` (Financial & Currency Rates):**
   - Command: `uvx tgju-mcp`
   - Primary Tool: `tj_category_table` / symbol lookup (Provides live USDT, USD, and Dirham exchange rates to accurately calculate crypto-settled AI subscription costs).

---

### Expected n8n Workflow Architecture

Design a modular, production-ready workflow with the following structure:

1. **Schedule Trigger:**
   - Runs every 20 or 30 minutes during Black Friday campaign days.
   - Includes a manual Webhook Trigger for instant on-demand testing.

2. **MCP Integration Layer (AI Agent / HTTP Tool Call):**
   - Interfaces with the MCP tools for our Golden Target Watchlist:
     * Apple 20W USB-C Power Adapter (Original)
     * PS5 DualSense Wireless Controller
     * Internal/External 1TB NVMe SSD
     * Used iPhone 13 / 14 Pro listings
     * Live USDT/TMN rate

3. **Normalization & Financial Calculation (Code Node):**
   - Calculates Net Profit = `Market_Benchmark_Price - Promotional_Cost`.
   - Computes Profit Margin % = `(Net_Profit / Promotional_Cost) * 100`.
   - Sets boolean flag `is_high_margin_deal = true` if Margin >= 18%.

4. **Decision Logic (IF Node):**
   - If `is_high_margin_deal` is true, routes to Alert Formatter.
   - If false, gracefully logs the data and stops (avoids Telegram notification spam).

5. **Telegram Alert Formatter & Sender:**
   - Formats a Persian-language Markdown message:
     ```text
     🎯 [سیگنال شکار کالا - BUY ALERT]
     📦 نام محصول: {{ $json.product_name }}
     🏪 پلتفرم: {{ $json.platform }} (استعلام‌شده از MCP)
     💰 قیمت خرید: {{ $json.buy_price_formatted }} تومان
     📈 قیمت کف بازار: {{ $json.market_price_formatted }} تومان
     💵 سود خالص: {{ $json.net_profit_formatted }} تومان ({{ $json.margin_percent }}%)
     ⚠️ وضعیت تخفیف: تایید شده
     🔗 لینک خرید: {{ $json.product_url }}
     ```
   - Sends the message via Telegram Bot API node.

