#!/usr/bin/env bash
set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo "=========================================================="
echo "🚀 Black Friday 2026 Arbitrage Radar — Launcher"
echo "=========================================================="

# 1. Check & start Docker n8n container
echo -n "📦 [1/3] Checking n8n container... "
if docker ps --format '{{.Names}}' | grep -q "^n8n$"; then
    echo "✅ Running"
else
    echo "Starting n8n container..."
    docker start n8n || docker run -d --name n8n -p 5678:5678 -v n8n_data:/home/node/.n8n --restart unless-stopped n8nio/n8n:latest
    echo "✅ n8n started on http://localhost:5678"
fi

# 2. Check & start Dashboard & MCP Proxy Server (port 3000)
echo -n "🌐 [2/3] Checking Dashboard & MCP Gateway (Port 3000)... "
if fuser 3000/tcp >/dev/null 2>&1; then
    echo "✅ Running"
else
    echo "Starting Dashboard server..."
    nohup pnpm dev > "$PROJECT_DIR/server.log" 2>&1 &
    sleep 2
    echo "✅ Server started in background (logs in server.log)"
fi

# 3. Status summary
echo "=========================================================="
echo "🎉 System is ready!"
echo "   👉 Dashboard Workstation : http://localhost:3000"
echo "   👉 n8n Workflow Studio   : http://localhost:5678"
echo "=========================================================="
echo ""
echo "💡 To trigger a live scan right now from CLI, run:"
echo "   curl -X POST http://localhost:5678/webhook/bf2026-live-scan -H 'Content-Type: application/json' -d '{\"trigger\":\"cli\"}'"
echo ""
