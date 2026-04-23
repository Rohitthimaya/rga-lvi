import Link from 'next/link';
import Script from 'next/script';
import { ThemeToggle } from './ThemeToggle';

export function AppShell(props: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh overflow-y-auto bg-[var(--bg)] text-[var(--text)]">
      <Script
        id="theme-init"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            (function() {
              try {
                var stored = localStorage.getItem('theme');
                var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                var theme = stored || (prefersDark ? 'dark' : 'light');
                document.documentElement.dataset.theme = theme;
              } catch (e) {}
            })();
          `,
        }}
      />
      <div className="flex min-h-dvh w-full gap-8 px-6 py-5 lg:px-10">
        <aside className="hidden w-[260px] shrink-0 lg:block">
          <div className="rounded-2xl border border-[var(--border)] bg-transparent p-4">
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
              <div className="text-sm font-semibold tracking-wide">LVI RAG</div>
            </div>
            <div className="mt-1 text-xs text-[var(--muted)]">Field tech console</div>

            <div className="mt-4">
              <ThemeToggle />
            </div>

            <nav className="mt-5 space-y-1 text-sm">
              <NavItem href="/admin/upload" label="Upload" />
              <NavItem href="/admin/docs" label="Docs" />
              <NavItem href="/admin/queries" label="Queries" />
              <div className="my-3 h-px bg-[var(--border)]" />
              <NavItem href="/chat" label="Chat" />
            </nav>
          </div>
        </aside>

        <main className="min-w-0 flex-1">{props.children}</main>
      </div>
    </div>
  );
}

function NavItem(props: { href: string; label: string }) {
  return (
    <Link
      className="block rounded-xl border border-transparent px-3 py-2 text-[var(--muted)] transition-colors duration-200 ease-out hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
      href={props.href}
    >
      {props.label}
    </Link>
  );
}

