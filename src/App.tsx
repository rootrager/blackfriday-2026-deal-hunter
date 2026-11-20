import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BookOpen,
  GitBranch,
  LineChart as LineChartIcon,
  Menu,
  RefreshCw,
  Server,
  X,
} from 'lucide-react';
import type {
  ArbitrageStateResponse,
  EngineConfig,
  EvaluatedDeal,
  MarketInsightItem,
  SupplierLead,
  WatchlistItem,
  WorkflowAsset,
} from './types/arbitrage';
import { RadarOverviewView } from './components/RadarOverviewView';
import { SimulatorView } from './components/SimulatorView';
import { WorkflowStudioView } from './components/WorkflowStudioView';
import { McpProxyView } from './components/McpProxyView';
import { ResearchIntelView } from './components/ResearchIntelView';
import { DealInspectorDrawer } from './components/DealInspectorDrawer';
import { AddWatchlistModal } from './components/AddWatchlistModal';

type NavTab = 'radar' | 'simulator' | 'workflows' | 'mcp' | 'research';

interface ResearchPayload {
  checkedDate: string;
  campaignDates: { blackFriday: string; cyberMonday: string };
  suppliers: SupplierLead[];
  marketInsights: MarketInsightItem[];
  safeguards: string[];
}

const NAV_ITEMS: Array<{ id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'radar', label: 'Arbitrage Radar', icon: Activity },
  { id: 'simulator', label: 'FX & Budget Simulator', icon: LineChartIcon },
  { id: 'workflows', label: 'n8n Workflow Studio', icon: GitBranch },
  { id: 'mcp', label: 'MCP Proxy Sandbox', icon: Server },
  { id: 'research', label: 'Supplier Intelligence', icon: BookOpen },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('radar');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [state, setState] = useState<ArbitrageStateResponse | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowAsset[]>([]);
  const [research, setResearch] = useState<ResearchPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      setError(null);
      const [stateRes, wfRes, resRes] = await Promise.all([
        fetch('/api/state'),
        fetch('/api/workflows'),
        fetch('/api/research'),
      ]);
      if (!stateRes.ok) throw new Error('Failed to load arbitrage engine state');
      const stateJson = (await stateRes.json()) as ArbitrageStateResponse;
      const wfJson = (await wfRes.json()) as { workflows: WorkflowAsset[] };
      const resJson = (await resRes.json()) as ResearchPayload;

      setState(stateJson);
      setWorkflows(wfJson.workflows || []);
      setResearch(resJson);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach backend API');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const refreshWorkflows = useCallback(async () => {
    try {
      const wfRes = await fetch('/api/workflows');
      if (wfRes.ok) {
        const wfJson = (await wfRes.json()) as { workflows: WorkflowAsset[] };
        setWorkflows(wfJson.workflows || []);
      }
    } catch {
      // Non-blocking refresh
    }
  }, []);

  const handleRunLiveScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordDedupe: true }),
      });
      if (!res.ok) throw new Error('Live scan failed');
      const next = (await res.json()) as ArbitrageStateResponse;
      setState(next);
      refreshWorkflows();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Live scan failed');
    } finally {
      setScanning(false);
    }
  };

  const handleUpdateConfig = async (patch: Partial<EngineConfig>) => {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const next = (await res.json()) as ArbitrageStateResponse;
      setState(next);
      refreshWorkflows();
    }
  };

  const handleClearDedupe = async () => {
    const res = await fetch('/api/dedupe/clear', { method: 'POST' });
    if (res.ok) {
      const next = (await res.json()) as ArbitrageStateResponse;
      setState(next);
    }
  };

  const handleAddWatchlist = async (item: Partial<WatchlistItem>) => {
    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
    if (res.ok) {
      const next = (await res.json()) as ArbitrageStateResponse;
      setState(next);
      refreshWorkflows();
    }
  };

  const handleUpdateWatchlist = async (id: string, patch: Partial<EvaluatedDeal>) => {
    const res = await fetch(`/api/watchlist/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const next = (await res.json()) as ArbitrageStateResponse;
      setState(next);
      refreshWorkflows();
    }
  };

  const handleDeleteWatchlist = async (id: string) => {
    const res = await fetch(`/api/watchlist/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      const next = (await res.json()) as ArbitrageStateResponse;
      setState(next);
      refreshWorkflows();
    }
  };

  const selectedDeal = state?.deals.find((d) => d.id === selectedDealId) ?? null;
  const activeNavMeta = NAV_ITEMS.find((n) => n.id === activeTab) ?? NAV_ITEMS[0];

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-16 items-center border-b border-slate-200 px-6">
          <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            Arbitrage Radar 2026
          </span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-5" aria-label="Workspace Navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 px-6 py-4 text-xs text-slate-500">
          <div className="font-medium text-slate-700">Tehran Dual-Engine Desk</div>
          <div className="mt-0.5">Physical Tech · Crypto AI SaaS</div>
        </div>
      </aside>

      {/* Mobile Drawer Navigation */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 flex bg-slate-900/30 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        >
          <aside
            className="flex h-full w-64 flex-col border-r border-slate-200 bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-16 items-center justify-between border-b border-slate-200 px-5">
              <span className="font-display text-base font-bold tracking-tight text-slate-900">
                Arbitrage Radar 2026
              </span>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation"
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 px-3 py-4">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileNavOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                      isActive
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Workspace Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Clean Contextual Top Bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="hidden text-slate-400 sm:inline whitespace-nowrap">
                Black Friday 2026
              </span>
              <span className="hidden text-slate-300 sm:inline">/</span>
              <span className="truncate font-semibold text-slate-900">{activeNavMeta.label}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleRunLiveScan}
            disabled={scanning || loading}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-800 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Scanning Feeds...' : 'Run Live Scan'}
          </button>
        </header>

        {/* Main Viewport */}
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-8 sm:px-8">
          {error && (
            <div className="mb-6 flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
              <span>{error}</span>
              <button
                type="button"
                onClick={loadAll}
                className="font-medium underline hover:text-red-950 whitespace-nowrap"
              >
                Retry
              </button>
            </div>
          )}

          {loading || !state ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-28 animate-pulse rounded-lg border border-slate-200 bg-white"
                  />
                ))}
              </div>
              <div className="h-96 animate-pulse rounded-lg border border-slate-200 bg-white" />
            </div>
          ) : (
            <>
              {activeTab === 'radar' && (
                <RadarOverviewView
                  state={state}
                  onSelectDeal={(deal) => setSelectedDealId(deal.id)}
                  onOpenAddModal={() => setAddModalOpen(true)}
                  onUpdateConfig={handleUpdateConfig}
                  onClearDedupe={handleClearDedupe}
                />
              )}

              {activeTab === 'simulator' && (
                <SimulatorView deals={state.deals} config={state.config} fx={state.fx} />
              )}

              {activeTab === 'workflows' && (
                <WorkflowStudioView workflows={workflows} loading={loading} />
              )}

              {activeTab === 'mcp' && <McpProxyView />}

              {activeTab === 'research' && (
                <ResearchIntelView research={research} loading={loading} />
              )}
            </>
          )}
        </main>
      </div>

      {/* Deal Inspector Slide-Over */}
      {state && (
        <DealInspectorDrawer
          deal={selectedDeal}
          fx={state.fx}
          onClose={() => setSelectedDealId(null)}
          onUpdate={handleUpdateWatchlist}
          onDelete={handleDeleteWatchlist}
        />
      )}

      {/* Add Watchlist Item Modal */}
      {state && (
        <AddWatchlistModal
          open={addModalOpen}
          fx={state.fx}
          onClose={() => setAddModalOpen(false)}
          onAdd={handleAddWatchlist}
        />
      )}
    </div>
  );
}
