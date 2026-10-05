/**
 * Contract custom-error decoding (task T016, completed by T051).
 *
 * viem wraps reverts in nested errors (`BaseError.cause` / `BaseError.walk()`),
 * so decoding walks the chain looking for a custom-error name and falls back
 * to viem's `shortMessage`.
 *
 * Rule: users never see raw revert data — only friendly sentences.
 * `CUSTOM_ERROR_MESSAGES` covers EVERY custom error declared in the deployed
 * ABIs (VestingFactory + TestToken); the completeness test in
 * `test/errors.test.ts` fails if a future contract error is added without a
 * sentence here.
 */

/** Custom error name → user-facing sentence (FR-017). */
export const CUSTOM_ERROR_MESSAGES: Record<string, string> = {
  // --- VestingFactory -------------------------------------------------------
  FeeOnTransferRejected:
    'The token charged a fee on transfer, so the schedule was not created. Use a standard token with no transfer tax.',
  InsufficientAllowance:
    'The factory is not approved to move that many tokens yet. Approve the amount first and try again.',
  InsufficientBalance:
    'This wallet does not hold enough of the token to fund the schedule.',
  InvalidCliff:
    'The cliff is longer than the vesting duration. Pick a shorter cliff.',
  InvalidDuration:
    'The vesting duration is too short. Choose a longer duration.',
  InvalidStart:
    'The start time is in the past. Choose now or a future date.',
  NothingToRelease:
    'There is nothing to release right now — no tokens have vested since your last claim.',
  ReentrancyGuardReentrantCall:
    'This contract is already processing another call. Wait for it to finish and try again.',
  SafeERC20FailedOperation:
    'The token rejected the transfer, so nothing was moved. Check the token address and try again.',
  ScheduleNotFound: 'That schedule does not exist on this network.',
  ZeroAddress: 'The address cannot be the zero address. Pick a real wallet.',
  ZeroAmount: 'The amount must be greater than zero.',

  // --- TestToken (OpenZeppelin ERC-20 + Ownable + faucet) -------------------
  ERC20InsufficientAllowance:
    'The wallet is not approved to move that many tokens. Approve the amount first and try again.',
  ERC20InsufficientBalance:
    'This wallet does not hold enough tokens for this action.',
  ERC20InvalidApprover: 'The approving address is not valid.',
  ERC20InvalidReceiver: 'The receiving address is not valid.',
  ERC20InvalidSender: 'The sending address is not valid.',
  ERC20InvalidSpender: 'The spender address is not valid.',
  FaucetCooldown:
    'This wallet already claimed test tokens in the last 24 hours. Try again later.',
  OwnableInvalidOwner:
    'The contract owner setting is not valid. This is a setup problem on the network.',
  OwnableUnauthorizedAccount:
    'This wallet is not allowed to perform that admin action.',
};

/** Nothing known about the failure — the safest possible sentence. */
export const GENERIC_FAILURE_MESSAGE = 'The transaction did not go through. Please try again.';

/** A contract custom error we do not map (yet) — never leak its name. */
export const UNKNOWN_CONTRACT_ERROR_MESSAGE =
  'The contract rejected this transaction — nothing was sent. Please try again.';

interface ErrorLike {
  message?: unknown;
  shortMessage?: unknown;
  details?: unknown;
  errorName?: unknown;
  reason?: unknown;
  cause?: unknown;
  walk?: unknown;
}

/**
 * `Name(` embedded in a revert message — matches both `Name()` and
 * `Name(address,uint256,uint256)` signatures.
 */
const CUSTOM_ERROR_PATTERN = /([A-Za-z_][A-Za-z0-9_]*)\(/;

/** A bare word can only be a custom-error name if it is a C-like identifier. */
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Raw revert data (selectors, encoded args) must never reach the screen. */
const HEX_PATTERN = /0x[0-9a-fA-F]{6,}/;

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
 * or `undefined` when the revert was not a custom error.
 */
export function extractCustomErrorName(error: unknown): string | undefined {
  for (const part of errorParts(error)) {
    const candidate = part as ErrorLike;

    if (
      typeof candidate.errorName === 'string' &&
      IDENTIFIER_PATTERN.test(candidate.errorName)
    ) {
      return candidate.errorName;
    }
    // `reason` may be prose ("out of gas") — only a bare identifier counts.
    if (typeof candidate.reason === 'string' && IDENTIFIER_PATTERN.test(candidate.reason)) {
      return candidate.reason;
    }
    if (typeof candidate.message === 'string') {
      const match = CUSTOM_ERROR_PATTERN.exec(candidate.message);
      if (match) return match[1];
    }
    if (typeof candidate.shortMessage === 'string') {
      const match = CUSTOM_ERROR_PATTERN.exec(candidate.shortMessage);
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
 * friendly sentence (FR-017). The raw error name and raw revert hex must
 * never appear in the result.
 */
export function friendlyErrorMessage(error?: unknown): string {
  if (error === undefined || error === null) {
    return GENERIC_FAILURE_MESSAGE;
  }

  // 1. a custom error we know → its exact friendly sentence
  const errorName = extractCustomErrorName(error);
  if (errorName) {
    const mapped = CUSTOM_ERROR_MESSAGES[errorName];
    if (mapped) return mapped;
    // 2. a custom error we do NOT know → generic contract rejection, no name
    return UNKNOWN_CONTRACT_ERROR_MESSAGE;
  }

  const text = errorText(error);

  // 3. a mapped name quoted without parentheses still decodes
  for (const [name, sentence] of Object.entries(CUSTOM_ERROR_MESSAGES)) {
    if (text.includes(name)) return sentence;
  }

  // 4. wallet and gas failures read as friendly sentences
  if (/user (rejected|denied)|rejected the request|user closed|action rejected/i.test(text)) {
    return 'You rejected the request in your wallet — nothing was sent.';
  }
  if (/insufficient funds|exceeds balance/i.test(text)) {
    return 'Not enough ETH in your wallet to pay for gas.';
  }

  // 5. otherwise viem's shortMessage — but only if it leaks no raw hex
  const shortMessage = shortMessageOf(error);
  if (shortMessage !== undefined && !HEX_PATTERN.test(shortMessage)) {
    return shortMessage;
  }
  return GENERIC_FAILURE_MESSAGE;
}
