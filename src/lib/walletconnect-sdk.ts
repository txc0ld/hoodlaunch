/** Imported dynamically only after Connect. Never import this module from signing/core code. */
import { createAppKit, type AppKit } from '@reown/appkit';
import UniversalProvider from '@walletconnect/universal-provider';
import { Ethers5Adapter } from '@reown/appkit-adapter-ethers5';
import { defineChain } from '@reown/appkit/networks';
import { PONS_CHAIN_ID, PONS_EXPLORER, PONS_RPC } from './pons';
import { walletRegistry, type WalletProvider } from './wallet-provider';

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
let kitPromise: Promise<AppKit> | undefined;
let kit: AppKit | undefined;
let cancelPending: (() => void) | undefined;
const robinhood = defineChain({ id: PONS_CHAIN_ID, chainNamespace: 'eip155', caipNetworkId: 'eip155:4663', name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [PONS_RPC] } }, blockExplorers: { default: { name: 'Blockscout', url: PONS_EXPLORER } } });
const ethereum = defineChain({ id: 1, chainNamespace: 'eip155', caipNetworkId: 'eip155:1', name: 'Ethereum', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://ethereum.publicnode.com'] } }, blockExplorers: { default: { name: 'Etherscan', url: 'https://etherscan.io' } } });

async function getKit(): Promise<AppKit> {
  if (!kitPromise) kitPromise = (async () => {
    if (typeof window === 'undefined' || !projectId || !/^[a-f0-9]{32}$/i.test(projectId)) throw new Error('WalletConnect is not configured.');
    // Origin only: never forward preview bypasses, query parameters, or fragments.
    const origin = window.location.origin;
    if (window.location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(window.location.hostname)) throw new Error('WalletConnect requires a secure browser.');
    const metadata = { name: 'HOODLABS', description: 'Connect your wallet to HOODLABS', url: origin, icons: [`${origin}/favicon.ico`] };
    const universalProvider = await UniversalProvider.init({ projectId, metadata, logger: 'silent', telemetryEnabled: false });
    kit = createAppKit({
      universalProvider,
      adapters: [new Ethers5Adapter()], projectId, networks: [robinhood, ethereum], defaultNetwork: ethereum,
      metadata,
      enableReconnect: false, enableEmbedded: false, enableCoinbase: false, enableBaseAccount: false,
      enableInjected: true, enableEIP6963: true, enableWalletConnect: true,
      enableWalletGuide: false, enableMobileFullScreen: true, allowUnsupportedChain: true,
      features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, send: false, receive: false, history: false, pay: false, smartSessions: false, reownAuthentication: false, connectMethodsOrder: ['wallet'] },
      themeMode: 'dark', themeVariables: { '--w3m-accent': '#ccff66', '--w3m-border-radius-master': '2px', '--w3m-font-family': 'Arial, sans-serif', '--w3m-z-index': 2000 },
    });
    await kit.ready();
    let previous: unknown;
    kit.subscribeProviders(providers => {
      const selected = walletRegistry.getProvider();
      // SDK changes may invalidate authority, but can never install a replacement signer.
      if (previous && selected === previous && providers.eip155 !== previous) walletRegistry.disconnect();
      previous = providers.eip155;
    });
    return kit;
  })().catch(error => { kitPromise = undefined; kit = undefined; throw error; });
  return kitPromise;
}

function resetPairing(app: AppKit) {
  const ticket = walletRegistry.getSelection();
  app.resetWalletConnectUri(); app.resetConnectingWallet();
  void app.getUniversalProvider().then(provider => { if (walletRegistry.getSelection() === ticket) provider?.abortPairingAttempt(); }).catch(() => {});
}
export function cancelWalletSelector() { cancelPending?.(); }
export async function disconnectWalletConnect() {
  cancelPending?.();
  if (kit) { resetPairing(kit); await kit.close(); await kit.disconnect('eip155'); }
}

export function openWalletSelector(ticket: number): Promise<WalletProvider> {
  cancelPending?.();
  return new Promise((resolve, reject) => {
    let settled = false;
    let app: AppKit | undefined;
    let wasOpen = false;
    const unsubscribe: (() => void)[] = [];
    const finish = (provider?: WalletProvider, message = 'Wallet connection canceled. You can try again.') => {
      if (settled) return;
      settled = true; clearTimeout(timer); unsubscribe.forEach(fn => { try { fn(); } catch {} });
      if (cancelPending === cancel) cancelPending = undefined;
      if (app) { try { if (!provider) resetPairing(app); void app.close().catch(() => {}); } catch {} }
      if (provider && walletRegistry.getSelection() === ticket) resolve(provider);
      else reject(new Error(message));
    };
    const cancel = () => finish();
    cancelPending = cancel;
    const timer = setTimeout(() => finish(undefined, 'Wallet connection timed out. Close the request in your wallet and try again.'), 120000);
    void getKit().then(async value => {
      if (settled || walletRegistry.getSelection() !== ticket) { finish(); return; }
      app = value;
      if (app.getAccount('eip155')?.isConnected) await app.disconnect('eip155');
      if (settled || walletRegistry.getSelection() !== ticket) { finish(); return; }
      const connected = () => {
        const provider = app?.getWalletProvider() as WalletProvider | undefined;
        if (app?.getAccount('eip155')?.isConnected && typeof provider?.request === 'function') finish(provider);
      };
      unsubscribe.push(app.subscribeProviders(connected), app.subscribeAccount(connected, 'eip155'));
      unsubscribe.push(app.subscribeState(state => {
        if (state.open) wasOpen = true;
        else if (wasOpen) { connected(); if (!settled) finish(); }
      }));
      await app.open({ view: 'Connect', namespace: 'eip155' });
      if (!settled) connected();
    }).catch(() => finish(undefined, 'WalletConnect is unavailable. Retry or use a browser wallet.'));
  });
}
