import React, { useState } from 'react';
import { Play } from 'lucide-react';

const SERVICES = [
  { id: 'tgju', label: 'TGJU Exchange Rates', defaultQuery: 'usdt', desc: 'Live USD, USDT & CNY rates in Toman' },
  { id: 'torob', label: 'Torob Median Baseline', defaultQuery: 'آداپتور 20 وات اپل', desc: 'Market median, min & max liquidity band' },
  { id: 'technolife', label: 'Technolife Flash Sales', defaultQuery: 'آداپتور 20 وات اپل', desc: 'Promotional pricing & before-discount audit' },
  { id: 'digikala', label: 'Digikala Harajomeh', defaultQuery: 'دسته PS5 DualSense', desc: 'Campaign SKU pricing & stock flag' },
  { id: 'divar', label: 'Divar Urgent C2C', defaultQuery: 'آیفون ۱۳ کارکرده', desc: 'Used C2C ads including low-ball scam guard sample' },
];

export const McpProxyView: React.FC = () => {
  const [service, setService] = useState('torob');
  const [query, setQuery] = useState('آداپتور 20 وات اپل');
  const [responseBody, setResponseBody] = useState<string>('');
  const [meta, setMeta] = useState<{ status: number; durationMs: number; endpoint: string } | null>(
    null,
  );
  const [running, setRunning] = useState(false);

  const handleRunTest = async (targetService = service, targetQuery = query) => {
    setRunning(true);
    const start = performance.now();
    const endpoint = `/mcp/${targetService}`;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service: targetService, query: targetQuery }),
      });
      const data = await res.json();
      setResponseBody(JSON.stringify(data, null, 2));
      setMeta({
        status: res.status,
        durationMs: Math.round(performance.now() - start),
        endpoint,
      });
    } catch (err) {
      setResponseBody(
        JSON.stringify({ error: err instanceof Error ? err.message : 'Request failed' }, null, 2),
      );
      setMeta({ status: 500, durationMs: Math.round(performance.now() - start), endpoint });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-slate-900">Integrated MCP HTTP Proxy Sandbox</h1>
        <p className="text-sm text-slate-600">
          Direct REST endpoints migrated from <span className="font-mono text-xs text-slate-800">mcp_http_proxy.js</span> onto port 3000 (<span className="font-mono text-xs text-slate-800">POST /mcp/:service</span>) for resilient n8n HTTP Request nodes without fragile MCP wrappers.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Service List & Request Form */}
        <div className="space-y-4 lg:col-span-5">
          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-3.5">
              <h2 className="text-sm font-semibold text-slate-900">Select Proxy Service</h2>
            </div>
            <div className="divide-y divide-slate-100">
              {SERVICES.map((svc) => (
                <button
                  key={svc.id}
                  type="button"
                  onClick={() => {
                    setService(svc.id);
                    setQuery(svc.defaultQuery);
                    handleRunTest(svc.id, svc.defaultQuery);
                  }}
                  className={`flex w-full items-start justify-between px-5 py-3.5 text-left transition-colors ${
                    service === svc.id ? 'bg-slate-50' : 'hover:bg-slate-50/60'
                  }`}
                >
                  <div>
                    <div className="text-sm font-medium text-slate-900">{svc.label}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{svc.desc}</div>
                  </div>
                  <span className="font-mono text-xs text-slate-500 whitespace-nowrap">
                    /mcp/{svc.id}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
            <label className="block text-xs font-medium text-slate-700">
              Search Query Payload
              <input
                type="text"
                dir="auto"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="font-persian mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() => handleRunTest()}
              disabled={running}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
            >
              <Play className="h-3.5 w-3.5" />
              {running ? 'Sending Request...' : `POST /mcp/${service}`}
            </button>
          </div>
        </div>

        {/* Right JSON Output */}
        <div className="rounded-lg border border-slate-200 bg-white lg:col-span-7 flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 text-xs">
            <span className="font-semibold text-slate-900">Response Payload</span>
            {meta ? (
              <div className="flex items-center gap-2 font-mono tabular-nums text-slate-600">
                <span>POST {meta.endpoint}</span>
                <span aria-hidden="true">·</span>
                <span className={meta.status < 300 ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium'}>
                  HTTP {meta.status}
                </span>
                <span aria-hidden="true">·</span>
                <span>{meta.durationMs}ms</span>
              </div>
            ) : (
              <span className="text-slate-500">Select a service or run query</span>
            )}
          </div>
          <div className="flex-1 p-5">
            {responseBody ? (
              <pre className="h-full min-h-[340px] overflow-auto rounded-md border border-slate-200 bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-100">
                {responseBody}
              </pre>
            ) : (
              <div className="flex h-full min-h-[340px] flex-col items-center justify-center rounded-md border border-dashed border-slate-300 p-8 text-center">
                <p className="text-sm font-medium text-slate-700">No proxy query executed yet</p>
                <p className="mt-1 max-w-sm text-xs text-slate-500">
                  Click any service on the left or run a custom query to inspect the normalized JSON payload returned to n8n.
                </p>
                <button
                  type="button"
                  onClick={() => handleRunTest('torob', 'آداپتور 20 وات اپل')}
                  className="mt-4 rounded-md bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
                >
                  Run Sample Torob Query
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
