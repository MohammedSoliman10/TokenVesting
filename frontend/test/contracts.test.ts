/**
 * Smoke test for the generated-artifacts wiring (task T012).
 *
 * Every assertion here must stay green BOTH before and after
 * `script/Deploy.s.sol` (task T024) overwrites `deployments.json` and
 * `abis/*.json` with real Sepolia/anvil values — no assertions about the
 * deployment being empty, only about the shape of whatever is committed.
 */
import { describe, expect, it } from 'vitest';
import {
  abiFor,
  addressesFor,
  contractAddress,
  isDeployed,
  knownChainIds,
  type ContractName,
} from '../src/contracts';

const CONTRACTS: ContractName[] = ['VestingFactory', 'TestToken'];
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

describe('frontend/src/contracts wiring (T012)', () => {
  it('exposes an ABI array for every contract name', () => {
    for (const name of CONTRACTS) {
      const abi = abiFor(name);
      expect(Array.isArray(abi)).toBe(true);
      for (const item of abi) {
        expect(item).toMatchObject({ type: expect.any(String) });
      }
    }
  });

  it('returns an address record for a chain id, with valid addresses only', () => {
    const sepolia = addressesFor(11155111);
    expect(sepolia).toBeTypeOf('object');
    expect(sepolia).not.toBeNull();
    for (const name of CONTRACTS) {
      const address = sepolia[name];
      if (address !== undefined) {
        expect(address).toMatch(ADDRESS_RE);
      }
    }
  });

  it('keeps addressesFor, contractAddress and isDeployed consistent', () => {
    for (const chainId of [11155111, 31337]) {
      const record = addressesFor(chainId);
      for (const name of CONTRACTS) {
        expect(contractAddress(chainId, name)).toBe(record[name]);
      }
      expect(isDeployed(chainId)).toBe(
        Boolean(record.VestingFactory && record.TestToken),
      );
    }
  });

  it('lists known chain ids that really resolve to deployments', () => {
    expect(Array.isArray(knownChainIds)).toBe(true);
    for (const chainId of knownChainIds) {
      expect(Number.isInteger(chainId)).toBe(true);
      expect(addressesFor(chainId)).not.toEqual({});
    }
  });
});
