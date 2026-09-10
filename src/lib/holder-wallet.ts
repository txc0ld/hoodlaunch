import { utils } from 'ethers';
import { HOODRICH_CHAIN_ID, type HolderChallenge } from './pro-access';
export interface HolderWallet {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, callback: () => void): void;
  removeListener?(event: string, callback: () => void): void;
}
type AccountRequest = (action: string, data?: Record<string, string>) => Promise<unknown>;
/** An explicit authentication message only. This function never requests a transaction or approval. */
export async function verifyHolderWallet(wallet: HolderWallet, appOrigin: string, request: AccountRequest, assertActive: () => void): Promise<void> {
  assertActive();
  const accounts = await wallet.request({ method: 'eth_requestAccounts' });
  assertActive();
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') throw new Error('Connect a wallet first.');
  const address = utils.getAddress(accounts[0]);
  async function sameWallet() {
    assertActive();
    const current = await wallet.request({ method: 'eth_accounts' });
    const chain = await wallet.request({ method: 'eth_chainId' });
    assertActive();
    if (!Array.isArray(current) || typeof current[0] !== 'string' || utils.getAddress(current[0]) !== address) throw new Error('Your wallet account changed. Start verification again.');
    if (Number(chain) !== HOODRICH_CHAIN_ID) throw new Error('Switch your wallet to Robinhood Chain (4663), then verify again.');
  }
  await sameWallet();
  const challenge = await request('holder-challenge', { address }) as HolderChallenge;
  assertActive();
  const origin = new URL(appOrigin);
  if (!challenge || typeof challenge.challengeId !== 'string' || challenge.challengeId.length > 128 || challenge.chainId !== HOODRICH_CHAIN_ID || utils.getAddress(challenge.address) !== address || typeof challenge.message !== 'string' || challenge.message.length > 4096 ||
      !challenge.message.startsWith(`${origin.host} wants you to sign in with your Ethereum account:\n${address}\n\n`) ||
      !challenge.message.includes(`\nURI: ${origin.origin}/\nVersion: 1\nChain ID: ${HOODRICH_CHAIN_ID}\nNonce: `)) throw new Error('Wallet verification details do not match this site.');
  await sameWallet();
  const signature = await wallet.request({ method: 'personal_sign', params: [utils.hexlify(utils.toUtf8Bytes(challenge.message)), address] });
  assertActive();
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('The wallet returned an unsupported signature.');
  await sameWallet();
  await request('holder-verify', { challengeId: challenge.challengeId, signature });
  assertActive();
}
