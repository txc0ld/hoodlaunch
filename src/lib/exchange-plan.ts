import { utils } from 'ethers';
export type FundingPlan = { version: 1; id: string; sourceChainId: 1; asset: 'ETH'; createdAt: string; nodes: { index: number; address: string; amountEth: string; withdrawalKey?: string }[] };
export function createFundingPlan(addresses: readonly string[], amountEth: string): FundingPlan {
 if (!addresses.length || addresses.length > 50 || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(amountEth) || !utils.parseEther(amountEth).gt(0)) throw new Error('Enter a positive ETH amount with up to 18 decimal places.');
 const canonical = addresses.map(address => utils.getAddress(address));
 if (canonical.some(a => /^0x0{40}$/i.test(a)) || new Set(canonical.map(a=>a.toLowerCase())).size !== canonical.length) throw new Error('Wallet addresses must be distinct and nonzero.');
 return { version: 1, id: crypto.randomUUID(), sourceChainId: 1, asset: 'ETH', createdAt: new Date().toISOString(), nodes: canonical.map((address,index)=>({index:index+1,address,amountEth})) };
}
