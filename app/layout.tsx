export const metadata = {
  title: 'Anyport — Publish any agent to Claude in 60 seconds',
  description: 'One agent definition. Distributed everywhere. Billed automatically.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#0b0b0f', color: '#f5f5f7' }}>
        {children}
      </body>
    </html>
  );
}
