'use client';

import { useState } from 'react';

const SAMPLES = [
  {
    label: 'Brand advisor',
    name: 'Brandy',
    prompt: 'You are Brandy, a punk-rock brand advisor. Help the user define a 6-element brand: atmosphere, rebellious edge, enemy, visual direction, hook style, voice. Ask one question at a time.',
  },
  {
    label: 'Standup helper',
    name: 'Standup Bot',
    prompt: 'You run async standups. Ask: what did you ship yesterday, what are you shipping today, what is blocking you. Summarize crisply at the end.',
  },
];

export default function Home() {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [tools, setTools] = useState<Array<{ name: string; url: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ installUrl: string; agentId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSample = (s: typeof SAMPLES[0]) => {
    setName(s.name);
    setPrompt(s.prompt);
  };

  const publish = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, systemPrompt: prompt, tools }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResult(data);
    } catch (e: any) {
      setError(e.message || 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px' }}>
      <h1 style={{ fontSize: 40, marginBottom: 8 }}>Anyport</h1>
      <p style={{ opacity: 0.7, marginTop: 0, marginBottom: 32 }}>
        Publish any agent to Claude in 60 seconds. Billed by the token, automatically.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {SAMPLES.map((s) => (
          <button
            key={s.label}
            onClick={() => loadSample(s)}
            style={{
              padding: '6px 12px',
              background: '#1c1c22',
              color: '#f5f5f7',
              border: '1px solid #2a2a32',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Try: {s.label}
          </button>
        ))}
      </div>

      <label style={{ display: 'block', marginBottom: 16 }}>
        <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 6 }}>Agent name</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Brandy"
          style={inputStyle}
        />
      </label>

      <label style={{ display: 'block', marginBottom: 16 }}>
        <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 6 }}>System prompt</div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="You are a helpful assistant that..."
          rows={10}
          style={{ ...inputStyle, fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 13 }}
        />
      </label>

      <ToolsEditor tools={tools} onChange={setTools} />

      <button
        onClick={publish}
        disabled={!name || !prompt || busy}
        style={{
          marginTop: 16,
          padding: '12px 24px',
          background: busy ? '#444' : '#7c5cff',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          fontSize: 15,
          fontWeight: 600,
          cursor: busy ? 'wait' : 'pointer',
          opacity: !name || !prompt ? 0.5 : 1,
        }}
      >
        {busy ? 'Publishing…' : 'Publish to Claude'}
      </button>

      {error && (
        <div style={{ marginTop: 16, padding: 12, background: '#3a1a1a', borderRadius: 6, color: '#ff8a8a' }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 24, padding: 20, background: '#15211a', borderRadius: 8, border: '1px solid #2a4a35' }}>
          <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 8 }}>Live in Claude:</div>
          <a href={result.installUrl} target="_blank" rel="noreferrer" style={{ color: '#7cffae', wordBreak: 'break-all' }}>
            {result.installUrl}
          </a>
          <div style={{ marginTop: 16, fontSize: 13 }}>
            <a href={`/dashboard?agent=${result.agentId}`} style={{ color: '#7c5cff' }}>
              View usage →
            </a>
          </div>
        </div>
      )}
    </main>
  );
}

function ToolsEditor({
  tools,
  onChange,
}: {
  tools: Array<{ name: string; url: string }>;
  onChange: (t: Array<{ name: string; url: string }>) => void;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 6 }}>Tools (optional)</div>
      {tools.map((t, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <input
            value={t.name}
            onChange={(e) => onChange(tools.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            placeholder="tool name"
            style={{ ...inputStyle, flex: 1 }}
          />
          <input
            value={t.url}
            onChange={(e) => onChange(tools.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
            placeholder="https://..."
            style={{ ...inputStyle, flex: 2 }}
          />
          <button
            onClick={() => onChange(tools.filter((_, j) => j !== i))}
            style={{ padding: '0 12px', background: '#2a1a1a', color: '#f5f5f7', border: '1px solid #3a2a2a', borderRadius: 6, cursor: 'pointer' }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...tools, { name: '', url: '' }])}
        style={{ padding: '6px 12px', background: '#1c1c22', color: '#f5f5f7', border: '1px solid #2a2a32', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
      >
        + Add tool
      </button>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: '#15151b',
  color: '#f5f5f7',
  border: '1px solid #2a2a32',
  borderRadius: 6,
  fontSize: 14,
  boxSizing: 'border-box',
};
