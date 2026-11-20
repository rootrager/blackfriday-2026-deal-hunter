import React, { useEffect, useState } from 'react';
import { ArrowRight, Check, Copy, Download } from 'lucide-react';
import type { WorkflowAsset } from '../types/arbitrage';

interface WorkflowStudioViewProps {
  workflows: WorkflowAsset[];
  loading: boolean;
}

const PIPELINE_STAGES = [
  { step: '01', title: 'Triggers', detail: 'Every 20m Schedule + Manual POST Webhook' },
  { step: '02', title: 'Live FX Fetcher', detail: 'Wallex API USDT/TMN + 270k fallback' },
  { step: '03', title: 'Dual Watchlist', detail: 'Physical Tech + Crypto AI Subscriptions' },
  { step: '04', title: 'HTTP / MCP Feeds', detail: 'Torob · Technolife · Digikala · Divar' },
  { step: '05', title: 'Margin & Guard', detail: 'Fake discount + 40% scam floor + 35M cap' },
  { step: '06', title: 'Filter & Dedupe', detail: 'Margin >= 18% + 6h static data memory' },
  { step: '07', title: 'Telegram Card', detail: 'Persian HTML + Direct Buy Inline Button' },
];

export const WorkflowStudioView: React.FC<WorkflowStudioViewProps> = ({ workflows, loading }) => {
  const [selectedId, setSelectedId] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!selectedId && workflows.length > 0) {
      setSelectedId(workflows[0].id);
    }
  }, [workflows, selectedId]);

  const active = workflows.find((w) => w.id === selectedId) ?? workflows[0];
  const formattedJson = active ? JSON.stringify(active.json, null, 2) : '';

  const handleCopy = async () => {
    if (!formattedJson) return;
    try {
      await navigator.clipboard.writeText(formattedJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleDownload = () => {
    if (!active) return;
    const blob = new Blob([formattedJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = active.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-7 w-64 animate-pulse rounded bg-slate-200" />
        <div className="h-40 animate-pulse rounded-lg border border-slate-200 bg-white" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-slate-900">n8n Workflow Studio</h1>
        <p className="text-sm text-slate-600">
          Inspect, copy, or export production-ready n8n workflow JSONs synchronized with your live watchlist and risk thresholds. Sensitive Telegram credentials are parameterized via n8n environment variables.
        </p>
      </div>

      {/* 7-Stage Pipeline Overview */}
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-900">
          Dual-Engine Orchestration Pipeline
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-7">
          {PIPELINE_STAGES.map((stage, index) => (
            <div key={stage.step} className="relative flex flex-col justify-between rounded-md border border-slate-200 bg-slate-50/70 p-3">
              <div>
                <div className="font-mono text-[11px] font-medium text-slate-400">{stage.step}</div>
                <div className="mt-1 text-xs font-semibold text-slate-900">{stage.title}</div>
                <p className="mt-1 text-[11px] leading-4 text-slate-600">{stage.detail}</p>
              </div>
              {index < PIPELINE_STAGES.length - 1 && (
                <ArrowRight className="hidden md:block absolute -right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 bg-white rounded-full" />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Workflow Selector & Raw JSON Viewer */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-col gap-4 border-b border-slate-200 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-1 rounded-md bg-slate-100 p-1">
            {workflows.map((wf) => (
              <button
                key={wf.id}
                type="button"
                onClick={() => {
                  setSelectedId(wf.id);
                  setCopied(false);
                }}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  active?.id === wf.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {wf.filename}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied JSON' : 'Copy Workflow JSON'}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              Download .json
            </button>
          </div>
        </div>

        {active && (
          <>
            <div className="grid grid-cols-1 gap-4 border-b border-slate-200 px-6 py-4 text-xs sm:grid-cols-3">
              <div>
                <div className="text-slate-500">Workflow Profile</div>
                <div className="mt-0.5 font-medium text-slate-900">{active.title}</div>
              </div>
              <div>
                <div className="text-slate-500">Schedule & Nodes</div>
                <div className="mt-0.5 font-mono tabular-nums text-slate-800">
                  {active.nodeCount} nodes · {active.triggerSchedule}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Revenue Streams</div>
                <div className="mt-0.5 text-slate-800">{active.streamsCovered}</div>
              </div>
            </div>
            <div className="p-6">
              <pre className="max-h-[480px] overflow-auto rounded-md border border-slate-200 bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-100">
                {formattedJson}
              </pre>
            </div>
          </>
        )}
      </section>
    </div>
  );
};
