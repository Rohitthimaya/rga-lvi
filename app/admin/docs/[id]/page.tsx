'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AppShell } from '../../../../components/AppShell';

export default function DocDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [file, setFile] = useState<any>(null);
  const [nodes, setNodes] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const [fRes, nRes] = await Promise.all([fetch(`/files/${id}`), fetch(`/files/${id}/nodes`)]);
        const fJson = await fRes.json();
        const nJson = await nRes.json();
        if (!fRes.ok) throw new Error(fJson?.details || fJson?.error || 'Failed to load file');
        if (!nRes.ok) throw new Error(nJson?.details || nJson?.error || 'Failed to load nodes');
        if (cancelled) return;
        setFile(fJson);
        setNodes(nJson);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <AppShell>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow)]">
        <div className="text-lg font-semibold">Doc detail</div>
        <div className="mt-1 text-sm text-[var(--muted)]">{file?.original_name ?? id}</div>

        {error ? (
          <div className="mt-6 rounded-xl border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
            <div className="text-xs text-[var(--muted)]">Status</div>
            <div className="mt-1 text-sm text-[var(--text)]">{file?.status ?? '—'}</div>
            <div className="mt-4 text-xs text-[var(--muted)]">Detected crops</div>
            <div className="mt-1 text-sm text-[var(--text)]">{(file?.product_models ?? []).join(', ') || '—'}</div>
            <div className="mt-4 text-xs text-[var(--muted)]">Node count</div>
            <div className="mt-1 text-sm text-[var(--text)]">{nodes?.nodeCount ?? '—'}</div>
          </div>

          <div className="lg:col-span-2 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="bg-[var(--surface-2)] px-4 py-3 text-xs text-[var(--muted)]">Chunks</div>
            <div className="max-h-[70vh] overflow-auto divide-y divide-[var(--border)]">
              {(nodes?.nodes ?? []).map((n: any) => (
                <div key={n.id} className="p-4 hover:bg-[var(--surface-2)]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-xs text-[var(--text)]">
                      {n.type}
                    </span>
                    <span className="text-xs text-[var(--muted)]">p{n.page}</span>
                    <span className="text-xs text-[var(--muted)]">{n.section || '—'}</span>
                    {n.crop ? (
                      <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-xs text-[var(--text)]">
                        {n.crop}
                      </span>
                    ) : null}
                    {n.region ? (
                      <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-xs text-[var(--text)]">
                        {n.region}
                      </span>
                    ) : null}
                    {n.has_spray_advice ? (
                      <span className="rounded-full border border-amber-900/60 bg-amber-950/30 px-2 py-1 text-xs text-amber-200">
                        spray advice
                      </span>
                    ) : null}
                    {n.has_regulatory_info ? (
                      <span className="rounded-full border border-emerald-900/60 bg-emerald-950/30 px-2 py-1 text-xs text-emerald-200">
                        regulatory
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 text-sm text-[var(--text)]">{n.content_preview}</div>
                  <div className="mt-2 text-xs text-[var(--muted-2)]">id: {n.id}</div>
                </div>
              ))}
              {Array.isArray(nodes?.nodes) && nodes.nodes.length === 0 ? (
                <div className="p-6 text-sm text-[var(--muted)]">No chunks.</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

