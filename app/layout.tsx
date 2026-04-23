import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'LVI RAG Admin',
  description: 'Document ingestion and support assistant',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}

