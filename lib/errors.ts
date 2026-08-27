/**
 * Error taxonomy.
 *
 * Every failure the user can trigger maps to a code, an HTTP status, and a sentence a
 * non-technical person can act on. Raw exception text never reaches the client — it leaks
 * implementation detail at best and connection strings at worst.
 *
 * See docs/06-implementation-spec.md §11.
 */

export const ERROR_CODES = {
  FILE_TOO_LARGE: {
    status: 413,
    message: 'That file is over the 4 MB limit. Try a smaller document.',
  },
  UNSUPPORTED_TYPE: {
    status: 415,
    message: 'Only PDF, TXT and Markdown files are supported.',
  },
  EMPTY_DOCUMENT: {
    status: 422,
    message: 'That file appears to be empty.',
  },
  NO_EXTRACTABLE_TEXT: {
    status: 422,
    message:
      "This PDF has no extractable text — it may be a scan or image-only. OCR isn't supported.",
  },
  PARSE_FAILED: {
    status: 422,
    message: "We couldn't read that file. It may be corrupted or password-protected.",
  },
  EMBEDDING_FAILED: {
    status: 502,
    message: "We couldn't process the document just now. Please try again.",
  },
  RATE_LIMITED: {
    status: 429,
    message: 'The AI service is busy right now. Wait a moment and try again.',
  },
  DB_UNAVAILABLE: {
    status: 503,
    message: "We can't reach the database. Please retry in a moment.",
  },
  CHAT_NOT_FOUND: {
    status: 404,
    message: 'That conversation no longer exists.',
  },
  DOCUMENT_NOT_FOUND: {
    status: 404,
    message: 'That document no longer exists.',
  },
  BAD_REQUEST: {
    status: 400,
    message: 'That request was malformed.',
  },
  INTERNAL: {
    status: 500,
    message: 'Something went wrong on our side.',
  },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Safe to show a user. */
  readonly userMessage: string;

  constructor(code: ErrorCode, detail?: string) {
    const { status, message } = ERROR_CODES[code];
    // `message` (the Error's own) carries the internal detail for logs;
    // `userMessage` is the sanitised one.
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.userMessage = message;
  }
}

/**
 * Map an unknown thrown value to an AppError.
 *
 * Provider rate limits arrive in several shapes depending on where they are raised, so they
 * are sniffed here rather than at each call site — a 429 rendered as a generic "something
 * went wrong" is a materially worse experience, since the user's correct action is just to
 * wait.
 */
export function toAppError(error: unknown, fallback: ErrorCode = 'INTERNAL'): AppError {
  if (error instanceof AppError) return error;

  const raw = error instanceof Error ? error.message : String(error);

  if (/rate.?limit|quota|RESOURCE_EXHAUSTED|\b429\b/i.test(raw)) {
    return new AppError('RATE_LIMITED', raw);
  }
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|connection|neon|postgres/i.test(raw)) {
    return new AppError('DB_UNAVAILABLE', raw);
  }

  return new AppError(fallback, raw);
}

/** Consistent JSON error body for route handlers. */
export function errorResponse(error: unknown, fallback: ErrorCode = 'INTERNAL'): Response {
  const appError = toAppError(error, fallback);

  // Full detail to the server log, sanitised message to the client.
  console.error(`[${appError.code}]`, appError.message);

  return Response.json(
    { error: { code: appError.code, message: appError.userMessage } },
    { status: appError.status },
  );
}
