import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col items-center px-5 py-24 text-center">
      <h1 className="m-0 text-base font-medium text-foreground">Page not found</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        That conversation may have been deleted, or the link may be wrong.
      </p>
      <Link
        href="/"
        className="mt-5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground no-underline transition-opacity hover:opacity-90"
      >
        Back to conversations
      </Link>
    </main>
  );
}
