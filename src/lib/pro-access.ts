/** Public display constants. Entitlement is checked independently on the server. */
export const HOODRICH_TOKEN = '0x6d5dc12131b2ad8748C54aB1Ac1b1a2cC53c2118';
export const HOODRICH_CHAIN_ID = 4663;
export const HOODRICH_DECIMALS = 18;
export const PRO_PRICE_LABEL = 'US$15/month';
export const HOODRICH_MINIMUM = '666666';
export const HOODRICH_MINIMUM_FORMATTED = '666,666';
export const HOODRICH_MINIMUM_UNITS = '666666000000000000000000';
export type HolderAccess = {
  address: string | null;
  verified: boolean;
  eligible: boolean;
  granted: boolean;
  /** Exact token balance in smallest units; never a floating-point amount. */
  balance: string | null;
  unavailable: boolean;
};
export type ProStatus = { pro: boolean; subscription: boolean; subscriptionUnavailable: boolean; holder: HolderAccess };
export type ProAccessState = ProStatus & { sessionIdentity: string | null; configured: boolean; signInAvailable: boolean; signedIn: boolean; billing: boolean; billingAccount: boolean; billingAccountUnavailable: boolean };
export const EMPTY_HOLDER_ACCESS: HolderAccess = { address: null, verified: false, eligible: false, granted: false, balance: null, unavailable: false };
export const EMPTY_PRO_ACCESS: ProAccessState = { sessionIdentity: null, configured: false, signInAvailable: false, signedIn: false, pro: false, billing: false, billingAccount: false, billingAccountUnavailable: false, subscription: false, subscriptionUnavailable: false, holder: EMPTY_HOLDER_ACCESS };
export type HolderChallenge = { challengeId: string; message: string; address: string; chainId: number };
