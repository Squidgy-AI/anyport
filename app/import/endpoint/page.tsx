'use client';

// /import/endpoint — T1 BYO Endpoint Adapter form.
// Two-step: Probe → Import. Probe doesn't persist; Import persists + returns install URL + verify token.

import { useState } from 'react';

type AuthKind = 'none' | 'bearer' | 'header';

interface ProbeResult {
  ok: boolean;
  message: string;
  sample?: unknown;
  resolvedTextPath?: string;
}

export default function ImportEndpointPage() {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [authKind, setAuthKind] = useState<AuthKind>('none');
  const [headerName, setHeaderName] = useState('X-API-Key');
  const [authSecret, setAuthSecret] = useState('');
  const [messageField, setMessageField] = useState('message');
  const [textPath, setTextPath] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');

  const [probing, setProbing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [result, setResult] = useState<{ agentId: string; installUrl: string; verification: any } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const auth =
    authKind === 'none'
      ? { kind: 'none' as const }
      : authKind === 'bearer'
        ? { kind: 'bearer' as const }
        : { kind: 'header' as const, name: headerName };

  const buildBody = () => ({
    name: name || undefined,
    systemPrompt: systemPrompt || undefined,
    url,
    method: 'POST' as const,
    auth,
    authSecret: authKind === 'none' ? undefined : authSecret,
    request: { messageField },
    response: textPath ? { textPath } : undefined,
    ownerEmail: ownerEmail || undefined,
  });

  const runProbe = async () => {
    setProbing(true);
    setError(null);
    setProbe(null);
    try {
      const r = await fetch('/api/import/probe-endpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
      });
      const data = await r.json();
      setProbe(data);
    } catch (e: any) {
      setError(e?.message || 'probe failed');
    } finally {
      setProbing(false);
    }
  };

  const runImport = async () => {
    setImporting(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch('/api/import/endpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
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
      <h1 style={{ fontSize: 36, marginTop: 8, letterSpacing: '-0.02em' }}>Import an endpoint</h1>
      <p style={{ opacity: 0.65, marginTop: 8, marginBottom: 32 }}>
        Wrap your existing chat HTTP endpoint as a hosted, metered Anyport agent. We forward the user's message; your endpoint stays the brain.
      </p>

      <Field label="Agent name (optional)">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Agent" style={input} />
      </Field>

      <Field label="Endpoint URL" required>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/chat" style={input} />
      </Field>

      <Field label="Auth">
        <select value={authKind} onChange={(e) => setAuthKind(e.target.value as AuthKind)} style={input}>
          <option value="none">None</option>
          <option value="bearer">Bearer token</option>
          <option value="header">Custom header</option>
        </select>
      </Field>

      {authKind === 'header' && (
        <Field label="Header name">
          <input value={headerName} onChange={(e) => setHeaderName(e.target.value)} style={input} />
        </Field>
      )}
      {authKind !== 'none' && (
        <Field label={authKind === 'bearer' ? 'Bearer token' : 'Header value'}>
          <input value={authSecret} onChange={(e) => setAuthSecret(e.target.value)} type="password" style={input} />
        </Field>
      )}

      <Field label="Message field name" hint="The JSON key your endpoint expects the user message under. Default: message">
        <input value={messageField} onChange={(e) => setMessageField(e.target.value)} style={input} />
      </Field>

      <Field label="Response text path (optional)" hint="Dot-path to the assistant text in the response (e.g. response, choices.0.message.content). Auto-detected if blank.">
        <input value={textPath} onChange={(e) => setTextPath(e.target.value)} style={input} />
      </Field>

      <Field label="System prompt (optional)" hint="Anyport's system prompt is just framing — your endpoint's own logic dominates.">
        <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={3} style={{ ...input, fontFamily: 'ui-monospace, monospace', fontSize: 13 }} />
      </Field>

      <Field label="Owner email (for revenue payouts later)">
        <input value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} type="email" style={input} />
      </Field>

      <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
        <button onClick={runProbe} disabled={!url || probing} style={btnSecondary(!url || probing)}>
          {probing ? 'Probing…' : '1. Probe endpoint'}
        </button>
        <button
          onClick={runImport}
          disabled={!url || !probe?.ok || importing}
          style={btnPrimary(!url || !probe?.ok || importing)}
        >
          {importing ? 'Importing…' : '2. Import + publish'}
        </button>
      </div>

      {probe && (
        <div
          style={{
            marginTop: 20, padding: 16, borderRadius: 10,
            background: probe.ok ? '#e8f7ee' : '#fde8e8',
            border: `1px solid ${probe.ok ? '#a8d8b8' : '#f4b8b8'}`,
            color: '#0d0a1a',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{probe.ok ? '✓ Probe passed' : '✗ Probe failed'}</div>
          <div style={{ fontSize: 14, opacity: 0.8 }}>{probe.message}</div>
          {probe.sample !== undefined && (
            <pre style={{ marginTop: 10, fontSize: 11, background: '#0d0a1a0a', padding: 8, borderRadius: 6, maxHeight: 160, overflow: 'auto' }}>
              {typeof probe.sample === 'string' ? probe.sample : JSON.stringify(probe.sample, null, 2)}
            </pre>
          )}
        </div>
      )}

      {error && (
        <div style={{ marginTop: 20, padding: 14, borderRadius: 10, background: '#fde8e8', color: '#7a1a1a' }}>{error}</div>
      )}

      {result && (
        <div style={{ marginTop: 24, padding: 20, background: '#ede8ff', borderRadius: 12, border: '1px solid #c0a8ff' }}>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', color: '#5a2eff' }}>
            Imported · pending verification
          </div>
          <a href={result.installUrl} target="_blank" rel="noreferrer" style={{ color: '#5a2eff', wordBreak: 'break-all', fontSize: 16, fontWeight: 600 }}>
            {result.installUrl}
          </a>
          <div style={{ marginTop: 16, padding: 14, background: '#fff', borderRadius: 8, fontSize: 13, lineHeight: 1.5 }}>
            <strong>Verify ownership</strong> (optional, required for App Store listing):<br />
            Serve this token at <code style={{ background: '#0d0a1a08', padding: '1px 6px', borderRadius: 4 }}>/.well-known/anyport-verify</code> on your endpoint's host:
            <pre style={{ marginTop: 8, padding: 8, background: '#0d0a1a08', borderRadius: 4, fontSize: 12 }}>{result.verification?.token}</pre>
            Then visit <code style={{ background: '#0d0a1a08', padding: '1px 6px', borderRadius: 4 }}>/api/verify/{result.agentId}</code>.
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
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid #e5e0f0',
  fontSize: 14,
  fontFamily: 'inherit',
  background: '#fff',
  boxSizing: 'border-box',
};

const btnPrimary = (disabled: boolean): React.CSSProperties => ({
  padding: '12px 24px',
  borderRadius: 999,
  background: disabled ? '#cbc4dc' : '#5a2eff',
  color: '#fff',
  border: 'none',
  fontWeight: 600,
  fontSize: 14,
  cursor: disabled ? 'not-allowed' : 'pointer',
});

const btnSecondary = (disabled: boolean): React.CSSProperties => ({
  padding: '12px 24px',
  borderRadius: 999,
  background: '#fff',
  color: disabled ? '#cbc4dc' : '#5a2eff',
  border: `1.5px solid ${disabled ? '#e5e0f0' : '#5a2eff'}`,
  fontWeight: 600,
  fontSize: 14,
  cursor: disabled ? 'not-allowed' : 'pointer',
});
