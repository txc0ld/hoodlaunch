import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './ProAccess.module.css';
import { utils } from 'ethers';
import { EMPTY_PRO_ACCESS, HOODRICH_DECIMALS, HOODRICH_MINIMUM_FORMATTED, HOODRICH_TOKEN, PRO_PRICE_LABEL, type ProAccessState } from '../lib/pro-access';
import { AUTH_INTENT_EVENT, assertClientAuthCurrent, cancelClientAuth, cancelPendingAuth, completeClientAuth, pendingAuthIds, signInWithWallet, startClientAuth } from '../lib/wallet-signin';
import { verifyHolderWallet } from '../lib/holder-wallet';
import { getWalletProvider, getWalletVersion, subscribeWalletProvider } from '../lib/wallet-provider';
type Access = ProAccessState;
const NONE = EMPTY_PRO_ACCESS;
export default function ProAccess({ onAccessChange, onSessionIdentityChange, salesEnabled = false }: { onAccessChange: (value: boolean) => void; salesEnabled?: boolean; onSessionIdentityChange?: (value: string | null) => void }) {
  const [access, setAccess] = useState<Access>(NONE);
  const [email, setEmail] = useState(''); const [code, setCode] = useState('');
  const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('Checking account services…');
  const [unresolvedAuth,setUnresolvedAuth] = useState(false);
  const authIntent=useRef<string|null>(null);
  const [activeAuthId,setActiveAuthId]=useState<string|null>(null);
  const generation = useRef(0);
  const accountMutation = useRef(false);
  const walletGeneration = useRef(0); const mounted = useRef(true); const walletBusy = useRef(false);
  const request = useCallback(async (action: string, data: Record<string, string> = {}, options: {keepalive?:boolean} = {}) => {
    const response = await fetch('/api/account', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...data }), keepalive: options.keepalive === true, signal: AbortSignal.timeout(20000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Account services are unavailable.');
    return result;
  }, []);
  const refresh = useCallback(async () => {
    if (accountMutation.current) return;
    try { if(pendingAuthIds().length) { onSessionIdentityChange?.(null); onAccessChange(false); setAccess(NONE); setUnresolvedAuth(true); return; } } catch(error) { onSessionIdentityChange?.(null); onAccessChange(false); setAccess(NONE); setUnresolvedAuth(true); setMessage(error instanceof Error ? error.message : 'Account storage is unavailable.'); return; }
    const sequence = ++generation.current;
    try {
      const result = await request('status') as Access;
      if (!mounted.current || accountMutation.current || sequence !== generation.current || pendingAuthIds().length) return;
      if (result.signInAvailable !== true) { setSent(false); setCode(''); }
      onSessionIdentityChange?.(result.signedIn === true && typeof result.sessionIdentity === 'string' && /^[a-f0-9]{64}$/.test(result.sessionIdentity) ? result.sessionIdentity : null);
      setAccess(result); onAccessChange(result.pro === true); setMessage(!result.configured ? 'Pro account services are being prepared. Free launch configuration is available below.' : !result.pro && (result.subscriptionUnavailable || result.holder?.unavailable) ? 'Access could not be fully verified. Retry when the service is available.' : '');
    } catch (error) { if (!mounted.current || accountMutation.current || sequence !== generation.current) return; setAccess(NONE); onSessionIdentityChange?.(null); onAccessChange(false); setMessage(error instanceof Error ? error.message : 'Account services are unavailable.'); }
  }, [onAccessChange, onSessionIdentityChange, request]);
  useEffect(() => {
    mounted.current = true;
    const restore = async () => {
      try { if(pendingAuthIds().length) { accountMutation.current=true; setUnresolvedAuth(true); onSessionIdentityChange?.(null); onAccessChange(false); await cancelPendingAuth(request); if(!mounted.current)return; accountMutation.current=false; setUnresolvedAuth(false); } await refresh(); }
      catch { if(mounted.current) { accountMutation.current=true; setUnresolvedAuth(true); setMessage('Sign-in cancellation is not confirmed. Retry cancellation before using account tools.'); } }
    }; void restore();
    const timer = setInterval(() => void refresh(), 60000);
    const focus = () => void refresh();
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const intent = () => { try { if(pendingAuthIds().length) { generation.current++; onSessionIdentityChange?.(null); onAccessChange(false); setAccess(NONE); if(!authIntent.current)setUnresolvedAuth(true); } } catch { generation.current++; onSessionIdentityChange?.(null); onAccessChange(false); setAccess(NONE); setUnresolvedAuth(true); } };
    const hide = () => { walletGeneration.current++; generation.current++; onSessionIdentityChange?.(null); onAccessChange(false); if(authIntent.current)void cancelClientAuth(request,authIntent.current,true).catch(()=>{}); };
    window.addEventListener('pagehide',hide);window.addEventListener('storage',intent);window.addEventListener(AUTH_INTENT_EVENT,intent);
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', visible);
    return () => { window.removeEventListener('pagehide',hide);window.removeEventListener('storage',intent);window.removeEventListener(AUTH_INTENT_EVENT,intent);if(authIntent.current)void cancelClientAuth(request,authIntent.current,true).catch(()=>{}); mounted.current = false; walletGeneration.current++; generation.current++; clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visible); onSessionIdentityChange?.(null); onAccessChange(false); };
  }, [refresh, request, onAccessChange, onSessionIdentityChange]);
  useEffect(() => subscribeWalletProvider(() => { walletGeneration.current++; }), []);
  async function verifyWallet() {
    if (busy || walletBusy.current || !access.signedIn) return;
    const wallet = getWalletProvider();
    if (!wallet?.request) { setMessage('Use Connect at the top of this workspace to select the wallet holding your HOODRICH.'); return; }
    walletBusy.current = true; setBusy(true); setMessage('Approve the wallet ownership message. No transaction or token approval is requested.');
    const sequence = ++walletGeneration.current;
    const version = getWalletVersion();
    const current = () => { if (!mounted.current || sequence !== walletGeneration.current || version !== getWalletVersion() || getWalletProvider() !== wallet) throw new Error('Wallet verification changed or was closed. Start again.'); };
    try { await verifyHolderWallet(wallet, window.location.origin, request, current); await refresh(); }
    catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message.slice(0, 240) : 'Wallet verification failed.'); }
    finally { walletBusy.current = false; if (mounted.current) setBusy(false); }
  }
  async function retryCancellation() {
    accountMutation.current=true; walletGeneration.current++; generation.current++;
    onSessionIdentityChange?.(null); onAccessChange(false); setAccess(NONE); setBusy(true);
    try { if(authIntent.current)await cancelClientAuth(request,authIntent.current);else await cancelPendingAuth(request); if(pendingAuthIds().length)throw new Error('Another sign-in remains unresolved.'); if(!mounted.current)return; authIntent.current=null; setActiveAuthId(null); setUnresolvedAuth(false); accountMutation.current=false; await refresh();setMessage('Sign-in canceled. Dismiss any open wallet prompt.'); }
    catch { if(mounted.current) { setUnresolvedAuth(true); setMessage('Cancellation is still unconfirmed. Retry when your connection is available.'); } }
    finally { if(mounted.current)setBusy(false); }
  }
  async function walletSignIn() {
    if(busy||walletBusy.current||accountMutation.current||access.signedIn)return;
    const wallet=getWalletProvider();if(!wallet?.request){setMessage('Use Connect at the top to select MetaMask or another wallet, then sign in.');return;}
    walletBusy.current=true; accountMutation.current=true; generation.current++; setBusy(true); setUnresolvedAuth(false);
    onSessionIdentityChange?.(null);onAccessChange(false);
    const sequence=++walletGeneration.current,version=getWalletVersion();
    const current=()=>{if(!mounted.current||sequence!==walletGeneration.current||version!==getWalletVersion()||getWalletProvider()!==wallet)throw new Error('Wallet sign-in changed or was closed.');};
    setMessage('Approve the sign-in message. No gas payment or token approval is requested.');
    try { await signInWithWallet(wallet,window.location.origin,request,current,id=>{authIntent.current=id;setActiveAuthId(id);setUnresolvedAuth(false);}); accountMutation.current=false;setUnresolvedAuth(false);await refresh(); }
    catch(error){if(mounted.current){try{if(!pendingAuthIds().length){accountMutation.current=false;await refresh();}}catch{}setMessage(error instanceof Error?error.message.slice(0,240):'Wallet sign-in failed.');}}
    finally { walletBusy.current=false;authIntent.current=null;try{accountMutation.current=pendingAuthIds().length>0;}catch{accountMutation.current=true;} if(mounted.current){setActiveAuthId(null);setUnresolvedAuth(accountMutation.current);setBusy(false);} }
  }
  function holderBalance() {
    try { return access.holder?.balance === null || access.holder?.balance === undefined ? null : utils.formatUnits(access.holder.balance, HOODRICH_DECIMALS); } catch { return null; }
  }
  async function act(action: string) {
    if (busy || walletBusy.current || accountMutation.current) return; accountMutation.current = true; generation.current++; setBusy(true); setMessage('');
    if (action === 'logout') onSessionIdentityChange?.(null);
    if (action === 'logout' || action === 'holder-unlink') { walletGeneration.current++; generation.current++; onAccessChange(false); }
    const accountSequence=walletGeneration.current;
    let attempt:ReturnType<typeof startClientAuth>|undefined;
    try {
      let result;
      if(action==='verify-code') {
        attempt=startClientAuth();authIntent.current=attempt.requestId;setActiveAuthId(attempt.requestId);
        const prepared=await request('auth-prepare');
        if(!mounted.current||accountSequence!==walletGeneration.current||prepared.prepared!==true)throw new Error('Sign-in was closed. Retry cancellation.');
        assertClientAuthCurrent(attempt.requestId);
        result=await request(action,{email,code,...attempt});
        if(!mounted.current||accountSequence!==walletGeneration.current)throw new Error('Sign-in was closed. Retry cancellation.');
        assertClientAuthCurrent(attempt.requestId);
        if(result.signedIn!==true)throw new Error('Account sign-in was not confirmed.');
        completeClientAuth(attempt.requestId);authIntent.current=null;setActiveAuthId(null);setUnresolvedAuth(false);
      } else result=await request(action, { email, code });
      setCode('');
      if (action === 'request-code') { setSent(true); setMessage('Check your email for a sign-in code.'); }
      else if (result.url) {
        const url = new URL(result.url);
        if (url.protocol !== 'https:' || !['checkout.stripe.com', 'billing.stripe.com'].includes(url.hostname)) throw new Error('Invalid billing destination.');
        window.location.assign(url.href);
      } else { if (action === 'logout') { setEmail(''); setSent(false); } accountMutation.current = false; await refresh(); }
    } catch (error) { try { if(attempt)await cancelClientAuth(request,attempt.requestId); } catch { if(mounted.current)setUnresolvedAuth(true); } if(mounted.current){try{if(!pendingAuthIds().length){accountMutation.current=false;await refresh();}}catch{}setMessage(error instanceof Error ? error.message : 'Request failed.');} }
    finally { authIntent.current=null; try{accountMutation.current=pendingAuthIds().length>0;}catch{accountMutation.current=true;} if (mounted.current) { setActiveAuthId(null); setUnresolvedAuth(accountMutation.current); setBusy(false); } }
  }
  return <section id="pro-account" className={styles.panel} aria-labelledby="pro-title">
    <div><p className={styles.label}>HOODLABS PRO · {PRO_PRICE_LABEL}</p><h2 id="pro-title">One launch. Up to 50 wallets.</h2><p>Token launching stays free. Free accounts can create one wallet every 24 hours when wallet creation is available. Pro adds bulk creation of up to 50 wallets and managed uploads. Subscribe for {PRO_PRICE_LABEL} or qualify by holding {HOODRICH_MINIMUM_FORMATTED} HOODRICH ($RICH).</p></div>
    {access.pro ? <p className={styles.active}>Pro active{access.holder?.granted ? ' · wallet grant' : access.holder?.eligible ? ' · HOODRICH holder' : ' · subscription'} · 50 upload attempts per day</p> : <p className={styles.note}>Your wallet keys stay in this browser. Account services never receive your seed phrase, backup password or exchange credentials. Network and protocol fees still apply.</p>}
    {unresolvedAuth && <div role="status"><p>A sign-in attempt needs cancellation before account tools can be used.</p><button disabled={busy} onClick={()=>void retryCancellation()}>Retry cancellation</button></div>}
    {busy && activeAuthId && <button onClick={()=>void retryCancellation()}>Cancel sign-in</button>}
    {access.configured && !access.signedIn && access.walletSignInAvailable === true && !unresolvedAuth && <div className={styles.controls}><button disabled={busy} onClick={()=>void walletSignIn()}>Sign in with wallet</button><p>A wallet account is separate from an email account. Use your original sign-in method for an existing subscription.</p></div>}
    {access.configured && !access.signedIn && access.walletSignInAvailable !== true && access.signInAvailable !== true && <p role="status">Email sign-in is temporarily unavailable. Free launch planning remains available.</p>}
    {access.configured && !access.signedIn && access.signInAvailable === true && !unresolvedAuth && <form onSubmit={event => { event.preventDefault(); void act(sent ? 'verify-code' : 'request-code'); }} className={styles.controls}>
      <label>Email<input type="email" autoComplete="email" value={email} onChange={event => { setEmail(event.target.value); setSent(false); }} required maxLength={254} disabled={busy} /></label>
      {sent && <label>Email code<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value)} pattern="[0-9]{6,8}" required maxLength={8} disabled={busy} /></label>}
      <button disabled={busy}>{busy ? 'Working…' : sent ? 'Sign in' : 'Email me a code'}</button>
    </form>}
    {access.signedIn && <div className={styles.controls}>
      {((!access.holder?.eligible && !access.holder?.granted) || access.subscription) && <button disabled={busy || !access.billing || (!access.subscription && !salesEnabled)} onClick={() => void act(access.subscription ? 'portal' : 'checkout')}>{access.subscription ? 'Manage subscription' : access.billing && salesEnabled ? 'See Pro price & subscribe' : 'Pro subscriptions coming soon'}</button>}
      {access.billingAccount === true && <button disabled={busy || !access.billing} onClick={() => void act('portal')}>Manage billing</button>}
      <button disabled={busy} onClick={() => void act('logout')}>Sign out & lock wallets</button>
    </div>}
    {access.signedIn && access.billingAccountUnavailable === true && <p role="status">Billing account status is temporarily unavailable. Refresh before opening billing history.</p>}
    <div className={styles.holder}>
      <h3>Hold {HOODRICH_MINIMUM_FORMATTED} HOODRICH to unlock Pro</h3>
      <p>Keep at least {HOODRICH_MINIMUM_FORMATTED} $RICH in one wallet on Robinhood Chain. Sign in to your account, then verify that wallet with a message. Tokens stay in your wallet; no transfer, approval or gas payment is needed.</p>
      <p className={styles.note}>Token contract: <a href={'https://robinhoodchain.blockscout.com/token/' + HOODRICH_TOKEN} target="_blank" rel="noopener noreferrer"><code>{HOODRICH_TOKEN}</code></a></p>
      {access.holder?.address && <p>Linked wallet: <code>{access.holder.address}</code>{holderBalance() !== null && <> · Confirmed balance: {holderBalance()} $RICH</>}</p>}
      {access.holder?.granted && <p>This verified wallet has an explicit Pro wallet grant. The grant is separate from subscriptions and token holdings.</p>}
      {access.holder?.unavailable && <p>Token balance verification is temporarily unavailable. An independently verified paid subscription still grants Pro.</p>}
      {access.holder?.verified && !access.holder.eligible && !access.holder.granted && !access.holder.unavailable && <p>This wallet is verified, but its confirmed balance is below {HOODRICH_MINIMUM_FORMATTED} $RICH.</p>}
      {access.signedIn && <div className={styles.controls}>
        <button disabled={busy} onClick={() => void verifyWallet()}>{access.holder?.verified ? 'Verify wallet again' : 'Verify holding wallet'}</button>
        <button disabled={busy} onClick={() => void refresh()}>Refresh Pro access</button>
        <button disabled={busy} onClick={() => void act('holder-unlink')}>Unlink holding wallet</button>
      </div>}
      <p className={styles.note}>A configured wallet grant still requires account sign-in and the Verify holding wallet proof. Standard wallets only; smart contract and delegated wallets are not supported for this proof yet. One wallet can link to one account. Unlink before changing wallets, and verify again after signing in to a new session. Balances are rechecked for managed services and about every minute in this workspace. If you fall below the threshold, holder access ends on the next check. Becoming eligible or receiving a wallet grant does not cancel an existing subscription; manage it separately if you choose.</p>
    </div>
    {message && <p role="status">{message}</p>}
    <p className={styles.note}>Images uploaded to IPFS are public and may remain available permanently. Keep recovery backups offline. <a href="/security" target="_blank" rel="noopener noreferrer">Security & recovery</a></p>
  </section>;
}
