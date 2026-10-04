/**
 * T025 — schema valid/invalid matrix mirroring chain rules V1–V6 (data-model.md).
 * Written BEFORE `src/lib/schemas.ts` (constitution II / strict TDD): every
 * invalid case must fail validation with the exact inline message the form
 * will show (FR-018: inline, before any wallet prompt).
 */
import { describe, expect, it } from 'vitest';
import {
  MONTH_CONVENTION_COPY,
  createScheduleSchema,
  type CreateScheduleContext,
} from '../src/lib/schemas';

const NOW = 1_700_000_000;
const DECIMALS = 18;
const BALANCE = 1_000n * 10n ** 18n; // 1,000 TEST
const TOKEN = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const BENEFICIARY = '0x328809Bc894f92807417D2dAD6b7C998c1aFdac6';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const baseContext: CreateScheduleContext = {
  nowSeconds: NOW,
  walletBalance: BALANCE,
  decimals: DECIMALS,
};

function validInput() {
  return {
    token: TOKEN,
    beneficiary: BENEFICIARY,
    startMode: 'now' as 'now' | 'date',
    startDate: '',
    cliffMonths: '3',
    durationMonths: '6',
    amount: '100',
  };
}

type FormInput = ReturnType<typeof validInput>;

/** Parse `{ ...validInput(), ...patch }` and return every issue (must fail). */
function issuesFor(patch: Partial<FormInput>, ctx: CreateScheduleContext = baseContext) {
  const result = createScheduleSchema(ctx).safeParse({ ...validInput(), ...patch });
  if (result.success) {
    throw new Error(`expected validation issues for ${JSON.stringify(patch)}, but input passed`);
  }
  return result.error.issues;
}

/** The single issue expected on `path` for this patch. */
function issueOn(path: string, patch: Partial<FormInput>, ctx?: CreateScheduleContext) {
  const issues = issuesFor(patch, ctx);
  const found = issues.find((issue) => issue.path[0] === path);
  expect(
    found,
    `expected an issue on "${path}", got: ${JSON.stringify(issues)}`,
  ).toBeDefined();
  return found!;
}

/** The input must pass (boundary / happy cases). */
function expectValid(patch: Partial<FormInput>, ctx: CreateScheduleContext = baseContext) {
  const result = createScheduleSchema(ctx).safeParse({ ...validInput(), ...patch });
  expect(
    result.success,
    result.success ? '' : `unexpected issues: ${JSON.stringify(result.error.issues)}`,
  ).toBe(true);
}

const pastDate = new Date((NOW - 60) * 1000).toISOString(); // V3: before now
const nowDate = new Date(NOW * 1000).toISOString(); // V3: exactly now (boundary)
const futureDate = new Date((NOW + 3_600) * 1000).toISOString(); // V3: after now

describe('createScheduleSchema — happy path', () => {
  it('accepts a fully valid schedule (all of V1–V6 satisfied)', () => {
    expectValid({});
  });
});

describe('month-convention copy (FR-018)', () => {
  it('is exactly "1 month = 30 days" so the form can render it next to cliff and duration', () => {
    expect(MONTH_CONVENTION_COPY).toBe('1 month = 30 days');
  });
});

describe('V1 — token address', () => {
  it('rejects the zero token address', () => {
    const issue = issueOn('token', { token: ZERO_ADDRESS });
    expect(issue.message).toBe('Token address cannot be the zero address.');
  });

  it('rejects a malformed token address', () => {
    const issue = issueOn('token', { token: 'not-an-address' });
    expect(issue.message).toBe('Token must be a 0x address.');
  });
});

describe('V2 — beneficiary address', () => {
  it('rejects the zero beneficiary address', () => {
    const issue = issueOn('beneficiary', { beneficiary: ZERO_ADDRESS });
    expect(issue.message).toBe('Beneficiary address cannot be the zero address.');
  });

  it('rejects a malformed beneficiary address', () => {
    const issue = issueOn('beneficiary', { beneficiary: '0x123' });
    expect(issue.message).toBe('Beneficiary must be a 0x address.');
  });
});

describe('V3 — start is now or future', () => {
  it('"Start now" mode is always valid (chain receives 0)', () => {
    expectValid({ startMode: 'now', startDate: '' });
  });

  it('rejects a date before the current time', () => {
    const issue = issueOn('startDate', { startMode: 'date', startDate: pastDate });
    expect(issue.message).toBe('Start must be now or a future date.');
  });

  it('accepts a start exactly at the current time (boundary, >= now)', () => {
    expectValid({ startMode: 'date', startDate: nowDate });
  });

  it('accepts a future date', () => {
    expectValid({ startMode: 'date', startDate: futureDate });
  });

  it('requires a date when date mode is selected', () => {
    const issue = issueOn('startDate', { startMode: 'date', startDate: '' });
    expect(issue.message).toBe('Pick a start date, or choose "Start now".');
  });
});

describe('V4 — duration months', () => {
  it('rejects 0 months', () => {
    const issue = issueOn('durationMonths', { durationMonths: '0' });
    expect(issue.message).toBe('Duration must be a whole multiple of 3 months (at least 3).');
  });

  it('rejects a non-multiple of 3', () => {
    const issue = issueOn('durationMonths', { durationMonths: '4' });
    expect(issue.message).toBe('Duration must be a whole multiple of 3 months (at least 3).');
  });

  it('rejects a non-integer duration', () => {
    const issue = issueOn('durationMonths', { durationMonths: '4.5' });
    expect(issue.message).toBe('Duration must be a whole multiple of 3 months (at least 3).');
  });

  it('rejects an empty duration', () => {
    const issue = issueOn('durationMonths', { durationMonths: '' });
    expect(issue.message).toBe('Duration must be a whole multiple of 3 months (at least 3).');
  });

  it('accepts multiples of 3', () => {
    expectValid({ cliffMonths: '0', durationMonths: '3' });
    expectValid({ cliffMonths: '3', durationMonths: '9' });
  });
});

describe('V5 — cliff months', () => {
  it('rejects a cliff that is not a multiple of 3', () => {
    const issue = issueOn('cliffMonths', { cliffMonths: '1' });
    expect(issue.message).toBe('Cliff must be a whole multiple of 3 months.');
  });

  it('rejects a cliff longer than the duration', () => {
    const issue = issueOn('cliffMonths', { cliffMonths: '6', durationMonths: '3' });
    expect(issue.message).toBe('Cliff cannot be longer than the duration.');
  });

  it('accepts a cliff equal to the duration (boundary, <=)', () => {
    expectValid({ cliffMonths: '3', durationMonths: '3' });
  });

  it('accepts a zero cliff', () => {
    expectValid({ cliffMonths: '0', durationMonths: '6' });
  });
});

describe('V6 — amount', () => {
  it('rejects zero', () => {
    const issue = issueOn('amount', { amount: '0' });
    expect(issue.message).toBe('Amount must be greater than zero.');
  });

  it('rejects a negative amount', () => {
    const issue = issueOn('amount', { amount: '-5' });
    expect(issue.message).toBe('Amount must be greater than zero.');
  });

  it('rejects a non-numeric amount', () => {
    const issue = issueOn('amount', { amount: 'abc' });
    expect(issue.message).toBe('Amount must be a number with at most 18 decimals.');
  });

  it('rejects an empty amount', () => {
    const issue = issueOn('amount', { amount: '' });
    expect(issue.message).toBe('Amount must be a number with at most 18 decimals.');
  });

  it('rejects more decimal places than the token supports', () => {
    const issue = issueOn('amount', { amount: '1.0000000000000000001' }); // 19 decimals
    expect(issue.message).toBe('Amount must be a number with at most 18 decimals.');
  });

  it('rejects an amount above the wallet balance', () => {
    const issue = issueOn('amount', { amount: '1000.5' });
    expect(issue.message).toBe('Amount exceeds your wallet balance.');
  });

  it('accepts an amount exactly equal to the wallet balance (boundary, <=)', () => {
    expectValid({ amount: '1000' });
  });

  it('re-evaluates against a different wallet balance (context, not globals)', () => {
    const brokeContext = { ...baseContext, walletBalance: 10n * 10n ** 18n };
    const issue = issueOn('amount', { amount: '100' }, brokeContext);
    expect(issue.message).toBe('Amount exceeds your wallet balance.');
  });
});
