'use client';

import { use, useEffect, useState } from 'react';
import { AgentMessage, type Agent } from '@/app/components/AgentMessage';
import { ConceptCardRow, type Concept } from '@/app/components/ConceptCardRow';

interface ToolEvent {
  name: string;
  input: string;
  output: string;
}

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  toolEvents?: ToolEvent[];
  imageUrl?: string;
  concepts?: Concept[];
  ts?: string;
}

const CARD_RE = /\$\*\*(.+?)\*\*\$/g;
const VISUAL_PROMPT_RE = /visual_prompt\s*[:=]\s*"([^"]+)"/i;

function extractCards(text: string): string[] {
  const cards: string[] = [];
  let m: RegExpExecArray | null;
  CARD_RE.lastIndex = 0;
  while ((m = CARD_RE.exec(text)) !== null) cards.push(m[1].trim());
  return cards;
}

function stripCards(text: string): string {
  return text.replace(CARD_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}

function extractVisualPrompt(text: string): string | null {
  const m = text.match(VISUAL_PROMPT_RE);
  return m?.[1] || null;
}

function nowTs(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function AgentChat({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [agent, setAgent] = useState<(Agent & { statusLine?: string }) | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgBusy, setImgBusy] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/agents')
      .then((r) => r.json())
      .then((d) => {
        const a = (d.agents || []).find((x: any) => x.id === id);
        if (a) {
          setAgent({
            id: a.id,
            name: a.name,
            avatarUrl: a.avatarUrl || null,
            statusLine: 'Online — Squidgy backend connected',
          });
        }
      });
  }, [id]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || busy) return;
    const next: Msg[] = [...messages, { role: 'user', content: text, ts: nowTs() }];
    setMessages(next);
    setInput('');
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/chat/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setMessages([
        ...next,
        {
          role: 'assistant',
          content: data.content,
          toolEvents: data.toolEvents || [],
          ts: nowTs(),
        },
      ]);
    } catch (e: any) {
      setError(e.message || 'failed');
    } finally {
      setBusy(false);
    }
  };

  const generateImage = async (msgIndex: number, prompt: string) => {
    setImgBusy(msgIndex);
    try {
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setMessages((prev) =>
        prev.map((m, i) => (i === msgIndex ? { ...m, imageUrl: data.url } : m)),
      );
    } catch (e: any) {
      setError(e.message || 'image generation failed');
    } finally {
      setImgBusy(null);
    }
  };

  const fallbackAgent: Agent = agent || { id, name: 'Agent' };
  const statusLine = agent?.statusLine;

  return (
    <main
      style={{
        background: '#f5f3fb',
        minHeight: '100vh',
        color: '#0d0a1a',
        fontFamily:
          '"Hanken Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap"
      />
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '32px 24px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 24,
          }}
        >
          <a href="/" style={{ color: '#5a2eff', fontSize: 13, fontWeight: 600 }}>
            ← anyport
          </a>
          <a href={`/dashboard?agent=${id}`} style={{ color: '#5a2eff', fontSize: 13 }}>
            usage →
          </a>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
            marginBottom: 24,
            minHeight: 200,
          }}
        >
          {messages.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <AgentMessage
                agent={fallbackAgent}
                variant="portrait"
                status={statusLine}
                message={
                  agent
                    ? `Hi! I'm ${agent.name}. Click any quickstart to begin, or type a message.`
                    : 'Loading…'
                }
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {[
                  'List my connected social accounts',
                  'Draft an Instagram post about agent portability',
                  'Show me my scheduled posts',
                  'Help me set up my brand info',
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    disabled={busy}
                    style={{
                      padding: '8px 14px',
                      background: '#ede8ff',
                      border: '1px solid #d4ccef',
                      color: '#5a2eff',
                      borderRadius: 999,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: busy ? 'wait' : 'pointer',
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => {
            if (m.role === 'user') {
              return (
                <div key={i} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div
                    style={{
                      maxWidth: 520,
                      background: '#5a2eff',
                      color: '#fff',
                      padding: '10px 16px',
                      borderRadius: 16,
                      borderBottomRightRadius: 4,
                      fontSize: 15,
                      lineHeight: 1.45,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {m.content}
                  </div>
                </div>
              );
            }

            // Assistant message
            const cards = extractCards(m.content);
            const body = stripCards(m.content);
            const visualPrompt = extractVisualPrompt(m.content);
            const isFirstAssistant =
              i === messages.findIndex((x) => x.role === 'assistant');

            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {m.toolEvents && m.toolEvents.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {m.toolEvents.map((ev, j) => (
                      <div
                        key={j}
                        style={{
                          fontSize: 11,
                          color: '#5b5670',
                          background: '#ede8ff',
                          border: '1px solid #d4ccef',
                          borderRadius: 999,
                          padding: '4px 12px',
                          fontFamily: '"JetBrains Mono", monospace',
                          alignSelf: 'flex-start',
                        }}
                      >
                        🔧 {ev.name} ← &ldquo;
                        {ev.input.slice(0, 80)}
                        {ev.input.length > 80 ? '…' : ''}&rdquo;
                      </div>
                    ))}
                  </div>
                )}

                {m.concepts ? (
                  <ConceptCardRow concepts={m.concepts} onPick={(cid) => sendMessage(`Pick concept ${cid}`)} />
                ) : isFirstAssistant ? (
                  <AgentMessage
                    agent={fallbackAgent}
                    variant="portrait"
                    message={body}
                    status={statusLine}
                  />
                ) : (
                  <AgentMessage
                    agent={fallbackAgent}
                    variant="inline"
                    message={body}
                    timestamp={m.ts}
                  />
                )}

                {cards.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 8,
                      marginLeft: isFirstAssistant ? 0 : 68,
                    }}
                  >
                    {cards.map((c, j) => (
                      <button
                        key={j}
                        onClick={() => sendMessage(c)}
                        disabled={busy}
                        style={{
                          padding: '8px 14px',
                          background: '#ede8ff',
                          border: '1px solid #d4ccef',
                          color: '#5a2eff',
                          borderRadius: 999,
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: busy ? 'wait' : 'pointer',
                        }}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}

                {visualPrompt && !m.imageUrl && (
                  <button
                    onClick={() => generateImage(i, visualPrompt)}
                    disabled={imgBusy === i}
                    style={{
                      padding: '8px 14px',
                      background: '#fff',
                      border: '1.5px solid #5a2eff',
                      color: '#5a2eff',
                      borderRadius: 999,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: imgBusy === i ? 'wait' : 'pointer',
                      alignSelf: 'flex-start',
                      marginLeft: isFirstAssistant ? 0 : 68,
                    }}
                  >
                    {imgBusy === i ? 'Generating image…' : '🎨 Generate image'}
                  </button>
                )}

                {m.imageUrl && (
                  <img
                    src={m.imageUrl}
                    alt="generated"
                    style={{
                      maxWidth: '100%',
                      borderRadius: 16,
                      border: '1px solid #e5e0f0',
                      boxShadow: '0 8px 32px rgba(90,46,255,0.08)',
                      marginLeft: isFirstAssistant ? 0 : 68,
                    }}
                  />
                )}
              </div>
            );
          })}

          {busy && (
            <div
              style={{
                color: '#5b5670',
                fontSize: 13,
                fontStyle: 'italic',
                marginLeft: 68,
              }}
            >
              {agent?.name || 'Agent'} is thinking…
            </div>
          )}
          {error && (
            <div
              style={{
                padding: 12,
                background: '#fff0f0',
                border: '1px solid #f5c0c0',
                borderRadius: 12,
                color: '#a02020',
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            gap: 8,
            position: 'sticky',
            bottom: 16,
            background: '#f5f3fb',
            paddingTop: 8,
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage(input)}
            placeholder="Message…"
            style={{
              flex: 1,
              padding: '12px 16px',
              background: '#fff',
              color: '#0d0a1a',
              border: '1px solid #e5e0f0',
              borderRadius: 999,
              fontSize: 15,
              fontFamily: 'inherit',
              outline: 'none',
              boxShadow: '0 4px 16px rgba(90,46,255,0.04)',
            }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={busy || !input.trim()}
            style={{
              padding: '12px 24px',
              background: busy ? '#a89cd5' : '#5a2eff',
              color: '#fff',
              border: 'none',
              borderRadius: 999,
              cursor: busy ? 'wait' : 'pointer',
              opacity: !input.trim() ? 0.5 : 1,
              fontWeight: 600,
              fontSize: 15,
              fontFamily: 'inherit',
            }}
          >
            Send
          </button>
        </div>
      </div>
    </main>
  );
}
