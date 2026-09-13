import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './ProAccess.module.css';
import { utils } from 'ethers';
import { EMPTY_PRO_ACCESS, HOODRICH_DECIMALS, HOODRICH_MINIMUM_FORMATTED, HOODRICH_TOKEN, type ProAccessState } from '../lib/pro-access';
import { AUTH_INTENT_EVENT, assertClientAuthCurrent, cancelClientAuth, cancelPendingAuth, completeClientAuth, pendingAuthIds, signInWithWallet, startClientAuth } from '../lib/wallet-signin';
import { verifyHolderWallet } from '../lib/holder-wallet';
import { getWalletProvider, getWalletVersion, subscribeWalletProvider } from '../lib/wallet-provider';
import { setNodeAccountAccess } from '../lib/node-vault';
type Access = ProAccessState;
const NONE = EMPTY_PRO_ACCESS;
class AccountRequestError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly unavailable = retryable) {
    super(message);
    this.name = 'AccountRequestError';
  }
}
function retryableStatusFailure(error: unknown) {
  return error instanceof AccountRequestError && error.retryable;
}
function terminalTransportFailure(error: unknown, signal: AbortSignal) {
  return signal.aborted || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name));
}
function validAccountStatus(value: unknown): value is Access {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  if (!['configured','signInAvailable','walletSignInAvailable','signedIn','pro','billing','billingAccount','billingAccountUnavailable','subscription','subscriptionUnavailable'].every(key => typeof r[key] === 'boolean')) return false;
  if (r.signedIn ? typeof r.sessionIdentity !== 'string' || !/^[a-f0-9]{64}$/.test(r.sessionIdentity) : r.sessionIdentity !== null) return false;
  if (r.pro && (!r.signedIn || !r.configured)) return false;
  if (!r.holder || typeof r.holder !== 'object') return false;
  const holder = r.holder as Record<string, unknown>;
  return ['verified','eligible','granted','unavailable'].every(key => typeof holder[key] === 'boolean');
}
function unavailableStatusFailure(error: unknown, signal: AbortSignal): boolean {
  return error instanceof SyntaxError ? false : error instanceof AccountRequestError ? error.unavailable : signal.aborted || (error instanceof Error && ['TimeoutError','AbortError'].includes(error.name));
}
export default function ProAccess({ onAccessChange, onSessionIdentityChange, onAccountReadinessChange, salesEnabled = false }: { onAccessChange: (value: boolean) => void; salesEnabled?: boolean; onSessionIdentityChange?: (value: string | null) => void; onAccountReadinessChange?: (value: boolean) => void }) {
  const [access, setAccess] = useState<Access>(NONE);
  const [email, setEmail] = useState(''); const [code, setCode] = useState('');
  const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('Checking account services…');
  const [unresolvedAuth,setUnresolvedAuth] = useState(false);
  const authIntent=useRef<string|null>(null);
  const [activeAuthId,setActiveAuthId]=useState<string|null>(null);
  const generation = useRef(0);
  const [accountReady, setAccountReady] = useState(false);
  const lastVerified = useRef<Access | null>(null);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const revokeAccess = useCallback(() => {
    setNodeAccountAccess(null, false, false);
    lastVerified.current = null; setAccountReady(false); onAccountReadinessChange?.(false);
    onSessionIdentityChange?.(null); onAccessChange(false); setAccess(NONE);
  }, [onAccessChange, onSessionIdentityChange, onAccountReadinessChange]);
  const pauseAccess = useCallback(() => {
    const previous = lastVerified.current;
    setNodeAccountAccess(previous?.sessionIdentity ?? null, previous?.pro === true, false);
    setAccountReady(false); onAccountReadinessChange?.(false);
  }, [onAccountReadinessChange]);
  const accountMutation = useRef(false);
  const walletGeneration = useRef(0); const mounted = useRef(true); const walletBusy = useRef(false);
  const request = useCallback(async (action: string, data: Record<string, string> = {}, options: {keepalive?:boolean;signal?:AbortSignal} = {}) => {
    const signal = options.signal || AbortSignal.timeout(20000);
    let response: Response;
    try {
      response = await fetch('/api/account', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...data }), keepalive: options.keepalive === true, signal });
    } catch (error) {
      if (terminalTransportFailure(error, signal)) throw error;
      throw new AccountRequestError(error instanceof Error ? error.message : 'Account services are unavailable.', true);
    }
    if (response.ok) {
      try { return await response.json(); }
      catch (error) {
        if (terminalTransportFailure(error, signal) || error instanceof SyntaxError) throw error;
        if (error instanceof TypeError) throw new AccountRequestError(error.message, true);
        throw error;
      }
    }
    let message = 'Account services are unavailable.';
    try {
      const result = await response.json() as { error?: unknown };
      if (typeof result?.error === 'string' && result.error) message = result.error;
    } catch { /* HTTP status determines retry safety when an intermediary returns a non-JSON error. */ }
    throw new AccountRequestError(message, response.status === 408 || response.status === 425 || response.status >= 500, response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500);
  }, []);
  const refresh = useCallback((): Promise<void> => {
    if (accountMutation.current) return Promise.resolve();
    if (refreshInFlight.current) return refreshInFlight.current;
    const pending = (async () => {
      try { if (pendingAuthIds().length) { revokeAccess(); setUnresolvedAuth(true); return; } }
      catch (error) { revokeAccess(); setUnresolvedAuth(true); setMessage(error instanceof Error ? error.message : 'Account storage is unavailable.'); return; }
      const sequence = ++generation.current;
      const current = () => mounted.current && !accountMutation.current && sequence === generation.current;
      const signal = AbortSignal.timeout(20000);
      try {
        let result: unknown;
        try { result = await request('status', {}, { signal }); }
        catch (error) {
          if (!current()) return;
          if (unavailableStatusFailure(error, signal)) pauseAccess();
          if (!retryableStatusFailure(error) || signal.aborted) throw error;
          result = await request('status', {}, { signal });
        }
        if (!current()) return;
        if (pendingAuthIds().length) { revokeAccess(); setUnresolvedAuth(true); return; }
        if (!validAccountStatus(result)) throw new AccountRequestError('Account status could not be validated. Sign in again.', false);
        if (result.signInAvailable !== true) { setSent(false); setCode(''); }
        // Update the financial guard before React can render account availability.
        setNodeAccountAccess(result.sessionIdentity, result.pro, true);
        lastVerified.current = result;
        onSessionIdentityChange?.(result.sessionIdentity); setAccess(result); onAccessChange(result.pro);
        setAccountReady(true); onAccountReadinessChange?.(true);
        setMessage(!result.configured ? 'Pro account services are being prepared. Free launch configuration is available below.' : !result.pro && (result.subscriptionUnavailable || result.holder?.unavailable) ? 'Access could not be fully verified. Retry when the service is available.' : '');
      } catch (error) {
        if (!current()) return;
        if (unavailableStatusFailure(error, signal)) {
          pauseAccess(); setMessage('Account verification is temporarily unavailable. Your loaded wallets are retained, and financial actions are paused. Retry account verification.');
        } else { revokeAccess(); setMessage(error instanceof Error ? error.message : 'Account services are unavailable.'); }
      }
    })();
    refreshInFlight.current = pending;
    const clear = () => { if (refreshInFlight.current === pending) refreshInFlight.current = null; };
    void pending.then(clear, clear); return pending;
  }, [onAccessChange, onSessionIdentityChange, onAccountReadinessChange, pauseAccess, revokeAccess, request]);
  useEffect(() => {
    mounted.current = true;
    const restore = async () => {
      try { if(pendingAuthIds().length) { accountMutation.current=true; setUnresolvedAuth(true); revokeAccess(); await cancelPendingAuth(request); if(!mounted.current)return; accountMutation.current=false; setUnresolvedAuth(false); } await refresh(); }
      catch { if(mounted.current) { accountMutation.current=true; setUnresolvedAuth(true); setMessage('Sign-in cancellation is not confirmed. Retry cancellation before using account tools.'); } }
    }; void restore();
    const timer = setInterval(() => void refresh(), 60000);
    const focus = () => void refresh();
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const intent = () => { try { if(pendingAuthIds().length) { generation.current++; refreshInFlight.current = null; revokeAccess(); setAccess(NONE); if(!authIntent.current)setUnresolvedAuth(true); } } catch { generation.current++; refreshInFlight.current = null; revokeAccess(); setAccess(NONE); setUnresolvedAuth(true); } };
    const hide = () => { walletGeneration.current++; generation.current++; refreshInFlight.current = null; revokeAccess(); if(authIntent.current)void cancelClientAuth(request,authIntent.current,true).catch(()=>{}); };
    window.addEventListener('pagehide',hide);window.addEventListener('storage',intent);window.addEventListener(AUTH_INTENT_EVENT,intent);
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', visible);
    return () => { window.removeEventListener('pagehide',hide);window.removeEventListener('storage',intent);window.removeEventListener(AUTH_INTENT_EVENT,intent);if(authIntent.current)void cancelClientAuth(request,authIntent.current,true).catch(()=>{}); mounted.current = false; walletGeneration.current++; generation.current++; refreshInFlight.current = null; clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visible); revokeAccess(); };
  }, [refresh, request, revokeAccess]);
  useEffect(() => subscribeWalletProvider(() => { walletGeneration.current++; }), []);
  async function verifyWallet() {
    if (busy || walletBusy.current || !accountReady || !access.signedIn) return;
    const wallet = getWalletProvider();
    if (!wallet?.request) { setMessage('Use Connect at the top of this workspace to select the wallet holding your HOODRICH.'); return; }
    accountMutation.current = true; generation.current++; refreshInFlight.current = null; revokeAccess();
    walletBusy.current = true; setBusy(true); setMessage('Approve the wallet ownership message. No transaction or token approval is requested.');
    const sequence = ++walletGeneration.current;
    const version = getWalletVersion();
    const current = () => { if (!mounted.current || sequence !== walletGeneration.current || version !== getWalletVersion() || getWalletProvider() !== wallet) throw new Error('Wallet verification changed or was closed. Start again.'); };
    try { await verifyHolderWallet(wallet, window.location.origin, request, current); accountMutation.current = false; await refresh(); }
    catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message.slice(0, 240) : 'Wallet verification failed.'); }
    finally { accountMutation.current = false; walletBusy.current = false; if (mounted.current) setBusy(false); }
  }
  async function retryCancellation() {
    accountMutation.current=true; walletGeneration.current++; generation.current++; refreshInFlight.current = null;
    revokeAccess(); setAccess(NONE); setBusy(true);
    try { if(authIntent.current)await cancelClientAuth(request,authIntent.current);else await cancelPendingAuth(request); if(pendingAuthIds().length)throw new Error('Another sign-in remains unresolved.'); if(!mounted.current)return; authIntent.current=null; setActiveAuthId(null); setUnresolvedAuth(false); accountMutation.current=false; await refresh();setMessage('Sign-in canceled. Dismiss any open wallet prompt.'); }
    catch { if(mounted.current) { setUnresolvedAuth(true); setMessage('Cancellation is still unconfirmed. Retry when your connection is available.'); } }
    finally { if(mounted.current)setBusy(false); }
  }
  async function walletSignIn() {
    if(busy||walletBusy.current||accountMutation.current||access.signedIn)return;
    const wallet=getWalletProvider();if(!wallet?.request){setMessage('Use Connect at the top to select MetaMask or another wallet, then sign in.');return;}
    walletBusy.current=true; accountMutation.current=true; generation.current++; refreshInFlight.current = null; setBusy(true); setUnresolvedAuth(false);
    revokeAccess();
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
    if (busy || walletBusy.current || accountMutation.current || (!accountReady && action !== 'logout')) return; accountMutation.current = true; generation.current++; refreshInFlight.current = null; setBusy(true); setMessage(''); revokeAccess();
    if (action === 'logout') onSessionIdentityChange?.(null);
    if (action === 'logout' || action === 'holder-unlink') { walletGeneration.current++; generation.current++; refreshInFlight.current = null; onAccessChange(false); }
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
      if (action === 'request-code') { accountMutation.current = false; await refresh(); setSent(true); setMessage('Check your email for a sign-in code.'); }
      else if (result.url) {
        const url = new URL(result.url);
        if (url.protocol !== 'https:' || !['checkout.stripe.com', 'billing.stripe.com'].includes(url.hostname)) throw new Error('Invalid billing destination.');
        window.location.assign(url.href);
      } else { if (action === 'logout') { setEmail(''); setSent(false); } accountMutation.current = false; await refresh(); }
    } catch (error) { try { if(attempt)await cancelClientAuth(request,attempt.requestId); } catch { if(mounted.current)setUnresolvedAuth(true); } if(mounted.current){try{if(!pendingAuthIds().length){accountMutation.current=false;await refresh();}}catch{}setMessage(error instanceof Error ? error.message : 'Request failed.');} }
    finally { authIntent.current=null; try{accountMutation.current=pendingAuthIds().length>0;}catch{accountMutation.current=true;} if (mounted.current) { setActiveAuthId(null); setUnresolvedAuth(accountMutation.current); setBusy(false); } }
  }
  const tier = !accountReady && access.signedIn ? 'Account verification paused' : access.pro ? `Pro active · ${access.holder?.granted ? 'wallet grant' : access.holder?.eligible ? 'HOODRICH holder' : 'subscription'}` : access.signedIn ? 'Free account' : 'Signed out';
  return <section id="pro-account" className={styles.panel} aria-labelledby="pro-title">
    <header className={styles.header}>
      <div><p className={styles.label}>01 / ACCOUNT</p><h2 id="pro-title">Connect your account</h2><p>Sign in for image uploads and wallet recovery. Pro unlocks up to 50 wallets and 50 daily uploads.</p></div>
      <span className={access.pro ? styles.active : styles.tier}>{tier}</span>
    </header>

    {unresolvedAuth && <div className={styles.alert} role="status"><p>A sign-in attempt needs cancellation before account tools can be used.</p><button disabled={busy} onClick={()=>void retryCancellation()}>Retry cancellation</button></div>}
    {busy && activeAuthId && <button className={styles.cancel} onClick={()=>void retryCancellation()}>Cancel sign-in</button>}

    {access.configured && !access.signedIn && access.walletSignInAvailable === true && !unresolvedAuth && <div className={styles.primaryRow}><button disabled={busy} onClick={()=>void walletSignIn()}>{busy ? 'Working…' : 'Sign in with wallet'}</button><p>Uses a message only. No transaction, gas, or token approval.</p></div>}
    {access.configured && !access.signedIn && access.walletSignInAvailable !== true && access.signInAvailable !== true && <p role="status">Email sign-in is temporarily unavailable. Token creation with an existing image URI remains available.</p>}
    {access.signedIn && !access.pro && <div className={styles.primaryRow}><button disabled={busy} onClick={() => void verifyWallet()}>{access.holder?.verified ? 'Verify holding wallet again' : 'Verify holding wallet for Pro'}</button><p>Free includes 5 uploads per day and one wallet creation every 24 hours.</p></div>}
    {access.signedIn && access.pro && <div className={styles.primaryRow}><a href="#launch">Continue to token creation</a><p>{accountReady ? 'Pro access is verified by the server for this signed-in session.' : 'Your loaded wallets remain available. Financial actions are paused until account verification succeeds.'}</p></div>}

    {!accountReady && <div role="status"><p>Financial actions require current account verification.</p><button type="button" disabled={busy || unresolvedAuth} onClick={() => void refresh()}>Retry account verification</button></div>}
    {message && <p className={styles.message} role="status">{message}</p>}

    <details className={styles.details}>
      <summary>More account details</summary>
      <div className={styles.detailBody}>
        {access.configured && !access.signedIn && access.signInAvailable === true && !unresolvedAuth && <form onSubmit={event => { event.preventDefault(); void act(sent ? 'verify-code' : 'request-code'); }} className={styles.controls}>
          <label>Email<input type="email" autoComplete="email" value={email} onChange={event => { setEmail(event.target.value); setSent(false); }} required maxLength={254} disabled={busy} /></label>
          {sent && <label>Email code<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value)} pattern="[0-9]{6,8}" required maxLength={8} disabled={busy} /></label>}
          <button disabled={busy}>{busy ? 'Working…' : sent ? 'Sign in' : 'Email me a code'}</button>
          <p>A wallet account is separate from an email account. Use the original sign-in method for an existing subscription.</p>
        </form>}
        {access.signedIn && <div className={styles.controls}>
          {((!access.holder?.eligible && !access.holder?.granted) || access.subscription) && <button disabled={busy || !access.billing || (!access.subscription && !salesEnabled)} onClick={() => void act(access.subscription ? 'portal' : 'checkout')}>{access.subscription ? 'Manage subscription' : access.billing && salesEnabled ? 'See Pro price & subscribe' : 'Pro subscriptions coming soon'}</button>}
          {access.billingAccount === true && <button disabled={busy || !access.billing} onClick={() => void act('portal')}>Manage billing</button>}
          <button disabled={busy} onClick={() => void refresh()}>Refresh Pro access</button>
          <button disabled={busy} onClick={() => void act('logout')}>Sign out & lock wallets</button>
        </div>}
        {access.signedIn && access.billingAccountUnavailable === true && <p role="status">Billing account status is temporarily unavailable. Refresh before opening billing history.</p>}
        <div className={styles.holder}>
          <h3>Holder proof</h3>
          <p>Hold at least {HOODRICH_MINIMUM_FORMATTED} $RICH on Robinhood Chain, then sign a separate ownership message. Tokens stay in your wallet.</p>
          <p className={styles.note}>Token contract: <a href={'https://robinhoodchain.blockscout.com/token/' + HOODRICH_TOKEN} target="_blank" rel="noopener noreferrer"><code>{HOODRICH_TOKEN}</code></a></p>
          {access.holder?.address && <p>Linked wallet: <code>{access.holder.address}</code>{holderBalance() !== null && <> · Confirmed balance: {holderBalance()} $RICH</>}</p>}
          {access.holder?.granted && <p>This verified wallet has an explicit Pro wallet grant.</p>}
          {access.holder?.unavailable && <p>Token balance verification is temporarily unavailable. An independently verified paid subscription still grants Pro.</p>}
          {access.holder?.verified && !access.holder.eligible && !access.holder.granted && !access.holder.unavailable && <p>This wallet is verified, but its confirmed balance is below {HOODRICH_MINIMUM_FORMATTED} $RICH.</p>}
          {access.signedIn && <div className={styles.controls}><button disabled={busy} onClick={() => void verifyWallet()}>{access.holder?.verified ? 'Verify wallet again' : 'Verify holding wallet'}</button><button disabled={busy} onClick={() => void act('holder-unlink')}>Unlink holding wallet</button></div>}
          <p className={styles.note}>A wallet grant still requires account sign-in and holder proof. Standard wallets and EIP-7702 delegated wallets can verify with their original wallet key. One wallet links to one account; access is rechecked periodically.</p>
        </div>
        <p className={styles.note}>Wallet keys stay in this browser. Account services never receive seed phrases or backup passwords. IPFS uploads are public and may remain available permanently. <a href="/security" target="_blank" rel="noopener noreferrer">Security & recovery</a></p>
      </div>
    </details>
  </section>;
}
