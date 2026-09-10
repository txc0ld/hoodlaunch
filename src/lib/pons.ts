import { BigNumber, providers, utils, constants } from 'ethers';
import { FACTORY_ABI, ROUTER_ABI } from './pons-abi';
import type { LaunchConfig, ProtocolState, WalletState, LaunchDraft, PreparedLaunch, LaunchReceipt } from './pons-types';

export const PONS_CHAIN_ID = 4663;
export const PONS_EXPLORER = 'https://robinhoodchain.blockscout.com';
export const PONS_RPC = 'https://rpc.mainnet.chain.robinhood.com';
export const PONS_FACTORY = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
export const PONS_ROUTER = '0xe33E9E479dF8802cb0866d5d05258bEc4cF62948';
const factory = new utils.Interface(FACTORY_ABI);
const router = new utils.Interface(ROUTER_ABI);
const ZERO = constants.AddressZero;
const MAX_AGE = 120000;
interface Ethereum {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: () => void): void;
  removeListener?(event: string, listener: () => void): void;
}
interface Preparation {
  ethereum: Ethereum; threshold: string; token: string; curve: string; tax: number;
  state: 'ready' | 'submitted' | 'settled';
}
// Identity and freezing prevent UI state edits from changing an already reviewed transaction.
const preparations = new WeakMap<PreparedLaunch, Preparation>();
const activeAccounts = new Set<string>();
export const formatEth = (wei: string): string => utils.formatEther(wei);
function fail(message: string): never { throw new Error(message); }
function injected(): Ethereum {
  if (typeof window === 'undefined') return fail('Connect a browser wallet to continue.');
  const value = (window as unknown as { ethereum?: Ethereum }).ethereum;
  if (!value?.request) return fail('No browser wallet found. Install or open an Ethereum wallet.');
  return value;
}
function providerFor(ethereum: Ethereum): providers.Web3Provider {
  return new providers.Web3Provider(ethereum as providers.ExternalProvider, 'any');
}
async function chain(provider: providers.JsonRpcProvider): Promise<number> {
  const rawChainId = await provider.send('eth_chainId', []);
  const id = Number(rawChainId);
  if (id !== PONS_CHAIN_ID) fail('Switch your wallet to Robinhood Chain (4663).');
  return id;
}
async function read(provider: providers.Provider, name: string, args: unknown[] = []) {
  const result = await provider.call({ to: PONS_FACTORY, data: factory.encodeFunctionData(name, args) });
  return factory.decodeFunctionResult(name, result)[0];
}
function configValue(id: string, c: utils.Result): LaunchConfig {
  return { id, supplyWei: c.supply.toString(), curveFeeBps: Number(c.curveFeeBps), phantomQuoteWei: c.phantomQuote.toString(), graduationThresholdWei: c.graduationThreshold.toString(), poolFee: Number(c.poolFee), tickSpacing: Number(c.tickSpacing), enabled: c.enabled };
}
async function codeCheck(provider: providers.Provider, withRouter: boolean): Promise<void> {
  const codes = await Promise.all([provider.getCode(PONS_FACTORY), ...(withRouter ? [provider.getCode(PONS_ROUTER)] : [])]);
  if (codes.some(code => code === '0x' || code === '0x0')) fail('PONS contracts are unavailable on this network.');
}
export async function getProtocolState(): Promise<ProtocolState> {
  try {
    const provider = new providers.JsonRpcProvider({ url: PONS_RPC, timeout: 15000 });
    await chain(provider);
    await codeCheck(provider, true);
    const [count, fee, cap] = await Promise.all([read(provider, 'launchConfigCount'), read(provider, 'launchFee'), read(provider, 'maxCreatorTaxBps')]);
    if (BigNumber.from(count).gt(1000)) fail('Too many protocol configurations to load safely.');
    const configs = await Promise.all(Array.from({ length: Number(count) }, async (_, id) => {
      // Next 12's ES5 transform flattens an awaited array used as a later call argument.
      const config = await read(provider, 'getLaunchConfig', [id]);
      return configValue(String(id), config);
    }));
    await chain(provider);
    return { chainId: PONS_CHAIN_ID, factory: PONS_FACTORY, router: PONS_ROUTER, launchFeeWei: fee.toString(), maxCreatorTaxBps: Number(cap), configs };
  } catch (error) { throw safeError(error); }
}
async function walletState(prompt: boolean): Promise<WalletState> {
  const ethereum = injected();
  const accounts = await ethereum.request({ method: prompt ? 'eth_requestAccounts' : 'eth_accounts' }) as string[];
  if (!Array.isArray(accounts) || !accounts[0]) fail('Connect your wallet to continue.');
  const account = utils.getAddress(accounts[0]);
  const provider = providerFor(ethereum);
  const rawChainId = await ethereum.request({ method: 'eth_chainId' });
  const chainId = Number(rawChainId);
  if (chainId !== PONS_CHAIN_ID) return { account, chainId, balanceWei: '0', canLaunch: false };
  const [balance, eligible] = await Promise.all([provider.getBalance(account), read(provider, 'canLaunch', [account])]);
  await chain(provider);
  const fresh = await ethereum.request({ method: 'eth_accounts' }) as string[];
  if (!fresh[0] || fresh[0].toLowerCase() !== account.toLowerCase()) fail('Wallet account changed. Connect again.');
  return { account, chainId, balanceWei: balance.toString(), canLaunch: Boolean(eligible) };
}
export async function connectWallet(): Promise<WalletState> { try { return await walletState(true); } catch (e) { throw safeError(e); } }
export async function refreshWallet(): Promise<WalletState> { try { return await walletState(false); } catch (e) { throw safeError(e); } }
export async function switchToPons(): Promise<WalletState> {
  const ethereum = injected();
  try { await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1237' }] }); }
  catch (e) {
    if (errorCode(e) !== 4902) throw safeError(e);
    await ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x1237', chainName: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [PONS_RPC], blockExplorerUrls: [PONS_EXPLORER] }] });
  }
  return refreshWallet();
}
export function onWalletChange(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const ethereum = (window as unknown as { ethereum?: Ethereum }).ethereum;
  ['accountsChanged', 'chainChanged', 'disconnect'].forEach(event => ethereum?.on?.(event, callback));
  return () => ['accountsChanged', 'chainChanged', 'disconnect'].forEach(event => ethereum?.removeListener?.(event, callback));
}
async function assertWallet(ethereum: Ethereum, wallet: WalletState): Promise<providers.Web3Provider> {
  if (wallet.chainId !== PONS_CHAIN_ID || injected() !== ethereum) fail('Wallet or network changed. Review the launch again.');
  const provider = providerFor(ethereum);
  await chain(provider);
  const accounts = await ethereum.request({ method: 'eth_accounts' }) as string[];
  if (!accounts[0] || accounts[0].toLowerCase() !== wallet.account.toLowerCase()) fail('Wallet account changed. Review the launch again.');
  return provider;
}
function address(value: string, label: string): string {
  if (!utils.isAddress(value) || utils.getAddress(value) === ZERO) fail(`${label} must be a valid, nonzero address.`);
  return utils.getAddress(value);
}
function textValue(value: string, label: string, max: number, required = false, multiline = false): string {
  const clean = value.trim();
  if ((required && !clean) || utils.toUtf8Bytes(clean).length > max || (multiline ? /[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(clean)) fail(`${label} is missing, too long, or contains control characters.`);
  return clean;
}
function url(value: string, label: string, ipfs = false): string {
  const clean = textValue(value, label, 2048);
  if (!clean) return '';
  if (ipfs && /^ipfs:\/\/[a-zA-Z0-9]+(?:\/[^\s?#]*)?$/.test(clean)) return clean;
  try {
    const parsed = new URL(clean);
    if (parsed.protocol === 'https:' && parsed.hostname && !parsed.username && !parsed.password && !/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(parsed.hostname) && !/\.(local|localhost|internal)$/i.test(parsed.hostname)) return clean;
  } catch { /* Return the same clear validation error for malformed URLs. */ }
  return fail(`${label} must use ${ipfs ? 'ipfs:// or ' : ''}https://.`);
}
function validate(draft: LaunchDraft, account: string) {
  const name = textValue(draft.name, 'Name', 64, true);
  const symbol = textValue(draft.symbol, 'Symbol', 16, true);
  if (!/^[A-Za-z0-9]+$/.test(symbol)) fail('Symbol must contain only letters and numbers.');
  const description = textValue(draft.description, 'Description', 2000, false, true);
  const logo = url(draft.logo, 'Logo', true);
  if (!logo) fail('Upload a logo or provide a permanent logo URL.');
  if (!/^(0|[1-9]\d*)$/.test(draft.configId)) fail('Choose a valid launch configuration.');
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(draft.developerBuyEth)) fail('Developer buy must be an ETH amount with at most 18 decimal places.');
  const buy = utils.parseEther(draft.developerBuyEth);
  if (!Number.isInteger(draft.creatorTaxBps) || draft.creatorTaxBps < 0 || draft.creatorTaxBps > 10000) fail('Creator tax must be a valid basis-point amount.');
  if (!Number.isInteger(draft.slippageBps) || draft.slippageBps < 0 || draft.slippageBps > 500) fail('Slippage must be between 0 and 500 basis points (5%).');
  if (typeof draft.buybackEnabled !== 'boolean') fail('Choose a valid buyback setting.');
  if (!Array.isArray(draft.exemptions) || draft.exemptions.length > 32) fail('At most 32 snipe-tax exemptions are allowed.');
  const exemptions = draft.exemptions.map(value => address(value.trim(), 'Exemption'));
  if (new Set(exemptions).size !== exemptions.length) fail('Remove duplicate exemption addresses.');
  return { name, symbol, logo, description, socials: { twitter: url(draft.twitter, 'Twitter'), telegram: url(draft.telegram, 'Telegram'), discord: url(draft.discord, 'Discord'), website: url(draft.website, 'Website'), farcaster: url(draft.farcaster, 'Farcaster') }, creatorFeeRecipient: address(draft.creatorFeeRecipient.trim() || account, 'Creator fee recipient'), creatorTaxBps: draft.creatorTaxBps, buybackEnabled: draft.buybackEnabled, buy, exemptions };
}
async function terms(provider: providers.Web3Provider, account: string, configId: string, tax: number) {
  await chain(provider);
  const [eligible, config, cap, fee, economics] = await Promise.all([read(provider, 'canLaunch', [account]), read(provider, 'getLaunchConfig', [configId]), read(provider, 'maxCreatorTaxBps'), read(provider, 'launchFee'), read(provider, 'previewLaunchEconomics', [configId, ZERO])]);
  if (!eligible) fail('This wallet is not currently approved to launch on PONS V2.');
  if (!config.enabled) fail('This launch configuration is disabled. Choose another configuration.');
  if (tax > Number(cap)) fail('Creator tax exceeds the current protocol maximum.');
  return { config: configValue(configId, config), fee: BigNumber.from(fee), economics: String(economics) };
}
async function costs(provider: providers.Web3Provider, account: string, tx: providers.TransactionRequest) {
  await chain(provider);
  const [gas, gasPrice, balance] = await Promise.all([provider.estimateGas({ ...tx, from: account }), provider.getGasPrice(), provider.getBalance(account)]);
  const gasLimit = gas.mul(120).add(99).div(100);
  const maxGasPrice = gasPrice.mul(125).add(99).div(100);
  const gasWei = gasLimit.mul(maxGasPrice);
  if (balance.lt(BigNumber.from(tx.value).add(gasWei))) fail('Insufficient ETH for the launch, developer buy, and gas buffer.');
  return { gasLimit, gasWei, maxGasPrice, balance };
}
export async function prepareLaunch(draft: LaunchDraft, wallet: WalletState): Promise<PreparedLaunch> {
  try {
    draft = { ...draft, exemptions: [...draft.exemptions] };
    wallet = { ...wallet };
    const ethereum = injected();
    const provider = await assertWallet(ethereum, wallet);
    if (activeAccounts.has(wallet.account.toLowerCase())) fail('A launch transaction is pending or its outcome is unknown. Check the wallet and explorer before continuing.');
    const valid = validate(draft, wallet.account);
    await codeCheck(provider, !valid.buy.isZero());
    const current = await terms(provider, wallet.account, draft.configId, valid.creatorTaxBps);
    const salt = utils.hexlify(utils.randomBytes(32));
    const params = { ...valid, expectedEconomics: current.economics, salt };
    const value = current.fee.add(valid.buy);
    const buying = !valid.buy.isZero();
    const abi = buying ? router : factory;
    const fn = buying ? 'launchAndBuy' : 'launchToken';
    const args = buying ? [params, draft.configId, ZERO, valid.buy, '0', wallet.account, valid.exemptions] : [params, draft.configId, ZERO, valid.exemptions];
    const tx = { to: buying ? PONS_ROUTER : PONS_FACTORY, data: abi.encodeFunctionData(fn, args), value: value.toHexString() };
    await assertWallet(ethereum, wallet);
    const simulation = await provider.call({ ...tx, from: wallet.account });
    const quoted = abi.decodeFunctionResult(fn, simulation);
    const expected = buying ? BigNumber.from(quoted.tokensOut) : BigNumber.from(0);
    const minimum = expected.mul(10000 - draft.slippageBps).div(10000);
    if (buying) {
      if (minimum.isZero()) fail('Developer buy is too small to set a nonzero protected output.');
      args[4] = minimum.toString();
      tx.data = abi.encodeFunctionData(fn, args);
      await assertWallet(ethereum, wallet);
      await provider.call({ ...tx, from: wallet.account });
    }
    const estimated = await costs(provider, wallet.account, tx);
    await assertWallet(ethereum, wallet);
    const prepared: PreparedLaunch = Object.freeze({ account: wallet.account, chainId: PONS_CHAIN_ID, name: valid.name, symbol: valid.symbol, logo: valid.logo, creatorFeeRecipient: valid.creatorFeeRecipient, launchFeeWei: current.fee.toString(), developerBuyWei: valid.buy.toString(), totalValueWei: value.toString(), estimatedGasWei: estimated.gasWei.toString(), minTokensOut: minimum.toString(), expectedTokensOut: expected.toString(), expectedEconomics: current.economics, configId: draft.configId, salt, createdAt: Date.now(), transaction: Object.freeze({ ...tx, gasLimit: estimated.gasLimit.toString() }) });
    preparations.set(prepared, { ethereum, threshold: current.config.graduationThresholdWei, token: quoted.token, curve: quoted.curve, tax: valid.creatorTaxBps, state: 'ready' });
    return prepared;
  } catch (e) { throw safeError(e); }
}
export type SubmissionState = 'not-submitted' | 'unknown' | 'reverted';
export class PonsSubmissionError extends Error {
  readonly submissionState: SubmissionState;
  constructor(message: string, submissionState: SubmissionState) {
    super(message);
    this.name = 'PonsSubmissionError';
    this.submissionState = submissionState;
    Object.setPrototypeOf(this, PonsSubmissionError.prototype);
  }
}
async function waitForReceipt(hash: string): Promise<providers.TransactionReceipt> {
  // Read from the fixed chain even if the injected wallet changes networks after broadcast.
  const provider = new providers.JsonRpcProvider({ url: PONS_RPC, timeout: 15000 });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const poll = async (): Promise<providers.TransactionReceipt> => {
    while (!stopped) {
      await chain(provider);
      if (stopped) break;
      const receipt = await provider.getTransactionReceipt(hash);
      if (stopped) break;
      if (receipt) return receipt;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error('Receipt confirmation timed out.');
  };
  try {
    return await Promise.race([poll(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { stopped = true; reject(new Error('Receipt confirmation timed out.')); }, 120000);
    })]);
  } finally {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    provider.removeAllListeners();
  }
}
function validateReceipt(receipt: providers.TransactionReceipt, hash: string, prepared: PreparedLaunch): void {
  if (typeof receipt.transactionHash !== 'string' || receipt.transactionHash.toLowerCase() !== hash.toLowerCase()
    || typeof receipt.from !== 'string' || receipt.from.toLowerCase() !== prepared.account.toLowerCase()
    || typeof receipt.to !== 'string' || receipt.to.toLowerCase() !== prepared.transaction.to.toLowerCase()
    || (receipt.status !== 0 && receipt.status !== 1)) {
    fail('Receipt does not match the submitted launch. Check the explorer; do not resend.');
  }
}
function receiptResult(receipt: providers.TransactionReceipt, prepared: PreparedLaunch, record: Preparation): LaunchReceipt {
  if (!Array.isArray(receipt.logs)) fail('Launch receipt logs are unavailable. Check the explorer; do not resend.');
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== PONS_FACTORY.toLowerCase()) continue;
    try {
      const parsed = factory.parseLog(log);
      const a = parsed.args;
      if (parsed.name === 'TokenLaunched' && a.deployer.toLowerCase() === prepared.account.toLowerCase() && a.pairToken === ZERO && a.launchConfigId.eq(prepared.configId) && a.graduationThreshold.eq(record.threshold) && a.token.toLowerCase() === record.token.toLowerCase() && a.curve.toLowerCase() === record.curve.toLowerCase()) return { transactionHash: receipt.transactionHash, tokenAddress: a.token, curveAddress: a.curve, explorerUrl: `${PONS_EXPLORER}/tx/${receipt.transactionHash}` };
    } catch { /* Other factory events are not launch confirmation. */ }
  }
  return fail('Transaction mined, but its expected launch event was not found. Check the explorer; do not resend.');
}
/** The only transaction-writing entry point. Call only from an explicit confirmation action. */
export async function executePreparedLaunch(prepared: PreparedLaunch, wallet: WalletState, onHash?: (hash: string) => void, onSubmitting?: () => void): Promise<LaunchReceipt> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks?.request) throw new PonsSubmissionError('This browser cannot safely coordinate launch confirmations across tabs. Use a browser with Web Locks support.', 'not-submitted');
  let entered = false;
  try {
    // Same global key as the UI's durable marker: all accounts and tabs share one launch intent.
    // ifAvailable prevents stale confirmations from queueing behind another tab's wallet prompt.
    return await locks.request('pons-v2:launch-operation', { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) throw new PonsSubmissionError('A launch confirmation is active in another tab. Check its status before continuing.', 'unknown');
      entered = true;
      return executeUnderLock(prepared, wallet, onHash, onSubmitting);
    });
  } catch (error) {
    if (error instanceof PonsSubmissionError) throw error;
    throw new PonsSubmissionError(entered ? 'Launch coordination was interrupted. Check the wallet and explorer before continuing.' : 'The browser could not safely coordinate this launch confirmation. No wallet request was made.', entered ? 'unknown' : 'not-submitted');
  }
}
async function executeUnderLock(prepared: PreparedLaunch, wallet: WalletState, onHash?: (hash: string) => void, onSubmitting?: () => void): Promise<LaunchReceipt> {
  wallet = { ...wallet };
  const record = preparations.get(prepared);
  const key = prepared.account.toLowerCase();
  if (activeAccounts.has(key)) throw new PonsSubmissionError('A launch transaction is already pending. Do not submit it again.', 'unknown');
  if (!record || record.state !== 'ready') throw new PonsSubmissionError('This launch review is unavailable or already submitted.', record?.state === 'submitted' ? 'unknown' : 'not-submitted');
  activeAccounts.add(key);
  let outcome: SubmissionState = 'not-submitted';
  let confirmedSuccess = false;
  try {
    if (Date.now() - prepared.createdAt > MAX_AGE || Date.now() < prepared.createdAt) fail('Launch review expired. Review fresh terms before confirming.');
    if (wallet.account.toLowerCase() !== key || wallet.chainId !== prepared.chainId) fail('Wallet changed. Review the launch again.');
    const provider = await assertWallet(record.ethereum, wallet);
    const current = await terms(provider, prepared.account, prepared.configId, record.tax);
    if (current.economics.toLowerCase() !== prepared.expectedEconomics.toLowerCase() || !current.fee.eq(prepared.launchFeeWei) || current.config.graduationThresholdWei !== record.threshold) fail('Launch terms changed. Review fresh terms before confirming.');
    await codeCheck(provider, prepared.transaction.to === PONS_ROUTER);
    await assertWallet(record.ethereum, wallet);
    await provider.call({ ...prepared.transaction, from: prepared.account });
    const estimate = await costs(provider, prepared.account, prepared.transaction);
    // The request retains the reviewed gas limit, even if a fresh estimate is lower.
    // Budget and balance must cover that exact limit multiplied by the price we will send.
    const sentGasWei = BigNumber.from(prepared.transaction.gasLimit).mul(estimate.maxGasPrice);
    if (estimate.gasLimit.gt(prepared.transaction.gasLimit) || sentGasWei.gt(prepared.estimatedGasWei)) fail('Gas estimate increased. Review the updated cost before confirming.');
    if (estimate.balance.lt(BigNumber.from(prepared.totalValueWei).add(sentGasWei))) fail('Insufficient ETH for the launch and the full reviewed gas limit.');
    await assertWallet(record.ethereum, wallet);
    if (Date.now() - prepared.createdAt > MAX_AGE) fail('Launch review expired. Review fresh terms before confirming.');
    const request = {
      from: prepared.account, to: prepared.transaction.to, data: prepared.transaction.data,
      value: utils.hexValue(BigNumber.from(prepared.totalValueWei)), gas: utils.hexValue(BigNumber.from(prepared.transaction.gasLimit)),
      gasPrice: utils.hexValue(estimate.maxGasPrice), chainId: utils.hexValue(PONS_CHAIN_ID),
    };
    // Persist intent before opening the wallet. A storage/UI callback failure aborts before sending.
    try { onSubmitting?.(); } catch (error) {
      // The UI detected a durable intent from another tab while holding this same lock.
      if (error instanceof PonsSubmissionError && error.submissionState === 'unknown') outcome = 'unknown';
      throw error;
    }
    outcome = 'unknown';
    record.state = 'submitted';
    let hash: unknown;
    try {
      // Ethers v5 Signer.sendTransaction waits for indexing before returning its hash.
      // The raw wallet request returns the broadcast hash without that unbounded lookup.
      hash = await record.ethereum.request({ method: 'eth_sendTransaction', params: [request] });
    } catch (error) {
      // Only rejection of this actual send request can prove no broadcast occurred.
      if (errorCode(error) === 4001 || errorCode(error) === 'ACTION_REJECTED') { outcome = 'not-submitted'; record.state = 'settled'; }
      throw error;
    }
    if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) fail('Wallet returned an invalid transaction hash.');
    try { onHash?.(hash); } catch { /* A display callback cannot interrupt receipt tracking. */ }
    // Error-attached receipts and replacement objects are never proof of a terminal outcome.
    const receipt = await waitForReceipt(hash);
    validateReceipt(receipt, hash, prepared);
    if (receipt.status === 0) {
      outcome = 'reverted';
      record.state = 'settled';
      throw new Error('Launch transaction reverted. No launch was confirmed.');
    }
    const result = receiptResult(receipt, prepared, record);
    confirmedSuccess = true;
    record.state = 'settled';
    return result;
  } catch (error) {
    if (outcome === 'unknown') throw new PonsSubmissionError('Transaction submission or confirmation is uncertain. It may be pending or replaced. Check your wallet and explorer before any new launch; do not resend.', 'unknown');
    throw new PonsSubmissionError(safeError(error).message, outcome);
  } finally {
    if (outcome !== 'unknown' || confirmedSuccess) activeAccounts.delete(key);
    // Unknown outcomes retain the account lock; UI also retains its durable pending marker.
  }
}

function errorCode(error: unknown): unknown { return (error as { code?: unknown } | null)?.code; }
const CONTRACT_ERRORS: Record<string, string> = {
  SlippageExceeded: 'Developer buy no longer meets the reviewed minimum price. Review a fresh quote.',
  LaunchEconomicsMismatch: 'Launch terms changed. Review fresh terms before confirming.',
  LaunchConfigDisabled: 'This launch configuration is disabled.',
  PairTokenNotApproved: 'The selected pairing asset is not approved.',
  PairTokenDecimalsMismatch: 'The pairing asset decimals do not match the protocol.',
  NativeValueMismatch: 'The ETH amount does not match the required value.',
  UnexpectedNativeValue: 'This transaction has an unexpected ETH value.',
  LaunchFeeNotPaid: 'The launch fee changed or was not paid. Review fresh terms.',
  CreatorTaxTooHigh: 'Creator tax exceeds the current protocol maximum.',
  NotWhitelisted: 'This wallet is not currently approved to launch on PONS V2.',
  ExemptionListTooLong: 'At most 32 snipe-tax exemptions are allowed.',
  CurveGraduated: 'The launch has already graduated from its curve.',
};
function safeError(error: unknown): Error {
  const code = errorCode(error);
  if (code === 4001 || code === 'ACTION_REJECTED') return new Error('Wallet request rejected. No launch was submitted by this request.');
  if (code === 'INSUFFICIENT_FUNDS') return new Error('Insufficient ETH for the launch and gas.');
  const e = error as { message?: string; errorName?: string; data?: unknown; error?: { data?: unknown; errorName?: string }; receipt?: { status?: number } };
  if (e?.receipt?.status === 0) return new Error('Launch transaction reverted. No launch was confirmed.');
  for (const [name, message] of Object.entries(CONTRACT_ERRORS)) {
    const data = typeof e?.data === 'string' ? e.data : e?.error?.data;
    if (e?.errorName === name || e?.error?.errorName === name || e?.message?.includes(name) || (typeof data === 'string' && data.slice(0, 10) === utils.id(`${name}()`).slice(0, 10))) return new Error(message);
  }
  // Preserve our own validation messages, but do not surface wallet/RPC internals or HTML.
  if (error instanceof Error && code === undefined && !/[<>]|https?:\/\/|\{/.test(error.message)) return error;
  return new Error('The wallet or network could not complete this request. Check the network and review again.');
}
