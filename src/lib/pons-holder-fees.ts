import { constants, providers, utils } from 'ethers';
import { PONS_CHAIN_ID, PONS_FACTORY } from './pons';
import { FACTORY_ABI } from './pons-abi';
import { LAUNCH_FACTORY_HASH, verifyRuntime } from './trusted-runtime';
import { getWalletProvider, getWalletVersion } from './wallet-provider';
import type { LaunchDraft, LaunchReceipt, PreparedLaunch, WalletState } from './pons-types';

// Observations from the official PONS create client and chain block 0x38c9901.
// These are drift detectors, NOT verified distributor source or release approval.
export const HOLDER_FACTORY = '0x70e95CC5f03DB2906081E7a8D16e4C4209291507';
export const HOLDER_PROXY_HASH = '0x84e98e202d35f69a0307b3a2de5c888c269a9302cc1600060622e7f86a4a2f45';
export const HOLDER_IMPLEMENTATION = '0xa5ce545942caed85267db00abbdba89dac675088';
export const HOLDER_IMPLEMENTATION_HASH = '0xe3e2046fb00442b36dbf67c78962d896303c3777f15589cd60a2e987ed00ad07';
export const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
export const HOLDER_SETUP_BLOCKER = 'Holder fee setup is unavailable in HOODLABS while distributor contract verification is incomplete. No setup transaction has been requested.';
export function holderFeeLaunchBlocker(requested: boolean): string {
  return requested ? 'Holder fee launches are unavailable until distributor verification is complete. Turn off holder fee sharing to prepare a normal creator-fee launch.' : '';
}
export const HOLDER_PROFILE_URL = 'https://www.ponsfamily.com/profile';
export const HOLDER_READ_ABI = [
  'function getLaunchedToken(address token) view returns ((address token, address curve, address deployer, address creatorFeeRecipient, address pairToken, uint256 graduationThreshold, uint24 poolFee, int24 tickSpacing, uint16 creatorTaxBps, bool buybackEnabled, uint8 phase, uint256 sweptQuote, uint256 sweptTokens, uint256 sweptAt, bool exists))',
  'function distributorOf(address token) view returns (address)',
];
const readAbi = new utils.Interface(HOLDER_READ_ABI);
const launchAbi = new utils.Interface(FACTORY_ABI);
const intents = new WeakMap<PreparedLaunch, boolean>();
const activeReads = new Set<string>();
function address(value: string): string {
  const result = utils.getAddress(value);
  if (result === constants.AddressZero) throw new Error('A nonzero token or account address is required.');
  return result;
}
function same(a: string, b: string): boolean { return a.toLowerCase() === b.toLowerCase(); }

/** A toggle cannot retain an earlier custom fee recipient. No shared draft mutation. */
export function holderFeeLaunchDraft(draft: LaunchDraft, requested: boolean, account: string): LaunchDraft {
  return { ...draft, creatorFeeRecipient: requested ? address(account) : draft.creatorFeeRecipient };
}
export function rememberHolderFeeIntent(prepared: PreparedLaunch, requested: boolean): void {
  if (requested && !same(prepared.account, prepared.creatorFeeRecipient)) throw new Error('Holder sharing requires the connected launch account as the initial fee recipient.');
  if (intents.has(prepared)) throw new Error('This launch review already has a holder fee preference. Prepare a new review.');
  intents.set(prepared, requested);
}
export function preparedHolderFeeIntent(prepared: PreparedLaunch): boolean {
  const requested = intents.get(prepared);
  if (requested === undefined) throw new Error('Holder fee preference is missing. Prepare a new launch review.');
  return requested;
}
export interface HolderFeeLaunchBinding { readonly requested: boolean; readonly account: string; readonly transactionHash: string; readonly token: string; }
export function bindHolderFeeLaunch(prepared: PreparedLaunch, receipt: LaunchReceipt): HolderFeeLaunchBinding {
  if (!/^0x[0-9a-f]{64}$/i.test(receipt.transactionHash)) throw new Error('A confirmed launch transaction hash is required.');
  return Object.freeze({ requested: preparedHolderFeeIntent(prepared), account: address(prepared.account), transactionHash: receipt.transactionHash, token: address(receipt.tokenAddress) });
}
export interface HolderFeeObservation {
  readonly status: 'not-created' | 'distributor-unverified' | 'routing-unverified';
  readonly token: string;
  readonly recipient: string;
  readonly distributor: string | null;
  readonly callerIsRecipient: boolean;
  readonly blockNumber: number;
  readonly setupAvailable: false;
}

/** Always read-only. Never infer distributor correctness or enabled sharing from a mapping. */
export async function inspectHolderFees(receipt: LaunchReceipt, wallet: WalletState, assertActive: () => void): Promise<HolderFeeObservation> {
  const token = address(receipt.tokenAddress), account = address(wallet.account);
  const key = token.toLowerCase();
  if (activeReads.has(key)) throw new Error('A holder fee status check is already running.');
  const ethereum = getWalletProvider(), version = getWalletVersion();
  if (!ethereum || wallet.chainId !== PONS_CHAIN_ID) throw new Error('Connect the launch wallet on chain 4663.');
  const current = () => {
    assertActive();
    if (ethereum !== getWalletProvider() || version !== getWalletVersion()) throw new Error('Wallet changed. Check holder fee status again.');
  };
  const checked = async <T>(request: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([request, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Holder fee lookup timed out. Check status again.')), 15000); })]);
      current(); return value;
    } finally { if (timer !== undefined) clearTimeout(timer); }
  };
  const provider = new providers.Web3Provider(ethereum as providers.ExternalProvider, 'any');
  const walletCheck = async () => {
    current();
    const chain = await checked(ethereum.request({ method: 'eth_chainId' }));
    const accounts = await checked(ethereum.request({ method: 'eth_accounts' }));
    if (Number(chain) !== PONS_CHAIN_ID || !Array.isArray(accounts) || typeof accounts[0] !== 'string' || !same(accounts[0], account)) throw new Error('Wallet account or chain changed. Check again.');
  };
  activeReads.add(key);
  try {
    await walletCheck(); current();
    if (!/^0x[0-9a-f]{64}$/i.test(receipt.transactionHash)) throw new Error('Launch receipt hash is invalid.');
    const launch = await checked(provider.getTransactionReceipt(receipt.transactionHash));
    const head = await checked(provider.getBlockNumber());
    if (!Number.isSafeInteger(head) || head < 1) throw new Error('Invalid chain head.');
    if (!launch || !Number.isSafeInteger(launch.blockNumber) || launch.blockNumber < 1 || launch.status !== 1 || !same(launch.transactionHash, receipt.transactionHash) || !same(launch.from, account) || head - launch.blockNumber + 1 < 2) throw new Error('Launch needs a successful receipt and two confirmations from this account.');
    const launchBlock = await checked(provider.getBlock(launch.blockNumber));
    if (!launchBlock || launchBlock.hash !== launch.blockHash) throw new Error('Launch receipt is not canonical. Check again.');
    const matching = launch.logs.filter(log => {
      if (!same(log.address, PONS_FACTORY)) return false;
      try {
        const parsed = launchAbi.parseLog(log);
        return parsed.name === 'TokenLaunched' && same(parsed.args.token, token) && same(parsed.args.curve, receipt.curveAddress) && same(parsed.args.deployer, account) && same(parsed.args.pairToken, receipt.pairToken || constants.AddressZero);
      } catch { return false; }
    });
    if (matching.length !== 1) throw new Error('Launch receipt does not match this token and the trusted factory.');
    const snapshot = await checked(provider.getBlock(head));
    await checked(verifyRuntime(provider, PONS_FACTORY, LAUNCH_FACTORY_HASH, head));
    await checked(verifyRuntime(provider, HOLDER_FACTORY, HOLDER_PROXY_HASH, head));
    const slot = await checked(provider.getStorageAt(HOLDER_FACTORY, IMPLEMENTATION_SLOT, head));
    if (!/^0x0{24}[0-9a-f]{40}$/i.test(slot) || !same('0x' + slot.slice(-40), HOLDER_IMPLEMENTATION)) throw new Error('Holder factory implementation changed. Setup remains unavailable.');
    await checked(verifyRuntime(provider, HOLDER_IMPLEMENTATION, HOLDER_IMPLEMENTATION_HASH, head));
    const rawLaunch = await checked(provider.call({ to: PONS_FACTORY, data: readAbi.encodeFunctionData('getLaunchedToken', [token]) }, head));
    if (rawLaunch.length !== 2 + 15 * 64) throw new Error('Invalid launch factory response.');
    const launched = readAbi.decodeFunctionResult('getLaunchedToken', rawLaunch)[0];
    if (!launched.exists || !same(launched.token, token) || !same(launched.curve, receipt.curveAddress) || !same(launched.deployer, account) || !same(launched.pairToken, receipt.pairToken || constants.AddressZero)) throw new Error('Token is not this wallet’s confirmed launch in the trusted factory.');
    const rawMapping = await checked(provider.call({ to: HOLDER_FACTORY, data: readAbi.encodeFunctionData('distributorOf', [token]) }, head));
    if (rawMapping.length !== 66) throw new Error('Invalid holder factory mapping response.');
    const mapped: string = readAbi.decodeFunctionResult('distributorOf', rawMapping)[0];
    const distributor = mapped === constants.AddressZero ? null : address(mapped);
    const recipient = address(launched.creatorFeeRecipient);
    if (distributor && await checked(provider.getCode(distributor, head)) === '0x') throw new Error('Mapped distributor has no deployed code. Setup remains unavailable.');
    const finalBlock = await checked(provider.getBlock(head));
    if (!snapshot || !finalBlock || snapshot.hash !== finalBlock.hash) throw new Error('Chain changed during holder fee lookup. Check again.');
    await walletCheck(); current();
    return Object.freeze({ status: !distributor ? 'not-created' : same(recipient, distributor) ? 'routing-unverified' : 'distributor-unverified', token, recipient, distributor, callerIsRecipient: same(account, recipient), blockNumber: head, setupAvailable: false });
  } finally { activeReads.delete(key); provider.removeAllListeners(); }
}

/** Deliberately no write ABI, signer, arbitrary destination, or flag that can bypass this gate. */
export async function enableHolderFees(launchEnabled: boolean): Promise<never> {
  if (!launchEnabled) throw new Error('Live launching is not enabled. No holder fee transaction was requested.');
  throw new Error(HOLDER_SETUP_BLOCKER);
}
