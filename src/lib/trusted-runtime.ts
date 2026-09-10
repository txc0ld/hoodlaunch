import { providers, utils } from 'ethers';
// Independently verified Sourcify deployment/runtime evidence is retained in tests/fixtures.
// These deployments are nonproxy; changes require a reviewed manifest update.
export const LAUNCH_FACTORY_HASH = '0x89a27da6f703e0a7cdd4f233e7cb57604ff75b164530962d3ff7cf8483a67d84';
export const LAUNCH_ROUTER_HASH = '0xed9065184519eaa24a22c2556403d5d8bbb230ff94dbc5c414cf5028e20e52e7';
export const RELAY_SOURCE_HASH = '0x27fed69438cf2a1e69f053e52d5ee6f9637963c44da6035fb9241063240c799e';
export async function verifyRuntime(provider: providers.Provider, address: string, expected: string, blockTag?: number): Promise<void> {
  if (utils.keccak256(await provider.getCode(address, blockTag)) !== expected) throw new Error('A trusted contract has changed or is unavailable. No new transaction may be signed.');
}
