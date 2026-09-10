import { providers, utils, constants } from 'ethers';
import { PONS_CHAIN_ID, PONS_RPC } from './pons';

export interface NodeBalanceSnapshot {
  readonly chainId: 4663;
  readonly blockNumber: number;
  readonly checkedAt: number;
  readonly balances: readonly { readonly address: string; readonly balanceWei: string }[];
}

/** Reads native ETH at one block. A balance is not proof of its funding source. */
export async function getNodeBalances(addresses: readonly string[]): Promise<NodeBalanceSnapshot> {
  if (!Array.isArray(addresses) || addresses.length < 1 || addresses.length > 50) {
    throw new Error('Choose between 1 and 50 node wallets.');
  }
  const normalized = addresses.map((address) => {
    if (typeof address !== 'string' || !utils.isAddress(address) || address.toLowerCase() === constants.AddressZero) {
      throw new Error('Every node must have a valid wallet address.');
    }
    return utils.getAddress(address);
  });
  if (new Set(normalized.map((address) => address.toLowerCase())).size !== normalized.length) {
    throw new Error('Node wallet addresses must be unique.');
  }
  const provider = new providers.JsonRpcProvider({ url: PONS_RPC, timeout: 15000 });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  async function read(): Promise<NodeBalanceSnapshot> {
    const initialChain = await provider.send('eth_chainId', []);
    if (Number(initialChain) !== PONS_CHAIN_ID) throw new Error('Wrong balance network.');
    const blockNumber = await provider.getBlockNumber();
    if (!Number.isSafeInteger(blockNumber) || blockNumber < 0) throw new Error('Invalid block number.');
    const balances: { readonly address: string; readonly balanceWei: string }[] = [];
    for (let offset = 0; offset < normalized.length; offset += 4) {
      if (stopped) throw new Error('Balance check timed out.');
      const group = await Promise.all(normalized.slice(offset, offset + 4).map(async (address) => {
        const balance = await provider.getBalance(address, blockNumber);
        if (balance.lt(0)) throw new Error('Invalid balance.');
        return Object.freeze({ address, balanceWei: balance.toString() });
      }));
      balances.push(...group);
    }
    if (stopped) throw new Error('Balance check timed out.');
    const finalChain = await provider.send('eth_chainId', []);
    if (Number(finalChain) !== PONS_CHAIN_ID) throw new Error('Balance network changed.');
    return Object.freeze({ chainId: 4663 as const, blockNumber, checkedAt: Date.now(), balances: Object.freeze(balances) });
  }
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => { stopped = true; reject(new Error('Balance check timed out.')); }, 30000);
      }),
    ]);
  } catch {
    throw new Error('Could not read node balances on Robinhood Chain. Try again.');
  } finally {
    stopped = true;
    if (timeout !== undefined) clearTimeout(timeout);
    provider.removeAllListeners();
  }
}
