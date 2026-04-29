'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '../../../components/AppShell';

export default function DocsPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/files');
        const json = await res.json();
        if (!res.ok) throw new Error(json?.details || json?.error || 'Failed to load files');
        if (!cancelled) setData(json);
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
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-lg font-semibold">Docs</div>
            <div className="mt-1 text-sm text-[var(--muted)]">Ingested PDFs and processing status.</div>
          </div>
          <Link
            href="/admin/upload"
            className="rounded-xl bg-[var(--action)] px-4 py-2 text-sm font-semibold text-white transition-colors duration-200 ease-out hover:bg-[var(--action-hover)]"
          >
            Upload
          </Link>
        </div>

        {error ? (
          <div className="mt-6 rounded-xl border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-6 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[var(--surface-2)] text-xs text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3">File</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Crops</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {(data?.files ?? []).map((f: any) => (
                <tr key={f.id} className="hover:bg-[var(--surface-2)]">
                  <td className="px-4 py-3">
                    <Link className="font-medium text-[var(--text)] hover:underline" href={`/admin/docs/${f.id}`}>
                      {f.original_name}
                    </Link>
                    <div className="text-xs text-[var(--muted-2)]">{f.id}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-xs text-[var(--text)]">
                      {f.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)]">{(f.product_models ?? []).join(', ') || '—'}</td>
                  <td className="px-4 py-3 text-[var(--muted)]">{String(f.created_at ?? '').slice(0, 19)}</td>
                </tr>
              ))}
              {Array.isArray(data?.files) && data.files.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-sm text-[var(--muted)]" colSpan={4}>
                    No files yet.
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

