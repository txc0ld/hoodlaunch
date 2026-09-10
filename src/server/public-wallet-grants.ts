const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO = /^0x0{40}$/i;
const MAX_ENTRIES = 100;
const MAX_CONFIG_LENGTH = 5000;

/** Server-only exact-address grant. Invalid configuration fails closed as a whole. */
export function isPublicWalletGranted(address: unknown): boolean {
  if (typeof address !== 'string' || !ADDRESS.test(address) || ZERO.test(address)) return false;
  const configured = process.env.PRO_WALLET_ALLOWLIST;
  if (!configured || configured.length > MAX_CONFIG_LENGTH) return false;
  const entries = configured.split(',');
  if (entries.length > MAX_ENTRIES) return false;
  const normalized: string[] = [];
  for (const value of entries) {
    const entry = value.trim();
    if (!ADDRESS.test(entry) || ZERO.test(entry)) return false;
    normalized.push(entry.toLowerCase());
  }
  return normalized.includes(address.toLowerCase());
}
