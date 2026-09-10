export const HOODLABS_URL = "https://labs.hoodrich.rip/";
export const METAMASK_DAPP_URL = "https://metamask.app.link/dapp/labs.hoodrich.rip/";

type InjectedProviderCandidate = { request?: unknown } | null | undefined;

export function hasInjectedWallet(candidate?: InjectedProviderCandidate): boolean {
  const provider = candidate === undefined && typeof window !== "undefined"
    ? (window as unknown as { ethereum?: InjectedProviderCandidate }).ethereum
    : candidate;
  return typeof provider?.request === "function";
}
