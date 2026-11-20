# Black Friday 2026 Deal Hunter & AI Arbitrage Engine

Autonomous trading opportunity radar and price intelligence engine designed for Black Friday 2026, targeting the Iranian consumer electronics market and crypto-settled international digital services.

## Architecture & Components
- **Market Intelligence:** Dual-stream scanning across Iranian e-commerce (Torob, Digikala, Technolife, Divar) and global AI subscription providers (ChatGPT Plus, Claude Pro, Cursor Pro).
- **Execution & Normalization:** Multi-currency normalization engine (`engine.js`) converting USDT/CNY rates to Iranian Toman with live exchange rates.
- **Workflow Automation:** Production-ready n8n workflows (`workflow_stable_http.json`) with Telegram Deal Alert dispatching.
- **MCP Ecosystem Integration:** Standardized proxy layer connecting to Iran-MCP servers (`mcp_http_proxy.js`).

## Repository Structure
- `engine.js`: Multi-currency arbitrage calculator and margin validation.
- `mcp_http_proxy.js`: High-speed REST/HTTP proxy for local MCP servers.
- `first-research.md`: Comprehensive field research from Grok and Perplexity on Black Friday 2026 demand and crypto providers.
- `hermes_system_prompt.md`: System prompt & operational protocol for Hermes Agent.
- `workflow_stable_http.json`: Complete n8n workflow for deployment.
