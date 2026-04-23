/* eslint-disable @next/next/no-sync-scripts */
'use client';

export function ThemeToggle() {
  return (
    <button
      className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-left text-xs text-[var(--muted)] hover:opacity-90"
      onClick={() => {
        const cur = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
        const next = cur === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem('theme', next);
        } catch (e) {}
      }}
    >
      Toggle theme
    </button>
  );
}

