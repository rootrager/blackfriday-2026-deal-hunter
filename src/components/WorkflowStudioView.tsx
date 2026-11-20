import React, { useEffect, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import type { WorkflowAsset } from '../types/arbitrage';

interface WorkflowStudioViewProps {
  workflows: WorkflowAsset[];
  loading: boolean;
}

export const WorkflowStudioView: React.FC<WorkflowStudioViewProps> = ({ workflows, loading }) => {
  const [selectedId, setSelectedId] = useState<string>('');
  const [activePhase, setActivePhase] = useState<number>(1);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!selectedId && workflows.length > 0) {
      setSelectedId(workflows[0].id);
    }
  }, [workflows, selectedId]);

  const active = workflows.find((w) => w.id === selectedId) ?? workflows[0];
  const formattedJson = active ? JSON.stringify(active.json, null, 2) : '';
  const phases = active?.phases ?? [];
  const currentPhase = phases.find((p) => p.phase === activePhase) ?? phases[0];

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
        <h1 className="text-xl font-semibold text-slate-900">
          Enterprise 54-Node n8n Workflow Studio
        </h1>
        <p className="text-sm text-slate-600">
          Inspect all 8 modular architectural phases (54 interconnected nodes), explore individual node roles, and export raw importable n8n JSON synchronized with your active risk rules.
        </p>
      </div>

      {/* Interactive 8-Phase / 54-Node Blueprint Explorer */}
      {phases.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-6 py-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                8-Phase Modular Blueprint ({active.nodeCount} Nodes Total)
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Select any phase below to inspect its constituent n8n nodes and responsibilities.
              </p>
            </div>
            <div className="font-mono text-xs text-slate-500">
              4 + 6 + 8 + 12 + 8 + 6 + 4 + 6 = 54 nodes
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 border-b border-slate-200 p-4 sm:grid-cols-4 lg:grid-cols-8">
            {phases.map((phase) => {
              const selected = currentPhase?.phase === phase.phase;
              return (
                <button
                  key={phase.code}
                  type="button"
                  onClick={() => setActivePhase(phase.phase)}
                  className={`flex flex-col items-start rounded-md border p-3 text-left transition-colors ${
                    selected
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-slate-50/70 text-slate-800 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div
                    className={`font-mono text-[11px] font-medium ${
                      selected ? 'text-slate-300' : 'text-slate-400'
                    }`}
                  >
                    Phase {phase.phase} · {phase.nodeCount}n
                  </div>
                  <div className="mt-1 text-xs font-semibold leading-snug">{phase.title}</div>
                </button>
              );
            })}
          </div>

          {currentPhase && (
            <div className="p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2 pb-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Phase {currentPhase.phase}: {currentPhase.title} ({currentPhase.nodeCount} Nodes)
                  </h3>
                  <p className="font-persian mt-0.5 text-xs text-slate-500" dir="rtl">
                    {currentPhase.titleFa}
                  </p>
                </div>
                <span className="font-mono text-xs text-slate-500">Stage {currentPhase.code}</span>
              </div>

              <div className="overflow-x-auto rounded-md border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <th className="px-4 py-2.5 font-medium">Node ID</th>
                      <th className="px-4 py-2.5 font-medium">n8n Node Name</th>
                      <th className="px-4 py-2.5 font-medium">Node Type</th>
                      <th className="px-4 py-2.5 font-medium">Operational Role</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {currentPhase.nodes.map((node) => (
                      <tr key={node.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2.5 font-mono font-semibold text-slate-900 whitespace-nowrap">
                          {node.id}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-slate-800 whitespace-nowrap">
                          {node.name}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-500 whitespace-nowrap">
                          {node.type}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">{node.role}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

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
                  setActivePhase(1);
                  setCopied(false);
                }}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  active?.id === wf.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {wf.filename} ({wf.nodeCount})
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
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
                <div className="text-slate-500">Schedule & Node Count</div>
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
