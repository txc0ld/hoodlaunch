import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './ProAccess.module.css';
import { utils } from 'ethers';
import { EMPTY_PRO_ACCESS, HOODRICH_DECIMALS, HOODRICH_TOKEN, type ProAccessState } from '../lib/pro-access';
import { verifyHolderWallet, type HolderWallet } from '../lib/holder-wallet';
type Access = ProAccessState;
const NONE = EMPTY_PRO_ACCESS;
export default function ProAccess({ onAccessChange, salesEnabled = false }: { onAccessChange: (value: boolean) => void; salesEnabled?: boolean }) {
  const [access, setAccess] = useState<Access>(NONE);
  const [email, setEmail] = useState(''); const [code, setCode] = useState('');
  const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('Checking account services…');
  const generation = useRef(0);
  const accountMutation = useRef(false);
  const walletGeneration = useRef(0); const mounted = useRef(true); const walletBusy = useRef(false);
  const request = useCallback(async (action: string, data: Record<string, string> = {}) => {
    const response = await fetch('/api/account', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...data }), signal: AbortSignal.timeout(20000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Account services are unavailable.');
    return result;
  }, []);
  const refresh = useCallback(async () => {
    if (accountMutation.current) return;
    const sequence = ++generation.current;
    try {
      const result = await request('status') as Access;
      if (!mounted.current || accountMutation.current || sequence !== generation.current) return;
      setAccess(result); onAccessChange(result.pro === true); setMessage(!result.configured ? 'Pro account services are being prepared. Free launch configuration is available below.' : !result.pro && (result.subscriptionUnavailable || result.holder?.unavailable) ? 'Access could not be fully verified. Retry when the service is available.' : '');
    } catch (error) { if (!mounted.current || accountMutation.current || sequence !== generation.current) return; setAccess(NONE); onAccessChange(false); setMessage(error instanceof Error ? error.message : 'Account services are unavailable.'); }
  }, [onAccessChange, request]);
  useEffect(() => { mounted.current = true; void refresh(); const timer = setInterval(() => void refresh(), 60000); const focus = () => void refresh(); window.addEventListener('focus', focus); return () => { mounted.current = false; walletGeneration.current++; generation.current++; clearInterval(timer); window.removeEventListener('focus', focus); onAccessChange(false); }; }, [refresh, onAccessChange]);
  useEffect(() => {
    const wallet = (window as unknown as { ethereum?: HolderWallet }).ethereum;
    const changed = () => { walletGeneration.current++; };
    wallet?.on?.('accountsChanged', changed); wallet?.on?.('chainChanged', changed); wallet?.on?.('disconnect', changed);
    return () => { changed(); wallet?.removeListener?.('accountsChanged', changed); wallet?.removeListener?.('chainChanged', changed); wallet?.removeListener?.('disconnect', changed); };
  }, []);
  async function verifyWallet() {
    if (busy || walletBusy.current || !access.signedIn) return;
    const wallet = (window as unknown as { ethereum?: HolderWallet }).ethereum;
    if (!wallet?.request) { setMessage('Open a browser wallet to verify your HOODRICH holdings.'); return; }
    walletBusy.current = true; setBusy(true); setMessage('Approve the wallet ownership message. No transaction or token approval is requested.');
    const sequence = ++walletGeneration.current;
    const current = () => { if (!mounted.current || sequence !== walletGeneration.current || (window as unknown as { ethereum?: HolderWallet }).ethereum !== wallet) throw new Error('Wallet verification changed or was closed. Start again.'); };
    try { await verifyHolderWallet(wallet, window.location.origin, request, current); await refresh(); }
    catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message.slice(0, 240) : 'Wallet verification failed.'); }
    finally { walletBusy.current = false; if (mounted.current) setBusy(false); }
  }
  function holderBalance() {
    try { return access.holder?.balance === null || access.holder?.balance === undefined ? null : utils.formatUnits(access.holder.balance, HOODRICH_DECIMALS); } catch { return null; }
  }
  async function act(action: string) {
    if (busy || walletBusy.current || accountMutation.current) return; accountMutation.current = true; generation.current++; setBusy(true); setMessage('');
    if (action === 'logout' || action === 'holder-unlink') { walletGeneration.current++; generation.current++; onAccessChange(false); }
    try {
      const result = await request(action, { email, code }); setCode('');
      if (action === 'request-code') { setSent(true); setMessage('Check your email for a sign-in code.'); }
      else if (result.url) {
        const url = new URL(result.url);
        if (url.protocol !== 'https:' || !['checkout.stripe.com', 'billing.stripe.com'].includes(url.hostname)) throw new Error('Invalid billing destination.');
        window.location.assign(url.href);
      } else { if (action === 'logout') { setEmail(''); setSent(false); } accountMutation.current = false; await refresh(); }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Request failed.'); }
    finally { accountMutation.current = false; if (mounted.current) setBusy(false); }
  }
  return <section className={styles.panel} aria-labelledby="pro-title">
    <div><p className={styles.label}>HOODLABS PRO</p><h2 id="pro-title">One launch. Up to 50 wallets.</h2><p>Free token launching. Unlock the Pro wallet workspace and managed uploads with a subscription or by holding 500,000 HOODRICH ($RICH).</p></div>
    {access.pro ? <p className={styles.active}>Pro active{access.holder?.eligible ? ' · HOODRICH holder' : ' · subscription'} · 50 upload attempts per day</p> : <p className={styles.note}>Your wallet keys stay in this browser. Account services never receive your seed phrase, backup password or exchange credentials. Network and protocol fees still apply.</p>}
    {access.configured && !access.signedIn && <form onSubmit={event => { event.preventDefault(); void act(sent ? 'verify-code' : 'request-code'); }} className={styles.controls}>
      <label>Email<input type="email" autoComplete="email" value={email} onChange={event => { setEmail(event.target.value); setSent(false); }} required maxLength={254} disabled={busy} /></label>
      {sent && <label>Email code<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value)} pattern="[0-9]{6,8}" required maxLength={8} disabled={busy} /></label>}
      <button disabled={busy}>{busy ? 'Working…' : sent ? 'Sign in' : 'Email me a code'}</button>
    </form>}
    {access.signedIn && <div className={styles.controls}>
      {(!access.holder?.eligible || access.subscription) && <button disabled={busy || !access.billing || (!access.subscription && !salesEnabled)} onClick={() => void act(access.subscription ? 'portal' : 'checkout')}>{access.subscription ? 'Manage subscription' : access.billing && salesEnabled ? 'See Pro price & subscribe' : 'Pro subscriptions coming soon'}</button>}
      <button disabled={busy || !access.billing} onClick={() => void act('portal')}>Manage billing</button>
      <button disabled={busy} onClick={() => void act('logout')}>Sign out & lock wallets</button>
    </div>}
    <div className={styles.holder}>
      <h3>Hold 500,000 HOODRICH to unlock Pro</h3>
      <p>Keep at least 500,000 $RICH in one wallet on Robinhood Chain. Sign in by email, then verify that wallet with a message. Tokens stay in your wallet; no transfer, approval or gas payment is needed.</p>
      <p className={styles.note}>Token contract: <a href={'https://robinhoodchain.blockscout.com/token/' + HOODRICH_TOKEN} target="_blank" rel="noopener noreferrer"><code>{HOODRICH_TOKEN}</code></a></p>
      {access.holder?.address && <p>Linked wallet: <code>{access.holder.address}</code>{holderBalance() !== null && <> · Confirmed balance: {holderBalance()} $RICH</>}</p>}
      {access.holder?.unavailable && <p>Token balance verification is temporarily unavailable. An independently verified paid subscription still grants Pro.</p>}
      {access.holder?.verified && !access.holder.eligible && !access.holder.unavailable && <p>This wallet is verified, but its confirmed balance is below 500,000 $RICH.</p>}
      {access.signedIn && <div className={styles.controls}>
        <button disabled={busy} onClick={() => void verifyWallet()}>{access.holder?.verified ? 'Verify wallet again' : 'Verify holding wallet'}</button>
        <button disabled={busy} onClick={() => void refresh()}>Refresh Pro access</button>
        <button disabled={busy} onClick={() => void act('holder-unlink')}>Unlink holding wallet</button>
      </div>}
      <p className={styles.note}>Standard wallets only; smart contract and delegated wallets are not supported for this proof yet. One wallet can link to one account. Unlink before changing wallets, and verify again after signing in to a new session. Balances are rechecked for managed services and about every minute in this workspace. If you fall below the threshold, holder access ends on the next check. Becoming eligible does not cancel an existing subscription; manage it separately if you choose.</p>
    </div>
    {message && <p role="status">{message}</p>}
    <p className={styles.note}>Images uploaded to IPFS are public and may remain available permanently. Keep recovery backups offline. <a href="/security" target="_blank" rel="noopener noreferrer">Security & recovery</a></p>
  </section>;
}
