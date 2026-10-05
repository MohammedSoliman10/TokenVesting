/**
 * T051 — contract error → friendly sentence map completeness — tests FIRST
 * (strict TDD).
 *
 * Rules under test (FR-017):
 *  - EVERY custom error declared in the deployed ABIs (VestingFactory and
 *    TestToken) has a friendly sentence in CUSTOM_ERROR_MESSAGES — so a
 *    future contract error fails this test until it is mapped
 *  - the raw error name and raw revert hex NEVER appear in the output of
 *    friendlyErrorMessage
 *  - an unknown custom error (a name we do not map yet) falls back to a
 *    generic friendly sentence instead of leaking the revert text
 */
import { describe, expect, it } from 'vitest';
import type { Abi } from 'viem';
import {
  CUSTOM_ERROR_MESSAGES,
  GENERIC_FAILURE_MESSAGE,
  UNKNOWN_CONTRACT_ERROR_MESSAGE,
  friendlyErrorMessage,
} from '../src/lib/errors';
import { abiFor } from '../src/contracts';

/** Every `type: 'error'` name declared in an ABI. */
function errorNames(abi: Abi): string[] {
  return abi
    .filter((entry) => entry.type === 'error')
    .map((entry) => (entry as { name: string }).name);
}

const ALL_ABI_ERRORS = [...errorNames(abiFor('VestingFactory')), ...errorNames(abiFor('TestToken'))];

const HEX_PATTERN = /0x[0-9a-fA-F]{6,}/;

/**
 * A viem-style custom-error object: name in the message (with and without
 * arguments), raw revert data in `details`.
 */
function revertMock(name: string, withArgs = false) {
  const signature = withArgs ? `${name}(address,uint256,uint256)` : `${name}()`;
  return Object.assign(new Error(`execution reverted: ${signature}`), {
    shortMessage: `execution reverted with custom error ${signature}`,
    details: '0xb10205eddeadbeef',
  });
}

describe('CUSTOM_ERROR_MESSAGES completeness (T051)', () => {
  it('the ABIs actually declare the errors this test iterates', () => {
    // guards against the fixture silently becoming empty
    expect(ALL_ABI_ERRORS.length).toBeGreaterThanOrEqual(20);
    expect(ALL_ABI_ERRORS).toContain('FaucetCooldown');
    expect(ALL_ABI_ERRORS).toContain('NothingToRelease');
  });

  it('every contract error in the ABIs has a friendly sentence', () => {
    for (const name of ALL_ABI_ERRORS) {
      const mapped = CUSTOM_ERROR_MESSAGES[name];
      expect(mapped, `missing friendly message for contract error ${name}`).toBeTypeOf('string');
      expect(mapped.trim().length, `empty message for contract error ${name}`).toBeGreaterThan(0);
      // friendly human sentences only — no raw identifiers inside the copy
      expect(mapped, `${name} maps to a raw-looking sentence`).not.toMatch(/[a-z][A-Z]/);
    }
  });

  it('the map is keyed only by errors that exist in the ABIs', () => {
    for (const name of Object.keys(CUSTOM_ERROR_MESSAGES)) {
      expect(ALL_ABI_ERRORS, `${name} is not declared in any ABI`).toContain(name);
    }
  });
});

describe('friendlyErrorMessage never leaks raw reverts (T051)', () => {
  it('returns the friendly sentence for every mapped contract error, with no raw name or hex', () => {
    for (const name of ALL_ABI_ERRORS) {
      const expected = CUSTOM_ERROR_MESSAGES[name];

      for (const error of [revertMock(name), revertMock(name, true)]) {
        const message = friendlyErrorMessage(error);
        expect(message, `${name} did not map to its friendly sentence`).toBe(expected);
        expect(message).not.toContain(name);
        expect(message).not.toMatch(HEX_PATTERN);
      }
    }
  });

  it('an unknown custom error falls back to a generic friendly sentence', () => {
    const message = friendlyErrorMessage(revertMock('TotallyUnknownContractError'));

    expect(message).toBe(UNKNOWN_CONTRACT_ERROR_MESSAGE);
    expect(message).not.toContain('TotallyUnknownContractError');
    expect(message).not.toMatch(HEX_PATTERN);
  });

  it('raw revert hex in a shortMessage is never shown', () => {
    const error = Object.assign(new Error('execution reverted'), {
      shortMessage: 'execution reverted: 0x08c379a0deadbeef',
      details: '0x08c379a0deadbeef',
    });

    const message = friendlyErrorMessage(error);
    expect(message).not.toMatch(HEX_PATTERN);
    expect(message).toBe(GENERIC_FAILURE_MESSAGE);
  });

  it('a wallet rejection still reads as a friendly sentence', () => {
    const error = Object.assign(new Error('User denied transaction signature.'), {
      shortMessage: 'User rejected the request.',
    });
    expect(friendlyErrorMessage(error)).toBe(
      'You rejected the request in your wallet — nothing was sent.',
    );
  });

  it('no error at all falls back to the generic sentence', () => {
    expect(friendlyErrorMessage(undefined)).toBe(
      'The transaction did not go through. Please try again.',
    );
    expect(friendlyErrorMessage(null)).toBe(
      'The transaction did not go through. Please try again.',
    );
  });
});
