'use client';

import { useEffect, useState } from 'react';

interface Agent {
  id: string;
  name: string;
  model: string;
  installUrl: string;
  tokens: number;
  cost: number;
  requests: number;
  createdAt: string;
  lastUsedAt: string | null;
  importSource: 'squidgy_yaml' | 'external_endpoint' | 'external_mcp' | 'composio_mcp' | 'a2a' | 'openai_sdk';
  verificationStatus: 'pending' | 'verified' | 'unverified' | 'stale';
}

const SOURCE_META: Record<Agent['importSource'], { label: string; color: string; bg: string }> = {
  squidgy_yaml: { label: 'Squidgy', color: '#5a2eff', bg: '#ede8ff' },
  external_endpoint: { label: 'Endpoint', color: '#0a7a3f', bg: '#e2f5ea' },
  external_mcp: { label: 'MCP', color: '#a13a3a', bg: '#f8e4e4' },
  composio_mcp: { label: 'Composio', color: '#ad6800', bg: '#fff3d6' },
  a2a: { label: 'A2A', color: '#5b5670', bg: '#eee9f3' },
  openai_sdk: { label: 'OpenAI SDK', color: '#5b5670', bg: '#eee9f3' },
};

const VERIFY_META: Record<Agent['verificationStatus'], { icon: string; label: string; color: string }> = {
  verified: { icon: '✓', label: 'Verified', color: '#0a7a3f' },
  pending: { icon: '⏱', label: 'Pending', color: '#ad6800' },
  unverified: { icon: '⚠', label: 'Unverified', color: '#a13a3a' },
  stale: { icon: '⚠', label: 'Stale', color: '#a13a3a' },
};

function SourcePill({ source }: { source: Agent['importSource'] }) {
  const m = SOURCE_META[source] || SOURCE_META.squidgy_yaml;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      fontSize: 10, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase',
      color: m.color, background: m.bg,
    }}>{m.label}</span>
  );
}

function VerifyBadge({ status }: { status: Agent['verificationStatus'] }) {
  const m = VERIFY_META[status] || VERIFY_META.pending;
  return (
    <span title={m.label} style={{ color: m.color, fontWeight: 700, fontSize: 13 }}>{m.icon}</span>
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function formatCost(c: number): string {
  if (c === 0) return '$0';
  if (c < 0.01) return `$${c.toFixed(6)}`;
  return `$${c.toFixed(4)}`;
}

export default function Dashboard() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  const load = async () => {
    const res = await fetch('/api/agents');
    const data = await res.json();
    setAgents(data.agents || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(t);
      clearInterval(tick);
    };
  }, []);

  const totals = agents.reduce(
    (acc, a) => ({
      tokens: acc.tokens + a.tokens,
      cost: acc.cost + a.cost,
      requests: acc.requests + a.requests,
    }),
    { tokens: 0, cost: 0, requests: 0 }
  );

  return (
    <main style={{ maxWidth: 1040, margin: '0 auto', padding: '48px 24px' }}>
      <a href="/" style={{ color: '#7c5cff', fontSize: 13 }}>← back</a>
      <h1 style={{ fontSize: 32, marginTop: 8 }}>Usage</h1>
      <p style={{ opacity: 0.7 }}>Live token usage across your published agents. Refreshes every 3s.</p>

      <div style={{ display: 'flex', gap: 12, marginTop: 24, marginBottom: 24 }}>
        <Stat label="Agents" value={String(agents.length)} />
        <Stat label="Requests" value={totals.requests.toLocaleString()} />
        <Stat label="Tokens" value={totals.tokens.toLocaleString()} />
        <Stat label="Cost" value={formatCost(totals.cost)} />
      </div>

      {loading ? (
        <div>Loading…</div>
      ) : agents.length === 0 ? (
        <div style={{ opacity: 0.5, marginTop: 32 }}>No agents yet.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', opacity: 0.6, fontSize: 12 }}>
              <th style={th}>NAME</th>
              <th style={th}>SOURCE</th>
              <th style={th}>MODEL</th>
              <th style={th}>REQUESTS</th>
              <th style={th}>TOKENS</th>
              <th style={th}>COST</th>
              <th style={th}>LAST USED</th>
              <th style={th}>OPEN</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id} style={{ borderTop: '1px solid #2a2a32' }}>
                <td style={td}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {a.name}
                    <VerifyBadge status={a.verificationStatus} />
                  </span>
                </td>
                <td style={td}><SourcePill source={a.importSource} /></td>
                <td style={{ ...td, fontSize: 12, opacity: 0.7 }}>{a.model || '—'}</td>
                <td style={td}>{a.requests.toLocaleString()}</td>
                <td style={td}>{a.tokens.toLocaleString()}</td>
                <td style={td}>{formatCost(a.cost)}</td>
                <td style={{ ...td, fontSize: 12, opacity: 0.7 }} suppressHydrationWarning>
                  <span data-now={now}>{timeAgo(a.lastUsedAt)}</span>
                </td>
                <td style={td}>
                  <a href={a.installUrl} target="_blank" rel="noreferrer" style={{ color: '#7c5cff', fontSize: 12 }}>
                    chat →
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ flex: 1, padding: 16, background: '#15151b', border: '1px solid #2a2a32', borderRadius: 8 }}>
      <div style={{ fontSize: 11, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '8px 12px', fontWeight: 500 };
const td: React.CSSProperties = { padding: '12px', fontSize: 14 };
