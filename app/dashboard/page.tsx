'use client';

import { useEffect, useState } from 'react';

interface Agent {
  id: string;
  name: string;
  installUrl: string;
  tokens: number;
  cost: number;
  createdAt: string;
}

export default function Dashboard() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const res = await fetch('/api/agents');
    const data = await res.json();
    setAgents(data.agents || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '48px 24px' }}>
      <a href="/" style={{ color: '#7c5cff', fontSize: 13 }}>← back</a>
      <h1 style={{ fontSize: 32, marginTop: 8 }}>Usage</h1>
      <p style={{ opacity: 0.7 }}>Live token usage across your published agents. Refreshes every 3s.</p>

      {loading ? (
        <div>Loading…</div>
      ) : agents.length === 0 ? (
        <div style={{ opacity: 0.5, marginTop: 32 }}>No agents yet.</div>
      ) : (
        <table style={{ width: '100%', marginTop: 24, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', opacity: 0.6, fontSize: 12 }}>
              <th style={th}>NAME</th>
              <th style={th}>TOKENS</th>
              <th style={th}>COST</th>
              <th style={th}>INSTALL</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id} style={{ borderTop: '1px solid #2a2a32' }}>
                <td style={td}>{a.name}</td>
                <td style={td}>{a.tokens.toLocaleString()}</td>
                <td style={td}>${a.cost.toFixed(4)}</td>
                <td style={td}>
                  <a href={a.installUrl} target="_blank" rel="noreferrer" style={{ color: '#7c5cff', fontSize: 12 }}>
                    open in Claude →
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

const th: React.CSSProperties = { padding: '8px 12px', fontWeight: 500 };
const td: React.CSSProperties = { padding: '12px', fontSize: 14 };
