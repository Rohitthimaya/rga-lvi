/* eslint-disable @next/next/no-sync-scripts */
'use client';

export function ThemeToggle() {
  return (
    <button
      className="w-full rounded-xl border border-[var(--nav-border)] bg-[var(--nav-hover)] px-3 py-2 text-left text-xs text-[var(--nav-muted)] transition-colors duration-200 ease-out hover:text-[var(--nav-text)]"
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

