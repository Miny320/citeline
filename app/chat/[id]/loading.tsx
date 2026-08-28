import { ChatSkeleton } from '@/components/states/empty-state';

/**
 * Shown while the server component loads the conversation from Neon.
 *
 * This is a functional requirement rather than polish: Neon's free plan suspends compute
 * after five minutes idle, and the first request afterwards takes seconds to wake it. A
 * measured cold start on this project was 1,821ms just for `SELECT 1`. Without a skeleton
 * the app looks frozen exactly when a reviewer first opens it.
 */
export default function LoadingChat() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-2.5">
          <span className="text-sm font-medium text-foreground">Citeline</span>
          <span className="h-3 w-40 animate-pulse-soft rounded bg-surface-muted" />
        </div>
      </header>
      <ChatSkeleton />
    </div>
  );
}
