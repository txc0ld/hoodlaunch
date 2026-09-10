/** Lightweight signing authority. No SDK imports, storage, permissions or signing. */
export interface WalletProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, callback: () => void): void;
  removeListener?(event: string, callback: () => void): void;
}

export function createWalletRegistry(injected: () => WalletProvider | undefined) {
  let explicit = false;
  let selected: WalletProvider | undefined;
  let bound: WalletProvider | undefined;
  let unbind = () => {};
  let binding = 0;
  let version = 0;
  let selection = 0;
  const listeners = new Set<() => void>();
  const getProvider = () => explicit ? selected : injected();
  const notify = () => { version++; listeners.forEach(listener => listener()); };
  const disconnected = () => { explicit = true; selected = undefined; selection++; bind(); notify(); };
  function bind() {
    const next = listeners.size ? getProvider() : undefined;
    if (bound === next) return;
    unbind();
    bound = next;
    const sequence = ++binding;
    const current = () => bound === next && sequence === binding;
    const changed = () => { if (current()) notify(); };
    const lost = () => { if (current()) disconnected(); };
    next?.on?.('accountsChanged', changed);
    next?.on?.('chainChanged', changed);
    next?.on?.('disconnect', lost);
    unbind = () => {
      next?.removeListener?.('accountsChanged', changed);
      next?.removeListener?.('chainChanged', changed);
      next?.removeListener?.('disconnect', lost);
    };
  }
  return {
    getProvider,
    getVersion: () => version,
    getSelection: () => selection,
    beginSelection() {
      explicit = true; selected = undefined; selection++; bind(); notify();
      return selection;
    },
    select(provider: WalletProvider, ticket: number) {
      if (ticket !== selection || typeof provider?.request !== 'function') return false;
      explicit = true; selected = provider; selection++; bind(); notify(); return true;
    },
    disconnect: disconnected,
    subscribe(listener: () => void) {
      listeners.add(listener); bind();
      return () => { listeners.delete(listener); bind(); };
    },
  };
}

export const walletRegistry = createWalletRegistry(() => {
  if (typeof window === 'undefined') return undefined;
  const provider = (window as unknown as { ethereum?: WalletProvider }).ethereum;
  return typeof provider?.request === 'function' ? provider : undefined;
});
export const getWalletProvider = walletRegistry.getProvider;
export const getWalletVersion = walletRegistry.getVersion;
export const subscribeWalletProvider = walletRegistry.subscribe;
