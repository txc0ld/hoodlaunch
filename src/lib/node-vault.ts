import { Wallet, utils } from 'ethers';
import { copyTradeAmount } from './pons-trade';
import type { NodeBridgeReview, NodeBridgeOperation } from './relay-bridge';

export const MAX_NODES = 50;
const ACCOUNT_PATH = "m/44'/60'/0'/0";
const ROOT_PATH = `${ACCOUNT_PATH}/0`;
const FORMAT = 'forge-node-vault';
const MAX_BACKUP_BYTES = 16 * 1024;
const SCRYPT = { N: 131072, r: 8, p: 1 };

export interface NodeSession {
  readonly id: string;
  readonly addresses: readonly string[];
  readonly backupVerified: boolean;
}

// This module never exposes a signer or secret. Forgetting removes access, but
// JavaScript cannot guarantee that garbage-collected secret strings are erased.
const sessions = new WeakMap<NodeSession, { root: Wallet }>();
let kdfInProgress = false;

function validatePassword(password: string): void {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw new Error('Use a password containing 12 to 128 characters.');
  }
}

function validateCount(count: number): void {
  if (!Number.isInteger(count) || count < 1 || count > MAX_NODES) {
    throw new Error(`Choose between 1 and ${MAX_NODES} nodes.`);
  }
}

function requireSession(session: NodeSession): { root: Wallet } {
  const state = sessions.get(session);
  if (!state) throw new Error('This node session is no longer available. Restore its backup.');
  return state;
}

function progressObserver(callback?: (progress: number) => void): (progress: number) => void {
  return (progress) => {
    // scrypt interprets a truthy callback result as cancellation, and throws
    // from later ticks can leave its promise unresolved. UI observers must
    // neither cancel nor interrupt secret-handling operations accidentally.
    try { if (callback) callback(progress); } catch { /* Progress is advisory. */ }
  };
}

function deriveAddresses(root: Wallet, count: number): string[] {
  if (!root.mnemonic || root.mnemonic.path !== ROOT_PATH || root.mnemonic.locale !== 'en') {
    throw new Error('Invalid recovery root.');
  }
  const tree = utils.HDNode.fromMnemonic(root.mnemonic.phrase);
  const addresses = Array.from({ length: count }, (_, index) => (
    tree.derivePath(`${ACCOUNT_PATH}/${index}`).address
  ));
  if (addresses[0] !== root.address) throw new Error('Invalid recovery root.');
  return addresses;
}

function register(root: Wallet, addresses: readonly string[], backupVerified: boolean): NodeSession {
  const session: NodeSession = Object.freeze({
    id: utils.hexlify(utils.randomBytes(16)),
    addresses: Object.freeze([...addresses]),
    backupVerified,
  });
  sessions.set(session, { root });
  return session;
}

// Bound aggregate memory use as well as the work factor in any individual file.
async function withKdf<T>(operation: () => Promise<T>): Promise<T> {
  if (kdfInProgress) throw new Error('Another wallet encryption or recovery is in progress.');
  kdfInProgress = true;
  try {
    return await operation();
  } finally {
    kdfInProgress = false;
  }
}

type JsonObject = Record<string, unknown>;

function exactObject(value: unknown, keys: readonly string[]): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid backup.');
  const object = value as JsonObject;
  const actualKeys = Object.keys(object);
  if (actualKeys.length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(object, key))) {
    throw new Error('Invalid backup fields.');
  }
  return object;
}

function requireHex(value: unknown, bytes: number): void {
  if (typeof value !== 'string' || !new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(value)) {
    throw new Error('Invalid backup encoding.');
  }
}

// Only our versioned ethers output is imported. In particular, never let ethers'
// permissive parsing of KDF parameters or case-insensitive fields bypass limits.
function validateKeystore(value: unknown): JsonObject {
  const store = exactObject(value, ['address', 'id', 'version', 'crypto', 'x-ethers']);
  requireHex(store.address, 20);
  if (store.version !== 3 || typeof store.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(store.id)) {
    throw new Error('Invalid keystore version.');
  }
  const crypto = exactObject(store.crypto, ['cipher', 'cipherparams', 'ciphertext', 'kdf', 'kdfparams', 'mac']);
  if (crypto.cipher !== 'aes-128-ctr' || crypto.kdf !== 'scrypt') throw new Error('Unsupported backup encryption.');
  const cipherparams = exactObject(crypto.cipherparams, ['iv']);
  requireHex(cipherparams.iv, 16);
  requireHex(crypto.ciphertext, 32);
  requireHex(crypto.mac, 32);
  const kdf = exactObject(crypto.kdfparams, ['salt', 'n', 'dklen', 'p', 'r']);
  if (kdf.n !== SCRYPT.N || kdf.r !== SCRYPT.r || kdf.p !== SCRYPT.p || kdf.dklen !== 32) {
    throw new Error('Unsupported backup encryption cost.');
  }
  requireHex(kdf.salt, 32);
  const mnemonic = exactObject(store['x-ethers'], [
    'client', 'gethFilename', 'mnemonicCounter', 'mnemonicCiphertext', 'path', 'locale', 'version',
  ]);
  if (mnemonic.version !== '0.1' || mnemonic.path !== ROOT_PATH || mnemonic.locale !== 'en' ||
      mnemonic.client !== 'ethers.js' || typeof mnemonic.gethFilename !== 'string' ||
      mnemonic.gethFilename.length > 128) throw new Error('Invalid encrypted recovery phrase.');
  requireHex(mnemonic.mnemonicCounter, 16);
  // Wallet.createRandom uses 128-bit entropy (12 English BIP39 words).
  requireHex(mnemonic.mnemonicCiphertext, 16);
  return store;
}

function manifestMac(root: Wallet, addresses: readonly string[]): string {
  // Domain separation and canonical fields authenticate count/order, preventing
  // a modified file from hiding funded accounts by truncating a valid prefix.
  const manifest = JSON.stringify({ format: FORMAT, version: 1, count: addresses.length, addresses });
  const data = utils.toUtf8Bytes(`forge-node-vault:manifest:v1\n${manifest}`);
  return utils.computeHmac(utils.SupportedAlgorithm.sha256, root.privateKey, data);
}

export function createNodeSession(count: number): NodeSession {
  validateCount(count);
  try {
    const root = Wallet.createRandom({ path: ROOT_PATH, locale: 'en' });
    const addresses = deriveAddresses(root, count);
    return register(root, addresses, false);
  } catch {
    throw new Error('Unable to securely generate node wallets.');
  }
}

export async function encryptNodeBackup(
  session: NodeSession, password: string, onProgress?: (progress: number) => void,
): Promise<string> {
  validatePassword(password);
  const state = requireSession(session);
  return withKdf(async () => {
    try {
      const encrypted = await state.root.encrypt(password, { scrypt: SCRYPT }, progressObserver(onProgress));
      requireSession(session); // A forgotten session must not finish exporting.
      const keystore = validateKeystore(JSON.parse(encrypted));
      return JSON.stringify({
        format: FORMAT, version: 1, count: session.addresses.length,
        addresses: session.addresses, keystore, manifestMac: manifestMac(state.root, session.addresses),
      });
    } catch {
      throw new Error('Unable to encrypt this node backup.');
    }
  });
}

export async function restoreNodeBackup(
  serialized: string, password: string, onProgress?: (progress: number) => void,
): Promise<NodeSession> {
  validatePassword(password);
  return withKdf(async () => {
    try {
      if (typeof serialized !== 'string' || serialized.length > MAX_BACKUP_BYTES ||
          utils.toUtf8Bytes(serialized).length > MAX_BACKUP_BYTES) throw new Error('Backup is too large.');
      const backup = exactObject(JSON.parse(serialized), ['format', 'version', 'count', 'addresses', 'keystore', 'manifestMac']);
      if (backup.format !== FORMAT || backup.version !== 1 || typeof backup.count !== 'number') {
        throw new Error('Unsupported backup version.');
      }
      validateCount(backup.count);
      if (!Array.isArray(backup.addresses) || backup.addresses.length !== backup.count ||
          !backup.addresses.every((address: unknown) => typeof address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(address)) ||
          typeof backup.manifestMac !== 'string' || !/^0x[0-9a-f]{64}$/.test(backup.manifestMac)) {
        throw new Error('Invalid backup manifest.');
      }
      const keystore = validateKeystore(backup.keystore);
      const root = await Wallet.fromEncryptedJson(JSON.stringify(keystore), password, progressObserver(onProgress));
      const addresses = deriveAddresses(root, backup.count);
      if (!addresses.every((address, index) => address === (backup.addresses as string[])[index]) ||
          manifestMac(root, addresses) !== backup.manifestMac) throw new Error('Backup manifest mismatch.');
      return register(root, addresses, true);
    } catch {
      // Never return ethers errors that may embed secret values or input data.
      throw new Error('Unable to restore backup. Check the file and password.');
    }
  });
}

export async function exportNodeKeystore(
  session: NodeSession, index: number, password: string, onProgress?: (progress: number) => void,
): Promise<string> {
  validatePassword(password);
  const state = requireSession(session);
  if (!Number.isInteger(index) || index < 0 || index >= session.addresses.length) throw new Error('Invalid node index.');
  return withKdf(async () => {
    try {
      const node = utils.HDNode.fromMnemonic(state.root.mnemonic.phrase).derivePath(`${ACCOUNT_PATH}/${index}`);
      // Intentionally discard mnemonic metadata: this keystore controls ONLY
      // the selected account, not all sibling nodes in the recovery root.
      const wallet = new Wallet(node.privateKey);
      if (wallet.address !== session.addresses[index]) throw new Error('Node address mismatch.');
      const encrypted = await wallet.encrypt(password, { scrypt: SCRYPT }, progressObserver(onProgress));
      requireSession(session);
      return encrypted;
    } catch {
      throw new Error('Unable to export this node keystore.');
    }
  });
}

export function forgetNodeSession(session: NodeSession): void {
  sessions.delete(session);
}

export function isVerifiedNodeSession(session: NodeSession): boolean {
  return sessions.has(session) && session.backupVerified === true;
}

function requireBridgeNode(session: NodeSession, index: number): { root: Wallet } {
  const state = requireSession(session);
  if (!session.backupVerified || !Number.isInteger(index) || index < 0 || index >= session.addresses.length) {
    throw new Error('Restore and verify the backup before bridging a node.');
  }
  return state;
}

export async function prepareNodeBridge(session: NodeSession, index: number, amountEth: string): Promise<NodeBridgeReview> {
  requireBridgeNode(session, index);
  const { prepareRelayBridge } = await import('./relay-bridge');
  requireBridgeNode(session, index);
  return prepareRelayBridge(session, index, session.addresses[index], amountEth, () => { requireBridgeNode(session, index); });
}

export async function executeNodeBridge(session: NodeSession, review: NodeBridgeReview): Promise<NodeBridgeOperation> {
  requireBridgeNode(session, review.nodeIndex);
  if (session.addresses[review.nodeIndex] !== review.nodeAddress) throw new Error('This bridge review belongs to another node.');
  const { executeRelayBridge } = await import('./relay-bridge');
  requireBridgeNode(session, review.nodeIndex);
  return executeRelayBridge(session, review, () => { requireBridgeNode(session, review.nodeIndex); }, async (transaction) => {
    const state = requireBridgeNode(session, review.nodeIndex);
    const node = utils.HDNode.fromMnemonic(state.root.mnemonic.phrase).derivePath(`${ACCOUNT_PATH}/${review.nodeIndex}`);
    const wallet = new Wallet(node.privateKey);
    if (wallet.address !== review.nodeAddress) throw new Error('Node address mismatch.');
    const signed = await wallet.signTransaction(transaction);
    requireBridgeNode(session, review.nodeIndex);
    return signed;
  });
}

export async function prepareNodeTrade(
  session: NodeSession, index: number, token: string,
  side: import('./pons-trade').NodeTradeSide, amount: import('./pons-trade').NodeTradeAmount,
): Promise<import('./node-trading').NodeTradeReview> {
  requireBridgeNode(session, index);
  const copiedAmount = copyTradeAmount(amount);
  const { prepareTrade } = await import('./node-trading');
  requireBridgeNode(session, index);
  return prepareTrade(session, index, session.addresses[index], token, side, copiedAmount, () => { requireBridgeNode(session, index); });
}

export async function executeNodeTrade(
  session: NodeSession, review: import('./node-trading').NodeTradeReview,
  assertCurrent: () => void = () => {},
): Promise<import('./node-trading').NodeTradeOperation> {
  const assertActive = () => { requireBridgeNode(session, review.nodeIndex); assertCurrent(); };
  assertActive();
  if (session.addresses[review.nodeIndex] !== review.nodeAddress) throw new Error('This trade review belongs to another node.');
  const { executeTrade } = await import('./node-trading');
  assertActive();
  return executeTrade(session, review, assertActive, async (transaction) => {
    assertActive();
    const state = requireBridgeNode(session, review.nodeIndex);
    const node = utils.HDNode.fromMnemonic(state.root.mnemonic.phrase).derivePath(`${ACCOUNT_PATH}/${review.nodeIndex}`);
    const wallet = new Wallet(node.privateKey);
    if (wallet.address !== review.nodeAddress) throw new Error('Node address mismatch.');
    const signed = await wallet.signTransaction(transaction);
    assertActive();
    return signed;
  });
}
