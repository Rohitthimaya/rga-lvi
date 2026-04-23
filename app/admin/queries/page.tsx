'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '../../../components/AppShell';

export default function QueriesPage() {
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/queries?limit=50');
        const json = await res.json();
        if (!res.ok) throw new Error(json?.details || json?.error || 'Failed to load queries');
        if (!cancelled) setItems(json.queries ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow)]">
        <div className="text-lg font-semibold">Queries</div>
        <div className="mt-1 text-sm text-[var(--muted)]">Recent /ask calls + feedback.</div>

        {error ? (
          <div className="mt-6 rounded-xl border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-6 overflow-auto rounded-xl border border-[var(--border)] bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[var(--surface-2)] text-xs text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3">Query</th>
                <th className="px-4 py-3">Feedback</th>
                <th className="px-4 py-3">Trace</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {items.map((q) => (
                <tr key={q.id} className="hover:bg-[var(--surface-2)]">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[var(--text)]">{q.query}</div>
                    <div className="text-xs text-[var(--muted-2)]">{q.id}</div>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)]">{q.feedback ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)]">{q.trace_id ?? '—'}</td>
                  <td className="px-4 py-3 text-[var(--muted)]">{String(q.created_at ?? '').slice(0, 19)}</td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-sm text-[var(--muted)]" colSpan={4}>
                    No queries logged yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

