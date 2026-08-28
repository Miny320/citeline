import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AppError, toAppError } from '../lib/errors';

/**
 * The error taxonomy is no longer only cosmetic: `toAppError` deciding that something is a
 * rate limit is what makes the chat route fall back to another model rather than give up.
 * A misclassification here either wastes a fallback attempt or fails a recoverable request.
 */

describe('toAppError — rate limit detection drives model fallback', () => {
  const RATE_LIMIT_SHAPES = [
    // The exact message Google returned when the free-tier quota was exhausted.
    'Failed after 3 attempts. Last error: AI_APICallError: You exceeded your current quota, ' +
      'please check your plan and billing details. Quota exceeded for metric: ' +
      'generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, ' +
      'model: gemini-3.6-flash',
    'RESOURCE_EXHAUSTED',
    'Rate limit exceeded',
    'rate-limited, retry later',
    'Request failed with status 429',
  ];

  for (const message of RATE_LIMIT_SHAPES) {
    it(`classifies: ${message.slice(0, 46)}…`, () => {
      const error = toAppError(new Error(message));
      assert.equal(error.code, 'RATE_LIMITED');
      assert.equal(error.status, 429);
      assert.match(error.userMessage, /busy|wait/i);
    });
  }

  it('does NOT classify an unrelated failure as a rate limit', () => {
    // A bad key or malformed request fails identically on every model, so falling back
    // would only add latency before the same failure.
    for (const message of ['API key not valid', 'Invalid request payload', 'model not found']) {
      assert.notEqual(toAppError(new Error(message)).code, 'RATE_LIMITED', message);
    }
  });

  it('classifies database connectivity failures separately', () => {
    const error = toAppError(new Error('connect ECONNREFUSED 10.0.0.1:5432'));
    assert.equal(error.code, 'DB_UNAVAILABLE');
    assert.equal(error.status, 503);
  });

  it('passes an AppError through unchanged', () => {
    const original = new AppError('FILE_TOO_LARGE', '9000000 bytes');
    assert.equal(toAppError(original), original);
  });

  it('falls back to the given code for anything unrecognised', () => {
    assert.equal(toAppError(new Error('something odd'), 'PARSE_FAILED').code, 'PARSE_FAILED');
    assert.equal(toAppError('a bare string').code, 'INTERNAL');
  });
});

describe('AppError — never leak internals to the user', () => {
  it('keeps the internal detail out of the user-facing message', () => {
    const detail = 'postgresql://user:hunter2@ep-secret-host.neon.tech/neondb';
    const error = new AppError('DB_UNAVAILABLE', detail);

    assert.ok(error.message.includes(detail), 'internal detail belongs on .message for logs');
    assert.ok(
      !error.userMessage.includes('hunter2') && !error.userMessage.includes('neon.tech'),
      'userMessage must never carry connection details',
    );
  });

  it('gives every code a user-facing message and a sane status', () => {
    const codes = [
      'FILE_TOO_LARGE',
      'UNSUPPORTED_TYPE',
      'EMPTY_DOCUMENT',
      'NO_EXTRACTABLE_TEXT',
      'PARSE_FAILED',
      'EMBEDDING_FAILED',
      'RATE_LIMITED',
      'DB_UNAVAILABLE',
      'CHAT_NOT_FOUND',
      'DOCUMENT_NOT_FOUND',
      'BAD_REQUEST',
      'INTERNAL',
    ] as const;

    for (const code of codes) {
      const error = new AppError(code);
      assert.ok(error.userMessage.length > 10, `${code} has no usable message`);
      assert.ok(error.status >= 400 && error.status < 600, `${code} has status ${error.status}`);
    }
  });
});
