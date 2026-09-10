import { useEffect, useRef, useState } from 'react';
import { walletRegistry, type WalletProvider } from '../lib/wallet-provider';
import { boundedWalletRequest, confirmWalletCandidate, discardWalletCandidate, prepareWalletCandidate, type WalletCandidate } from '../lib/wallet-connection';
import { hasInjectedWallet } from '../lib/mobile-wallet';
import styles from './MobileWalletConnect.module.css';

const configured = /^[a-f0-9]{32}$/i.test(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '');
export default function WalletConnection({ onClose, onConnected, onMobileFallback }: { onClose: () => void; onConnected: () => void; onMobileFallback: () => void }) {
  const [candidate, setCandidate] = useState<WalletCandidate>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [selecting, setSelecting] = useState(configured);
  const dialog = useRef<HTMLDialogElement>(null);
  const live = useRef(true);
  const operation = useRef(0);
  const pending = useRef<WalletCandidate | undefined>(undefined);
  const cancelSdk = useRef<(() => void) | undefined>(undefined);
  const ticket = useRef<number>(0);

  async function showCandidate(provider: WalletProvider, sequence: number) {
    const result = await prepareWalletCandidate(provider, ticket.current);
    if (!live.current || operation.current !== sequence) { discardWalletCandidate(result); return; }
    pending.current = result; setCandidate(result); setSelecting(false);
  }
  async function startSdk() {
    if (busy) return;
    const sequence = ++operation.current;
    ticket.current = walletRegistry.beginSelection();
    setSelecting(true); setMessage('');
    try {
      const sdk = await boundedWalletRequest(import('../lib/walletconnect-sdk'));
      if (!live.current || sequence !== operation.current) return;
      cancelSdk.current = sdk.cancelWalletSelector;
      await showCandidate(await sdk.openWalletSelector(ticket.current), sequence);
    } catch (error) {
      if (live.current && sequence === operation.current) { setSelecting(false); setMessage(error instanceof Error ? error.message : 'WalletConnect is unavailable. Try a browser wallet.'); }
    }
  }
  useEffect(() => {
    live.current = true;
    if (configured) void startSdk();
    else { ticket.current = walletRegistry.beginSelection(); setMessage('WalletConnect is not configured here. Use a browser wallet or open HOODLABS in MetaMask.'); }
    return () => {
      live.current = false; operation.current++; cancelSdk.current?.();
      if (pending.current) discardWalletCandidate(pending.current);
    };
  // One explicit connection flow per mounted dialog.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!selecting && !dialog.current?.open) dialog.current?.showModal();
    else if (selecting && dialog.current?.open) dialog.current?.close();
  }, [selecting]);
  function close() {
    operation.current++; cancelSdk.current?.();
    if (walletRegistry.getSelection() === ticket.current) walletRegistry.disconnect();
    onClose();
  }
  async function browserWallet() {
    if (busy) return;
    if (!hasInjectedWallet()) { onMobileFallback(); return; }
    const sequence = ++operation.current;
    ticket.current = walletRegistry.beginSelection();
    setBusy(true); setMessage('Approve the connection in your browser wallet.');
    const provider = (window as unknown as { ethereum: WalletProvider }).ethereum;
    try {
      await boundedWalletRequest(provider.request({ method: 'eth_requestAccounts' }));
      if (live.current && sequence === operation.current) await showCandidate(provider, sequence);
    } catch { if (live.current && sequence === operation.current) setMessage('Browser wallet connection failed or was canceled. Close any pending request and try again.'); }
    finally { if (live.current && sequence === operation.current) setBusy(false); }
  }
  async function confirm() {
    if (!candidate || busy) return;
    setBusy(true); setMessage('');
    try { await confirmWalletCandidate(candidate); if (live.current) { pending.current = undefined; onConnected(); } }
    catch (error) { if (live.current) { setCandidate(undefined); setMessage(error instanceof Error ? error.message : 'Wallet selection failed.'); } }
    finally { if (live.current) setBusy(false); }
  }
  return <>
    {selecting && <p role="status">Choose a wallet or scan the WalletConnect QR. <button className={styles.primary} type="button" onClick={close}>Cancel connection</button></p>}
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="wallet-selection-title" onCancel={event => { event.preventDefault(); close(); }}>
      <button className={styles.close} type="button" onClick={close} aria-label="Cancel wallet selection">×</button>
      <p className={styles.eyebrow}>CONNECT WALLET</p>
      <h2 id="wallet-selection-title">{candidate ? 'Use this wallet?' : 'Choose how to connect'}</h2>
      {candidate ? <>
        <p>Confirm the account to use for this workspace.</p>
        <p className={styles.manual}><code>{candidate.account}</code></p>
        <p>Network: {candidate.chainId === 4663 ? 'Robinhood Chain' : candidate.chainId === 1 ? 'Ethereum' : 'Unsupported network'} ({candidate.chainId})</p>
        {candidate.chainId !== 4663 && <p>Switch to Robinhood Chain (4663) after connecting to launch or verify holdings. Your wallet must support this network.</p>}
        <p className={styles.note}>Connecting does not sign a message, approve tokens or send a transaction.</p>
        <button className={styles.primary} type="button" disabled={busy} onClick={() => void confirm()}>{busy ? 'Checking wallet…' : 'Use this wallet'}</button>
      </> : <>
        <p>WalletConnect works with mobile wallet apps and desktop QR. A browser wallet is also available.</p>
        {configured && <button className={styles.primary} type="button" disabled={busy} onClick={() => void startSdk()}>Retry WalletConnect</button>}
        <div className={styles.actions}><button type="button" disabled={busy} onClick={() => void browserWallet()}>Use browser wallet</button><button type="button" disabled={busy} onClick={onMobileFallback}>Open MetaMask instructions</button></div>
      </>}
      {message && <p className={styles.error} role="status">{message}</p>}
      <div className={styles.actions}><button type="button" onClick={close}>Cancel</button></div>
    </dialog>
  </>;
}
