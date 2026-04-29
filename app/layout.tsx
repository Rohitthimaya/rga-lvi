import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AICanGrow Bot',
  description: 'BC farmer advisory assistant grounded in Ministry documents',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}

