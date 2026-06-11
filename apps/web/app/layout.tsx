import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ATES — TXID Game (Play-Money Prototype)',
  description: 'Provably-fair TXID betting game. Play-money prototype.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
