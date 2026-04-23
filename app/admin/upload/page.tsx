'use client';

import { useMemo, useState } from 'react';
import { AppShell } from '../../../components/AppShell';

export default function UploadPage() {
  const [dragOver, setDragOver] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const [fileStatus, setFileStatus] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const hint = useMemo(() => {
    if (uploading) return 'Uploading…';
    if (dragOver) return 'Drop PDF to upload';
    return 'Drag & drop a PDF, or click to select';
  }, [dragOver, uploading]);

  async function uploadFile(file: File) {
    setError(null);
    setLastResult(null);
    setFileStatus(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/upload', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.details || json?.error || 'Upload failed');
      setLastResult(json);

      const fileId = json?.fileId;
      if (typeof fileId === 'string' && fileId) {
        // Poll file status until ready/failed
        for (let i = 0; i < 60; i++) {
          const sRes = await fetch(`/files/${fileId}`);
          const sJson = await sRes.json();
          if (sRes.ok) setFileStatus(sJson);
          const status = sJson?.status;
          if (status === 'ready' || status === 'failed') break;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <AppShell>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow)]">
        <div className="text-lg font-semibold">Upload</div>
        <div className="mt-1 text-sm text-[var(--muted)]">Upload a PDF manual to ingest via BullMQ worker.</div>

        <label
          className={[
            'mt-6 block cursor-pointer rounded-2xl border border-dashed p-10 text-center transition',
            dragOver ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)] bg-[var(--surface-2)]',
          ].join(' ')}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void uploadFile(f);
          }}
        >
          <input
            className="hidden"
            type="file"
            accept="application/pdf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadFile(f);
            }}
          />
          <div className="text-sm text-[var(--text)]">{hint}</div>
          <div className="mt-2 text-xs text-[var(--muted-2)]">Max 50MB • Stored in S3 • Parsed by LlamaParse</div>
        </label>

        {error ? (
          <div className="mt-6 rounded-xl border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {lastResult ? (
          <pre className="mt-6 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 text-xs text-[var(--text)]">
            {JSON.stringify(lastResult, null, 2)}
          </pre>
        ) : null}

        {fileStatus ? (
          <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
            <div className="text-xs text-[var(--muted)]">Processing status</div>
            <div className="mt-1 text-sm text-[var(--text)]">
              {fileStatus.status}{' '}
              <span className="text-xs text-[var(--muted-2)]">({String(fileStatus.updated_at ?? '').slice(0, 19)})</span>
            </div>
            {fileStatus.error_message ? (
              <div className="mt-2 text-sm text-red-200">{fileStatus.error_message}</div>
            ) : null}
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}

