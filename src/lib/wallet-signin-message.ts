import { utils } from 'ethers';
import { HOODRICH_CHAIN_ID } from './pro-access';
export const AUTH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type WalletSignInChallenge = { challengeId: string; address: string; nonce: string; issuedAt: string; notBefore: string; expiresAt: string; message: string };
export function signInMessage(origin: string, input: Omit<WalletSignInChallenge, 'message'>): string {
 const site = new URL(origin);
 if (site.origin !== origin || !AUTH_ID.test(input.challengeId) || !/^[0-9a-f]{32}$/.test(input.nonce) ||
     utils.getAddress(input.address) !== input.address || /^0x0{40}$/.test(input.address)) throw new Error('Invalid wallet sign-in details.');
 const issued = Date.parse(input.issuedAt), expiry = Date.parse(input.expiresAt), before = Date.parse(input.notBefore);
 if (![issued,expiry,before].every(Number.isFinite) || expiry-issued !== 300000 || before!==issued-30000 ||
     [input.issuedAt,input.expiresAt,input.notBefore].some(value => new Date(value).toISOString()!==value)) throw new Error('Invalid wallet sign-in times.');
 return `${site.host} wants you to sign in with your Ethereum account:\n${input.address}\n\nSign in to HOODLABS. This message does not authorize transactions or token approvals.\n\nURI: ${site.origin}/\nVersion: 1\nChain ID: ${HOODRICH_CHAIN_ID}\nNonce: ${input.nonce}\nIssued At: ${input.issuedAt}\nExpiration Time: ${input.expiresAt}\nNot Before: ${input.notBefore}\nRequest ID: ${input.challengeId}`;
}
