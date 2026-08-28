/**
 * Shown while the server component loads the conversation from Neon.
 *
 * A functional requirement rather than polish: Neon's free plan suspends compute after five
 * minutes idle, and a measured cold start on this project was 1,821ms for a bare `SELECT 1`.
 * Without a skeleton the app looks frozen exactly when a reviewer first opens it.
 */
export default function LoadingChat() {
  return (
    <div className="flex h-dvh overflow-hidden">
      <nav
        aria-hidden="true"
        className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface lg:flex"
      >
        <div className="flex items-center gap-2 px-4 py-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-[0.7rem] font-bold text-accent-foreground">
            C
          </span>
          <span className="text-sm font-semibold text-foreground">Citeline</span>
        </div>
        <div className="space-y-1.5 px-3 pt-2">
          <div className="h-8 animate-pulse-soft rounded-lg bg-surface-muted" />
          <div className="h-6 w-3/4 animate-pulse-soft rounded bg-surface-muted" />
          <div className="h-6 w-2/3 animate-pulse-soft rounded bg-surface-muted" />
        </div>
      </nav>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-border py-2.5 pr-4 pl-14 lg:pl-4">
          <div className="h-3.5 w-48 animate-pulse-soft rounded bg-surface-muted" />
        </header>

        <div className="flex-1 overflow-hidden">
          <div className="mx-auto w-full max-w-[46rem] space-y-6 px-4 py-6">
            <div className="flex justify-end">
              <div className="h-9 w-56 animate-pulse-soft rounded-2xl bg-surface-muted" />
            </div>
            <div className="flex gap-3">
              <div className="h-6 w-6 shrink-0 animate-pulse-soft rounded-md bg-surface-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-full animate-pulse-soft rounded bg-surface-muted" />
                <div className="h-3.5 w-11/12 animate-pulse-soft rounded bg-surface-muted" />
                <div className="h-3.5 w-3/5 animate-pulse-soft rounded bg-surface-muted" />
                <div className="h-16 w-full animate-pulse-soft rounded-lg bg-surface-muted" />
              </div>
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-border px-4 pt-3 pb-4">
          <div className="mx-auto h-12 w-full max-w-[46rem] animate-pulse-soft rounded-xl bg-surface-muted" />
        </div>
      </main>
    </div>
  );
}
