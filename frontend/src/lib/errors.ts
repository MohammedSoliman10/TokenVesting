/**
 * Contract custom-error decoding — SKELETON (task T016).
 *
 * viem wraps reverts in nested errors (`BaseError.cause` / `BaseError.walk()`),
 * so decoding walks the chain looking for a custom-error name and falls back
 * to viem's `shortMessage`. The full error → message map for every contract
 * error is completed in task T051; `FaucetCooldown` is mapped up front because
 * the faucet flow (US1, T025/T027) needs it first.
 *
 * Rule: users never see raw revert data — only friendly sentences.
 */

/** Custom error name → user-facing sentence. Completed by task T051. */
export const CUSTOM_ERROR_MESSAGES: Record<string, string> = {
  FaucetCooldown:
    'This wallet already claimed test tokens in the last 24 hours. Try again later.',
  // TODO(T051): NothingToRelease, InvalidStart, InvalidDuration, InvalidCliff,
  // ZeroAddress, ZeroAmount, InsufficientBalance, InsufficientAllowance,
  // FeeOnTransferRejected, ScheduleNotFound.
};

interface ErrorLike {
  message?: unknown;
  shortMessage?: unknown;
  details?: unknown;
  errorName?: unknown;
  reason?: unknown;
  cause?: unknown;
  walk?: unknown;
}

/** `CustomError()`-style name embedded in a revert message. */
const CUSTOM_ERROR_PATTERN = /([A-Za-z_][A-Za-z0-9_]*)\(\)/;

/** Depth-capped walk over `cause` links and viem's `walk()`. */
function errorParts(error: unknown, depth = 0): unknown[] {
  if (error === null || typeof error !== 'object' || depth > 12) return [];

  const current = error as ErrorLike;
  const parts: unknown[] = [current];

  if (current.cause !== undefined && current.cause !== null) {
    parts.push(...errorParts(current.cause, depth + 1));
  }

  if (typeof current.walk === 'function') {
    try {
      const root = (current.walk as () => unknown)();
      if (root !== undefined && root !== null && root !== error) {
        parts.push(...errorParts(root, depth + 1));
      }
    } catch {
      // walk() is best-effort — a malformed chain must not break the UI.
    }
  }

  return parts;
}

/** All human-readable text attached to the error chain. */
function errorText(error: unknown): string {
  const texts: string[] = [];
  for (const part of errorParts(error)) {
    const candidate = part as ErrorLike;
    if (typeof candidate.shortMessage === 'string') texts.push(candidate.shortMessage);
    if (typeof candidate.message === 'string') texts.push(candidate.message);
    if (typeof candidate.details === 'string') texts.push(candidate.details);
  }
  return texts.join(' ');
}

/**
 * Best-effort custom-error name (e.g. `FaucetCooldown`) from a viem error,
 * or `undefined` when the revert was not a known custom error.
 */
export function extractCustomErrorName(error: unknown): string | undefined {
  for (const part of errorParts(error)) {
    const candidate = part as ErrorLike;

    if (typeof candidate.errorName === 'string' && candidate.errorName.length > 0) {
      return candidate.errorName;
    }
    if (typeof candidate.reason === 'string' && candidate.reason.length > 0) {
      return candidate.reason;
    }
    if (typeof candidate.message === 'string') {
      const match = CUSTOM_ERROR_PATTERN.exec(candidate.message);
      if (match) return match[1];
    }
  }
  return undefined;
}

function shortMessageOf(error: unknown): string | undefined {
  for (const part of errorParts(error)) {
    const candidate = part as ErrorLike;
    if (typeof candidate.shortMessage === 'string' && candidate.shortMessage.length > 0) {
      return candidate.shortMessage;
    }
  }
  return undefined;
}

/**
 * Turn any thrown value (viem error, plain Error, undefined) into one
 * friendly sentence. Task T051 completes the custom-error mapping.
 */
export function friendlyErrorMessage(error?: unknown): string {
  if (error === undefined || error === null) {
    return 'The transaction did not go through. Please try again.';
  }

  const errorName = extractCustomErrorName(error);
  if (errorName) {
    const mapped = CUSTOM_ERROR_MESSAGES[errorName];
    if (mapped) return mapped;
  }

  const text = errorText(error);
  if (/user (rejected|denied)|rejected the request|user closed|action rejected/i.test(text)) {
    return 'You rejected the request in your wallet — nothing was sent.';
  }
  if (/insufficient funds|exceeds balance/i.test(text)) {
    return 'Not enough ETH in your wallet to pay for gas.';
  }

  return shortMessageOf(error) ?? 'The transaction failed. Please try again.';
}
