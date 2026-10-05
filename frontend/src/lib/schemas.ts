/**
 * T026 — zod schema mirroring the chain validation rules V1–V6 verbatim
 * (data-model.md), so the form rejects everything `VestingFactory` would
 * revert on — inline, before any wallet prompt (FR-018).
 *
 *   V1 token      ≠ 0            → ZeroAddress()
 *   V2 beneficiary≠ 0            → ZeroAddress()
 *   V3 start      == 0 || >= now → block.timestamp check
 *   V4 duration   > 0 && % 3 = 0 → InvalidDuration()
 *   V5 cliff      % 3 = 0 && ≤ duration → InvalidCliff()
 *   V6 amount     > 0 && ≤ wallet balance → ZeroAmount() / atomic-funding revert
 *
 * `now` and the wallet balance are passed in as context (never globals) so the
 * schema stays pure and unit-testable.
 */
import { z } from 'zod';
import { isAddress, parseUnits } from 'viem';

/** Copy shown wherever cliff/duration months are entered (FR-018). */
export const MONTH_CONVENTION_COPY = '1 month = 30 days';

/** TestToken has 18 decimals (FR-014); form amounts parse against this. */
export const TEST_TOKEN_DECIMALS = 18;

/** Validation context — never module-level globals (rules V3 and V6). */
export interface CreateScheduleContext {
  /** Current unix time in seconds (rule V3: start === 0 || start >= now). */
  nowSeconds: number;
  /**
   * Grantor balance of the schedule token in base units (rule V6), or
   * `undefined` when it is unknown (no wallet / read in flight / read
   * failed) — then V6 is skipped instead of reporting a bogus balance error.
   */
  walletBalance: bigint | undefined;
  /** Decimals of the schedule token (amount parsing, rule V6). */
  decimals: number;
}

/** `0x` + 40 hex chars, checked by viem's `isAddress` (checksum-agnostic). */
const addressMessage = (label: string) => `${label} must be a 0x address.`;
const zeroAddressMessage = (label: string) => `${label} address cannot be the zero address.`;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** V1/V2: a usable address that is not the zero address. */
function addressField(label: string) {
  return z
    .string()
    // Explicit `: boolean` keeps the form value a plain string (no 0x-narrowing
    // in the inferred output type) so react-hook-form's generics line up.
    .refine((value): boolean => isAddress(value), addressMessage(label))
    .refine((value): boolean => value.toLowerCase() !== ZERO_ADDRESS, zeroAddressMessage(label));
}

/** Whole, non-negative months parsed from a form string ("3" → 3, "4.5"/"" → null). */
function parseMonths(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

/** `datetime-local` / ISO value → unix seconds, or NaN when unparseable. */
function dateToSeconds(raw: string): number {
  const time = new Date(raw).getTime();
  return Number.isNaN(time) ? Number.NaN : Math.floor(time / 1000);
}

/** Amount decimal places as typed (viem truncates; we reject instead). */
function decimalPlaces(raw: string): number {
  const dot = raw.indexOf('.');
  return dot === -1 ? 0 : raw.length - dot - 1;
}

export const DURATION_MESSAGE = 'Duration must be a whole multiple of 3 months (at least 3).';
export const CLIFF_MULTIPLE_MESSAGE = 'Cliff must be a whole multiple of 3 months.';
export const CLIFF_ORDER_MESSAGE = 'Cliff cannot be longer than the duration.';
export const START_PAST_MESSAGE = 'Start must be now or a future date.';
export const START_MISSING_MESSAGE = 'Pick a start date, or choose "Start now".';
export const AMOUNT_FORMAT_MESSAGE = (decimals: number) =>
  `Amount must be a number with at most ${decimals} decimals.`;
export const AMOUNT_POSITIVE_MESSAGE = 'Amount must be greater than zero.';
export const AMOUNT_BALANCE_MESSAGE = 'Amount exceeds your wallet balance.';

/** Create-schedule form values (react-hook-form + zod). */
export function createScheduleSchema(ctx: CreateScheduleContext) {
  return z
    .object({
      token: addressField('Token'),
      beneficiary: addressField('Beneficiary'),
      startMode: z.enum(['now', 'date']),
      startDate: z.string(),
      cliffMonths: z.string(),
      durationMonths: z.string(),
      amount: z.string(),
    })
    .superRefine((value, ctxRef) => {
      const fail = (path: string, message: string) =>
        ctxRef.addIssue({ code: 'custom', message, path: [path] });

      // V4 — duration: > 0 and a multiple of the 3-month interval.
      const duration = parseMonths(value.durationMonths);
      if (duration === null || duration <= 0 || duration % 3 !== 0) {
        fail('durationMonths', DURATION_MESSAGE);
      }

      // V5 — cliff: multiple of the interval and not longer than the duration.
      const cliff = parseMonths(value.cliffMonths);
      if (cliff === null || cliff % 3 !== 0) {
        fail('cliffMonths', CLIFF_MULTIPLE_MESSAGE);
      } else if (duration !== null && cliff > duration) {
        fail('cliffMonths', CLIFF_ORDER_MESSAGE);
      }

      // V3 — start: "now" sends 0 on chain; a picked date must be >= now.
      if (value.startMode === 'date') {
        const start = dateToSeconds(value.startDate);
        if (Number.isNaN(start)) {
          fail('startDate', START_MISSING_MESSAGE);
        } else if (start < ctx.nowSeconds) {
          fail('startDate', START_PAST_MESSAGE);
        }
      }

      // V6 — amount: parseable within the token's precision, > 0, ≤ balance.
      const raw = value.amount;
      const shapeOk = /^\d+(\.\d+)?$|^-\d+(\.\d+)?$/.test(raw.trim());
      if (!shapeOk || decimalPlaces(raw.trim()) > ctx.decimals) {
        fail('amount', AMOUNT_FORMAT_MESSAGE(ctx.decimals));
        return;
      }
      const wei = parseUnits(raw.trim(), ctx.decimals);
      if (wei <= 0n) {
        fail('amount', AMOUNT_POSITIVE_MESSAGE);
      } else if (ctx.walletBalance !== undefined && wei > ctx.walletBalance) {
        fail('amount', AMOUNT_BALANCE_MESSAGE);
      }
    });
}

export type CreateScheduleValues = z.infer<ReturnType<typeof createScheduleSchema>>;
