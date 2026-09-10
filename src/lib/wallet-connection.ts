import { walletRegistry, type WalletProvider } from './wallet-provider';

export interface WalletCandidate {
  readonly provider: WalletProvider;
  readonly ticket: number;
  readonly account: string;
  readonly chainId: number;
}
const candidates = new WeakMap<WalletCandidate, { valid: () => boolean; cleanup: () => void }>();
export function boundedWalletRequest<T>(request: Promise<T>, milliseconds = 20000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([request, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Wallet request timed out. Close the request in your wallet and try again.')), milliseconds);
  })]).finally(() => clearTimeout(timer));
}
async function readIdentity(provider: WalletProvider) {
  const accounts = await provider.request({ method: 'eth_accounts' });
  const chain = await provider.request({ method: 'eth_chainId' });
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(accounts[0])) throw new Error('No connected wallet account. Try connecting again.');
  const chainId = Number(chain);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('The wallet returned an invalid network.');
  return { account: accounts[0], chainId };
}
/** SDK results are proposals only. A separate user action confirms the displayed identity. */
export async function prepareWalletCandidate(provider: WalletProvider, ticket: number): Promise<WalletCandidate> {
  let changed = false;
  const invalidate = () => { changed = true; };
  const events = ['accountsChanged', 'chainChanged', 'disconnect'];
  const cleanup = () => { changed = true; events.forEach(event => provider.removeListener?.(event, invalidate)); };
  const valid = () => !changed && walletRegistry.getSelection() === ticket;
  events.forEach(event => provider.on?.(event, invalidate));
  try {
    const identity = await boundedWalletRequest(readIdentity(provider));
    if (!valid()) throw new Error('Wallet selection changed. Connect again.');
    const candidate = Object.freeze({ provider, ticket, ...identity });
    candidates.set(candidate, { valid, cleanup });
    return candidate;
  } catch (error) { cleanup(); throw error; }
}
export function discardWalletCandidate(candidate: WalletCandidate) {
  candidates.get(candidate)?.cleanup(); candidates.delete(candidate);
}
export async function confirmWalletCandidate(candidate: WalletCandidate): Promise<void> {
  const record = candidates.get(candidate);
  try {
    if (!record?.valid()) throw new Error('Wallet selection changed. Connect again.');
    const identity = await boundedWalletRequest(readIdentity(candidate.provider));
    if (!record.valid() || identity.account.toLowerCase() !== candidate.account.toLowerCase() || identity.chainId !== candidate.chainId) throw new Error('Wallet changed since it was displayed. Connect again.');
    if (!walletRegistry.select(candidate.provider, candidate.ticket)) throw new Error('Wallet selection expired. Connect again.');
  } finally { discardWalletCandidate(candidate); }
}
