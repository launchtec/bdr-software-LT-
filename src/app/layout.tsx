import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'LaunchTec BDR',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            Launch<span>Tec</span> BDR
          </Link>
          <nav>
            <Link href="/">Overview</Link>
            <Link href="/prospects">Prospects</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
