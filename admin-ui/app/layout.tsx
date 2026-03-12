import type { ReactNode } from 'react';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, Arial, sans-serif' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
          {children}
        </div>
      </body>
    </html>
  );
}
