'use client';

// /import/mcp — T2 MCP Import (minimal form).
// Paste an MCP URL, optional auth header, get back an install URL.

import { useState } from 'react';

export default function ImportMcpPage() {
  const [url, setUrl] = useState('');
  const [authHeaderName, setAuthHeaderName] = useState('Authorization');
  const [authHeaderValue, setAuthHeaderValue] = useState('');
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');

  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const authHeader = authHeaderValue ? { name: authHeaderName, value: authHeaderValue } : undefined;

  const runProbe = async () => {
    setProbing(true);
    setError(null);
    setProbe(null);
    try {
      const r = await fetch('/api/import/probe-mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, authHeader }),
      });
      setProbe(await r.json());
    } catch (e: any) {
      setError(e?.message || 'probe failed');
    } finally {
      setProbing(false);
    }
  };

  const runImport = async () => {
    setImporting(true);
    setError(null);
    try {
      const r = await fetch('/api/import/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          authHeader,
          name: name || undefined,
          systemPrompt: systemPrompt || undefined,
        }),
      });
      if (!r.ok) {
        const t = await r.json().catch(() => ({}));
        throw new Error(t.error || `import failed (${r.status})`);
      }
      setResult(await r.json());
    } catch (e: any) {
      setError(e?.message || 'import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px' }}>
      <a href="/" style={{ color: '#7c5cff', fontSize: 13 }}>← back</a>
      <h1 style={{ fontSize: 36, marginTop: 8, letterSpacing: '-0.02em' }}>Import an MCP server</h1>
      <p style={{ opacity: 0.65, marginTop: 8, marginBottom: 32 }}>
        Paste any MCP-compatible server URL (Composio, Pipedream, your own). We introspect tools, capture schemas, and ship a hosted chat that calls them.
      </p>

      <Field label="MCP server URL" required hint="e.g. https://mcp.composio.dev/v3/mcp/<server>/mcp?user_id=<uid>">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." style={input} />
      </Field>
      <Field label="Auth header name (optional)" hint="Default: Authorization. Composio URLs already include user_id; leave blank.">
        <input value={authHeaderName} onChange={(e) => setAuthHeaderName(e.target.value)} style={input} />
      </Field>
      <Field label="Auth header value (optional)">
        <input value={authHeaderValue} onChange={(e) => setAuthHeaderValue(e.target.value)} type="password" style={input} />
      </Field>
      <Field label="Agent name (optional)">
        <input value={name} onChange={(e) => setName(e.target.value)} style={input} />
      </Field>
      <Field label="System prompt (optional)">
        <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={3} style={{ ...input, fontFamily: 'ui-monospace, monospace', fontSize: 13 }} />
      </Field>

      <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
        <button onClick={runProbe} disabled={!url || probing} style={btnSecondary(!url || probing)}>
          {probing ? 'Probing…' : '1. Introspect'}
        </button>
        <button onClick={runImport} disabled={!url || !probe?.ok || importing} style={btnPrimary(!url || !probe?.ok || importing)}>
          {importing ? 'Importing…' : '2. Import + publish'}
        </button>
      </div>

      {probe && (
        <div style={{
          marginTop: 20, padding: 16, borderRadius: 10,
          background: probe.ok ? '#e8f7ee' : '#fde8e8',
          border: `1px solid ${probe.ok ? '#a8d8b8' : '#f4b8b8'}`,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{probe.ok ? '✓ Connected' : '✗ Failed'}</div>
          <div style={{ fontSize: 14 }}>{probe.message}</div>
          {probe.composio && (
            <div style={{ fontSize: 12, marginTop: 6, color: '#5a2eff' }}>
              Composio MCP detected · server <code>{probe.composio.composioServerId}</code>{' '}
              · user <code>{probe.composio.composioUserId}</code>
            </div>
          )}
          {probe.tools && (
            <details style={{ marginTop: 10, fontSize: 13 }}>
              <summary>{probe.tools.length} tool(s)</summary>
              <ul style={{ margin: '8px 0 0 16px' }}>
                {probe.tools.map((t: any) => (
                  <li key={t.name}><code>{t.name}</code> — {t.description?.slice(0, 80) || '—'}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {error && <div style={{ marginTop: 20, padding: 14, borderRadius: 10, background: '#fde8e8', color: '#7a1a1a' }}>{error}</div>}

      {result && (
        <div style={{ marginTop: 24, padding: 20, background: '#ede8ff', borderRadius: 12, border: '1px solid #c0a8ff' }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', color: '#5a2eff', marginBottom: 8 }}>
            Imported · {result.importSource}
          </div>
          <a href={result.installUrl} target="_blank" rel="noreferrer" style={{ color: '#5a2eff', wordBreak: 'break-all', fontSize: 16, fontWeight: 600 }}>
            {result.installUrl}
          </a>
          <div style={{ marginTop: 12, fontSize: 13 }}>
            Exposed tools: {result.exposedTools?.map((t: string) => <code key={t} style={{ marginRight: 6, background: '#fff', padding: '1px 6px', borderRadius: 4 }}>{t}</code>)}
          </div>
        </div>
      )}
    </main>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 16 }}>
      <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 6, fontWeight: 500 }}>
        {label} {required && <span style={{ color: '#c0392b' }}>*</span>}
      </div>
      {children}
      {hint && <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>{hint}</div>}
    </label>
  );
}

const input: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e0f0',
  fontSize: 14, fontFamily: 'inherit', background: '#fff', boxSizing: 'border-box',
};
const btnPrimary = (disabled: boolean): React.CSSProperties => ({
  padding: '12px 24px', borderRadius: 999, background: disabled ? '#cbc4dc' : '#5a2eff',
  color: '#fff', border: 'none', fontWeight: 600, fontSize: 14,
  cursor: disabled ? 'not-allowed' : 'pointer',
});
const btnSecondary = (disabled: boolean): React.CSSProperties => ({
  padding: '12px 24px', borderRadius: 999, background: '#fff',
  color: disabled ? '#cbc4dc' : '#5a2eff',
  border: `1.5px solid ${disabled ? '#e5e0f0' : '#5a2eff'}`,
  fontWeight: 600, fontSize: 14, cursor: disabled ? 'not-allowed' : 'pointer',
});
