'use client';

export interface Agent {
  id: string;
  name: string;
  emoji?: string;
  avatarUrl?: string | null;
  accent?: [string, string];
}

export interface AgentMessageProps {
  agent: Agent;
  message: string;
  status?: string;
  variant?: 'portrait' | 'inline';
  actions?: { label: string; onClick: () => void; primary?: boolean }[];
  timestamp?: string;
}

export function AgentMessage({
  agent,
  message,
  status,
  variant = 'inline',
  actions,
  timestamp,
}: AgentMessageProps) {
  if (variant === 'portrait')
    return <PortraitCard agent={agent} message={message} status={status} actions={actions} />;
  return <InlineMessage agent={agent} message={message} timestamp={timestamp} />;
}

function PortraitCard({ agent, message, status, actions }: AgentMessageProps) {
  const grad = agent.accent || ['#5a2eff', '#ff5fa3'];
  return (
    <div
      style={{
        width: '100%',
        maxWidth: 380,
        background: '#fff',
        border: '1px solid #e5e0f0',
        borderRadius: 24,
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(90,46,255,0.08)',
        position: 'relative',
      }}
    >
      <div
        style={{
          aspectRatio: '4 / 5',
          background: agent.avatarUrl
            ? `url(${agent.avatarUrl}) center/cover`
            : `linear-gradient(135deg, ${grad[0]}, ${grad[1]})`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 18,
          right: 18,
          bottom: 18,
          background: '#fff',
          borderRadius: 16,
          padding: '14px 16px',
          boxShadow: '0 8px 32px rgba(90,46,255,0.08)',
        }}
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: agent.avatarUrl
                ? `url(${agent.avatarUrl}) center/cover`
                : `linear-gradient(135deg, ${grad[0]}, ${grad[1]})`,
              border: '2px solid #fff',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
            }}
          />
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{agent.name}</div>
            {status && (
              <div style={{ fontSize: 11, color: '#1aa97a', marginTop: 2 }}>● {status}</div>
            )}
          </div>
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.4 }}>{message}</div>
        {actions && actions.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {actions.map((a, i) => (
              <button
                key={i}
                onClick={a.onClick}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: 'none',
                  background: a.primary !== false ? '#5a2eff' : 'transparent',
                  color: a.primary !== false ? '#fff' : '#5a2eff',
                  ...(a.primary === false && { border: '1.5px solid #5a2eff' }),
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InlineMessage({ agent, message, timestamp }: AgentMessageProps) {
  const grad = agent.accent || ['#5a2eff', '#ff5fa3'];
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', maxWidth: 640 }}>
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          flexShrink: 0,
          background: agent.avatarUrl
            ? `url(${agent.avatarUrl}) center/cover`
            : `linear-gradient(135deg, ${grad[0]}, ${grad[1]})`,
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}
      />
      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e0f0',
          borderRadius: 16,
          borderTopLeftRadius: 4,
          padding: '14px 18px',
          flex: 1,
        }}
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', marginBottom: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{agent.name}</span>
          {timestamp && (
            <span style={{ fontSize: 11, color: '#5b5670', fontFamily: 'monospace' }}>
              {timestamp}
            </span>
          )}
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{message}</div>
      </div>
    </div>
  );
}
