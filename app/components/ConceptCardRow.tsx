'use client';

export interface Concept {
  id: string;
  title: string;
  hook: string;
  visualUrl?: string;
  visualGradient?: [string, string];
}

export function ConceptCardRow({
  concepts,
  onPick,
}: {
  concepts: Concept[];
  onPick: (id: string) => void;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${concepts.length}, 1fr)`,
        gap: 16,
        maxWidth: 1100,
      }}
    >
      {concepts.map((c, i) => (
        <div
          key={c.id}
          style={{
            background: '#fff',
            border: '1px solid #e5e0f0',
            borderRadius: 20,
            overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(90,46,255,0.08)',
          }}
        >
          <div
            style={{
              aspectRatio: '1 / 1',
              background: c.visualUrl
                ? `url(${c.visualUrl}) center/cover`
                : `linear-gradient(135deg, ${c.visualGradient?.[0] || '#ede8ff'}, ${
                    c.visualGradient?.[1] || '#ffd9e8'
                  })`,
            }}
          />
          <div style={{ padding: '16px 18px' }}>
            <div
              style={{
                fontSize: 11,
                color: '#5a2eff',
                fontFamily: 'monospace',
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              CONCEPT {String(i + 1).padStart(2, '0')}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{c.title}</div>
            <div style={{ fontSize: 13, color: '#5b5670', lineHeight: 1.4 }}>{c.hook}</div>
            <button
              onClick={() => onPick(c.id)}
              style={{
                marginTop: 12,
                width: '100%',
                padding: '8px 12px',
                borderRadius: 999,
                background: '#5a2eff',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Pick this →
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
