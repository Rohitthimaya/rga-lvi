import Link from 'next/link';
import { AppShell } from '../components/AppShell';

export default function HomePage() {
  return (
    <AppShell>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-[var(--shadow)]">
        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1 text-xs text-[var(--muted)]">
          Production RAG console
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">LVI RAG</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
          Upload manuals, inspect chunk quality, and test retrieval + streaming answers. Built for field tech workflows.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <QuickLink href="/admin/upload" label="Upload PDFs" />
          <QuickLink href="/admin/docs" label="Browse docs" />
          <QuickLink href="/admin/queries" label="Recent queries" />
          <QuickLink href="/chat" label="Open chat" />
        </div>
      </div>
    </AppShell>
  );
}

function QuickLink(props: { href: string; label: string }) {
  return (
    <Link
      href={props.href}
      className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-sm text-[var(--text)] hover:bg-white"
    >
      {props.label}
    </Link>
  );
}

