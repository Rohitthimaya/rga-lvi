'use client';

import { useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Citation = { source: string; page: number; section: string | null };

type StreamState =
  | { phase: 'idle' }
  | { phase: 'retrieving'; citations: Citation[] }
  | { phase: 'streaming'; citations: Citation[]; text: string }
  | { phase: 'done'; citations: Citation[]; text: string; queryId: string; traceId: string | null; verified: boolean };

type ChatMessage =
  | { role: 'user'; text: string; imagePreviewUrl?: string }
  | { role: 'assistant'; text: string; phase: 'retrieving' | 'streaming' | 'done' };

export default function ChatPage() {
  const [query, setQuery] = useState('');
  const [stream, setStream] = useState<StreamState>({ phase: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [selected, setSelected] = useState<{ source: string; page: number; fileId: string } | null>(null);
  const [fileIdBySource, setFileIdBySource] = useState<Record<string, string>>({});
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      text:
        "Ask a BC crop, pest, disease, soil, irrigation, spray, or program question. I'll answer with citations, and you can open the cited PDF on the right.",
      phase: 'done',
    },
  ]);

  // NOTE: Do not use runtime `import()` here — it crashes in this dev runtime.

  const citations = useMemo(() => {
    if (stream.phase === 'idle') return [];
    if (stream.phase === 'retrieving') return stream.citations;
    if (stream.phase === 'streaming') return stream.citations;
    return stream.citations;
  }, [stream]);

  async function ensureFileId(source: string) {
    if (fileIdBySource[source]) return fileIdBySource[source];
    const res = await fetch('/files');
    const json = await res.json();
    const match = (json?.files ?? []).find((f: any) => f.original_name === source);
    if (match?.id) {
      setFileIdBySource((prev) => ({ ...prev, [source]: match.id }));
      return match.id as string;
    }
    return null;
  }

  async function openCitation(source: string, page: number) {
    const id = await ensureFileId(source);
    if (!id) return;
    setSelected({ source, page, fileId: id });
  }

  async function run() {
    const q = query.trim();
    if (!q && !imageFile) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setStream({ phase: 'retrieving', citations: [] });
    const userImagePreview = imagePreviewUrl ?? undefined;
    setMessages((prev) => [
      ...prev,
      { role: 'user', text: q || 'Please review this field photo.', imagePreviewUrl: userImagePreview },
      { role: 'assistant', text: '', phase: 'retrieving' },
    ]);

    let imageUrl: string | undefined;
    if (imageFile) {
      const form = new FormData();
      form.append('file', imageFile);
      const uploadRes = await fetch('/api/images', {
        method: 'POST',
        body: form,
        signal: ac.signal,
      });
      if (!uploadRes.ok) {
        const t = await uploadRes.text();
        throw new Error(t || 'Failed to upload image');
      }
      const uploadJson = await uploadRes.json();
      imageUrl = uploadJson.imageUrl;
    }

    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: q || 'Please review this field photo.', image_url: imageUrl }),
      signal: ac.signal,
    });

    if (!res.ok || !res.body) {
      const t = await res.text();
      throw new Error(t || 'Failed to start stream');
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buffer = '';

    let currentText = '';
    let currentCitations: Citation[] = [];

    const emitText = () => setStream({ phase: 'streaming', citations: currentCitations, text: currentText });

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });

      // Parse SSE frames separated by blank line
      while (true) {
        const idx = buffer.indexOf('\n\n');
        if (idx === -1) break;
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        const lines = frame.split('\n');
        const eventLine = lines.find((l) => l.startsWith('event: '));
        const dataLine = lines.find((l) => l.startsWith('data: '));
        const event = eventLine ? eventLine.slice('event: '.length).trim() : 'message';
        const data = dataLine ? dataLine.slice('data: '.length) : '';
        const json = data ? JSON.parse(data) : null;

        if (event === 'retrieval_complete') {
          currentCitations = json?.citations ?? [];
          setStream({ phase: 'retrieving', citations: currentCitations });
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === 'assistant') next[next.length - 1] = { ...last, phase: 'retrieving' };
            return next;
          });
        }

        if (event === 'token') {
          currentText += json?.text ?? '';
          emitText();
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === 'assistant') next[next.length - 1] = { ...last, text: currentText, phase: 'streaming' };
            return next;
          });
        }

        if (event === 'done') {
          setStream({
            phase: 'done',
            citations: currentCitations,
            text: json?.answer ?? currentText,
            queryId: json?.queryId,
            traceId: json?.traceId ?? null,
            verified: Boolean(json?.verified),
          });
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === 'assistant')
              next[next.length - 1] = {
                ...last,
                text: json?.answer ?? currentText,
                phase: 'done',
              };
            return next;
          });
          setQuery('');
          setImageFile(null);
          setImagePreviewUrl(null);
          if (imageInputRef.current) imageInputRef.current.value = '';
        }
      }
    }
  }

  function onSelectImage(file: File | null) {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setImageFile(file);
    setImagePreviewUrl(file ? URL.createObjectURL(file) : null);
  }

  return (
    <AppShell>
      <div className="grid gap-6 2xl:h-full 2xl:grid-cols-[minmax(720px,1fr)_520px]">
        <div className="min-w-0">
          <div className="flex h-[calc(100dvh-40px)] flex-col">
            <header className="px-2 pb-3 pt-2">
              <div className="mx-auto max-w-[720px]">
                <div className="text-sm font-semibold">Chat</div>
                <div className="mt-1 text-[13px] leading-6 text-[var(--muted)]">
                  BC agriculture answers with citations. Click a citation to open the PDF on the right.
                </div>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-auto px-2 pb-8">
              <div className="mx-auto max-w-[720px] space-y-7">
                {messages.map((m, idx) => (
                  <Message key={idx} msg={m} onOpenCitation={openCitation} />
                ))}
              </div>
            </div>

            <div className="shrink-0 px-2 pb-5 pt-3">
              <div className="mx-auto max-w-[720px]">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow)]">
                  {imagePreviewUrl ? (
                    <div className="mb-3 flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-2">
                      <img
                        src={imagePreviewUrl}
                        alt="Selected field photo preview"
                        className="h-16 w-16 rounded-lg object-cover"
                      />
                      <div className="min-w-0 flex-1 text-sm text-[var(--text)]">
                        <div className="truncate font-medium">{imageFile?.name}</div>
                        <div className="text-xs text-[var(--muted)]">Attached field photo</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onSelectImage(null)}
                        className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--text)] hover:bg-[var(--surface)]"
                      >
                        Remove
                      </button>
                    </div>
                  ) : null}
                  <div className="flex items-end gap-3">
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => onSelectImage(e.target.files?.[0] ?? null)}
                  />
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    className="h-[52px] shrink-0 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 text-[14px] font-semibold text-[var(--text)] transition-colors duration-200 ease-out hover:bg-[var(--surface)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                  >
                    Photo
                  </button>
                  <textarea
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Ask a BC crop question, optionally with a field photo..."
                    rows={2}
                    className="min-h-[52px] w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-[15px] leading-6 text-[var(--text)] outline-none placeholder:text-[var(--muted-2)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus-ring)]"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void run();
                      }
                    }}
                  />
                  <button
                    onClick={() => void run()}
                    className="h-[52px] shrink-0 rounded-xl bg-[var(--action)] px-5 text-[15px] font-semibold text-white transition-colors duration-200 ease-out hover:bg-[var(--action-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--action-focus-ring)]"
                  >
                    Send
                  </button>
                  </div>
                </div>

                {stream.phase === 'done' ? (
                  <div className="mt-2 text-[12px] leading-5 text-[var(--muted-2)]">
                    queryId: {stream.queryId} • traceId: {stream.traceId ?? '—'} • verified: {stream.verified ? 'true' : 'false'}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)] 2xl:h-full">
            <div className="border-b border-[var(--border)] px-6 py-4">
              <div className="text-sm font-semibold">Document</div>
              <div className="mt-1 text-xs text-[var(--muted)]">
                {selected ? (
                  <>
                    {selected.source} • p{selected.page}
                  </>
                ) : (
                  'Select a citation to preview.'
                )}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col px-6 py-4 2xl:min-h-0">
              <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
                {selected ? (
                  <PdfPreview fileId={selected.fileId} page={selected.page} />
                ) : (
                  <div className="p-4 text-sm text-[var(--muted)]">No PDF selected.</div>
                )}
              </div>

              <div className="mt-4 h-[28vh] overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] 2xl:h-[28vh]">
                <div className="border-b border-[var(--border)] px-3 py-2 text-xs font-semibold">
                  Citations
                </div>
                <div className="p-2">
                  {citations.length === 0 ? (
                    <div className="p-2 text-sm text-[var(--muted)]">No citations yet.</div>
                  ) : (
                    <div className="space-y-1">
                      {citations.map((c, i) => (
                        <button
                          key={`${c.source}:${c.page}:${i}`}
                          className={`w-full rounded-xl border px-3 py-2 text-left text-xs ${
                            selected?.source === c.source && selected?.page === c.page
                              ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]'
                              : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)]'
                          }`}
                          onClick={async () => {
                            const id = await ensureFileId(c.source);
                            if (!id) return;
                            setSelected({ source: c.source, page: c.page, fileId: id });
                          }}
                        >
                          <div className="truncate font-medium">{c.source}</div>
                          <div className="mt-1 text-[11px] text-[var(--muted-2)]">
                            p{c.page} • {c.section ?? '—'}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function PdfPreview(props: { fileId: string; page: number }) {
  // Use the browser's native PDF renderer for maximum compatibility.
  // Most PDF viewers respect `#page=<n>` to jump to a page.
  const url = `/files/${props.fileId}/download#page=${Math.max(1, props.page)}`;
  return (
    <iframe
      key={`${props.fileId}:${props.page}`}
      title="PDF preview"
      src={url}
      className="h-full w-full bg-[var(--surface)]"
    />
  );
}

function Message(props: { msg: ChatMessage; onOpenCitation: (source: string, page: number) => void }) {
  const m = props.msg;
  const isUser = m.role === 'user';
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={
          isUser
            ? 'max-w-[82%] rounded-xl border border-[var(--accent)] bg-[var(--accent)] px-4 py-3 shadow-[var(--shadow)]'
            : 'max-w-none rounded-2xl border border-[var(--border)] bg-[var(--bot-message)] px-4 py-3 shadow-[var(--shadow)]'
        }
      >
        {m.role === 'assistant' ? (
          <div className="text-[17px] leading-[1.65] text-[var(--text)]">
            {m.phase === 'retrieving' ? (
              <div className="text-[15px] leading-6 text-[var(--muted)]">Retrieving context…</div>
            ) : null}
            {m.text ? (
              <article className="prose max-w-none prose-headings:scroll-mt-16 prose-headings:tracking-tight prose-h1:mt-9 prose-h1:text-[1.75rem] prose-h1:leading-[1.25] prose-h2:mt-8 prose-h2:text-[1.4rem] prose-h2:leading-[1.28] prose-h3:mt-7 prose-h3:text-[1.15rem] prose-h3:leading-[1.3] prose-p:mt-0 prose-p:mb-[1.15em] prose-ul:mt-0 prose-ul:mb-[1.05em] prose-ol:mt-0 prose-ol:mb-[1.05em] prose-li:my-0 prose-li:mb-[0.55em] prose-li:leading-[1.65] prose-hr:my-8 prose-hr:border-[var(--border)] prose-strong:font-semibold prose-a:text-[var(--accent)] prose-a:underline prose-a:decoration-[var(--link-decoration)] prose-a:underline-offset-4 hover:prose-a:decoration-[var(--link-decoration-hover)] prose-blockquote:mt-0 prose-blockquote:mb-[1.15em] prose-blockquote:border-l-[3px] prose-blockquote:border-[var(--border)] prose-blockquote:bg-[var(--surface-2)] prose-blockquote:px-4 prose-blockquote:py-3 prose-blockquote:text-[var(--text)] prose-code:rounded prose-code:bg-[var(--surface-2)] prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.92em] prose-pre:mt-0 prose-pre:mb-[1.15em] prose-pre:rounded-xl prose-pre:border prose-pre:border-[var(--border)] prose-pre:bg-[var(--surface-2)] prose-pre:px-4 prose-pre:py-3 prose-pre:text-[var(--text)] prose-table:mt-0 prose-table:mb-[1.15em] prose-table:text-[15px] prose-th:border-[var(--border)] prose-th:px-3 prose-th:py-2 prose-td:border-[var(--border)] prose-td:px-3 prose-td:py-2">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => {
                      if (href?.startsWith('cite:')) {
                        const parsed = parseCiteHref(href);
                        const source = parsed?.source ?? '';
                        const page = parsed?.page ?? 1;
                        if (!source) {
                          // If parsing fails, render inert text instead of a navigable link.
                          return <span className="mx-1 inline-flex">{children}</span>;
                        }
                        return (
                          <CitationChip
                            source={source}
                            page={Number.isFinite(page) && page > 0 ? page : 1}
                            onClick={() => void props.onOpenCitation(source, Number.isFinite(page) && page > 0 ? page : 1)}
                          />
                        );
                      }
                      return (
                        <a href={href} target="_blank" rel="noreferrer">
                          {children}
                        </a>
                      );
                    },
                  }}
                >
                  {decorateMarkdownWithCitationLinks(m.text)}
                </ReactMarkdown>
              </article>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3 text-[16px] leading-[1.65] text-[var(--accent-contrast)]">
            {m.imagePreviewUrl ? (
              <img
                src={m.imagePreviewUrl}
                alt="Uploaded field photo"
                className="max-h-56 rounded-xl border border-white/20 object-contain"
              />
            ) : null}
            <div className="whitespace-pre-wrap">{m.text}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function decorateMarkdownWithCitationLinks(md: string) {
  // Converts trailing bracket citations into clickable "links" that we render as chips.
  // Example:
  // - `[Foo.pdf, page 2]` -> `[Foo.pdf • p2](cite:/Foo.pdf?page=2)`
  // - `[Foo.pdf, page 2, section: Bar]` -> `[Foo.pdf • p2](cite:/Foo.pdf?page=2)`
  return md.replace(
    /\[([^\]\n]+?\.pdf),\s*(?:page|p)\s*(\d+)(?:,[^\]\n]*)?\]/gi,
    (_m, sourceRaw, pageRaw) => {
      const source = String(sourceRaw).trim();
      const page = Number(pageRaw) || 1;
      const label = `${source} • p${page}`;
      return `[${label}](cite:/${encodeURIComponent(source)}?page=${page})`;
    }
  );
}

function parseCiteHref(href: string): { source: string; page: number } | null {
  // We intentionally do not let these navigate; they are internal actions.
  // Expected shapes:
  // - `cite:/Foo.pdf?page=2`
  // - `cite:./Foo.pdf?page=2` (tolerate)
  // - `cite:Foo.pdf?page=2` (tolerate)
  try {
    const withoutScheme = href.replace(/^cite:/i, '');
    const qIdx = withoutScheme.indexOf('?');
    const pathPart = (qIdx === -1 ? withoutScheme : withoutScheme.slice(0, qIdx)).replace(/^\/+/, '');
    const queryPart = qIdx === -1 ? '' : withoutScheme.slice(qIdx + 1);
    const sp = new URLSearchParams(queryPart);
    const page = Number(sp.get('page') ?? '1') || 1;
    const source = decodeURIComponent(pathPart);
    if (!source) return null;
    return { source, page };
  } catch {
    return null;
  }
}

function CitationChip(props: { source: string; page: number; onClick: () => void }) {
  const label = `${props.source} • p${props.page}`;
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="mx-1 inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--cite-border)] bg-[var(--cite-bg)] px-2.5 py-1 align-baseline text-[12px] font-medium leading-4 text-[var(--text)] transition-colors duration-200 ease-out hover:bg-[var(--surface-2)]"
      title={label}
    >
      <span className="truncate">{label}</span>
    </button>
  );
}

