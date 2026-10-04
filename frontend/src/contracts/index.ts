/**
 * Generated-artifacts wiring (research R6, task T012).
 *
 * `deployments.json` and `abis/*.json` are WRITTEN BY `script/Deploy.s.sol`
 * (task T024) and are committed to git on purpose so the Vercel build never
 * needs a chain (research R6). Never hardcode contract addresses or ABIs
 * anywhere else in the app — always read them from here.
 *
 * `deployments.json` shape (data-model.md):
 *   { [chainId]: { "VestingFactory": "0x...", "TestToken": "0x..." } }
 */
import type { Abi } from 'viem';
import deploymentsJson from './deployments.json';
import testTokenAbiJson from './abis/TestToken.json';
import vestingFactoryAbiJson from './abis/VestingFactory.json';

export type ContractName = 'VestingFactory' | 'TestToken';

/** Addresses present on a chain (keys absent until the deploy script runs). */
export type DeploymentRecord = Partial<Record<ContractName, string>>;

const deployments = deploymentsJson as Record<string, DeploymentRecord>;

const abis: Record<ContractName, Abi> = {
  VestingFactory: vestingFactoryAbiJson as unknown as Abi,
  TestToken: testTokenAbiJson as unknown as Abi,
};

/** ABI for a contract (empty array until `script/Deploy.s.sol` runs, T024). */
export function abiFor(name: ContractName): Abi {
  return abis[name];
}

/** Addresses on `chainId`, or `{}` when nothing is deployed on that chain. */
export function addressesFor(chainId: number | string): DeploymentRecord {
  const record = deployments[String(chainId)];
  if (!record) return {};
  const result: DeploymentRecord = {};
  if (record.VestingFactory) result.VestingFactory = record.VestingFactory;
  if (record.TestToken) result.TestToken = record.TestToken;
  return result;
}

/** Single-address lookup; `undefined` before the deploy script runs. */
export function contractAddress(
  chainId: number | string,
  name: ContractName,
): string | undefined {
  return deployments[String(chainId)]?.[name];
}

/** True when both contracts have an address for `chainId`. */
export function isDeployed(chainId: number | string): boolean {
  const record = deployments[String(chainId)];
  return Boolean(record?.VestingFactory && record?.TestToken);
}

/** Chain ids present in deployments.json (empty until the deploy script runs). */
export const knownChainIds: number[] = Object.keys(deployments).map(Number);

const SEPOLIA_ID = 11155111;
const ANVIL_ID = 31337;

/**
 * Chain the app targets — `VITE_CHAIN_ID` when it is a supported chain
 * (Sepolia/anvil), otherwise Sepolia (research R12 defaults).
 * `lib/wagmi.ts` consumes this so chain-id logic lives in one place.
 */
export const activeChainId: number = (() => {
  const fromEnv = Number(import.meta.env.VITE_CHAIN_ID ?? '');
  return fromEnv === SEPOLIA_ID || fromEnv === ANVIL_ID ? fromEnv : SEPOLIA_ID;
})();

/** Addresses on the active chain (`VITE_CHAIN_ID`). */
export function activeAddresses(): DeploymentRecord {
  return addressesFor(activeChainId);
}
