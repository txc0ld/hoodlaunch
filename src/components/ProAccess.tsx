import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './ProAccess.module.css';
type Access = { configured: boolean; signedIn: boolean; pro: boolean; billing: boolean };
const NONE: Access = { configured: false, signedIn: false, pro: false, billing: false };
export default function ProAccess({ onAccessChange }: { onAccessChange: (value: boolean) => void }) {
  const [access, setAccess] = useState<Access>(NONE);
  const [email, setEmail] = useState(''); const [code, setCode] = useState('');
  const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('Checking account services…');
  const generation = useRef(0);
  const request = useCallback(async (action: string, data: Record<string, string> = {}) => {
    const response = await fetch('/api/account', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...data }), signal: AbortSignal.timeout(20000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Account services are unavailable.');
    return result;
  }, []);
  const refresh = useCallback(async () => {
    const sequence = ++generation.current;
    try {
      const result = await request('status') as Access;
      if (sequence !== generation.current) return;
      setAccess(result); onAccessChange(result.pro === true); setMessage(result.configured ? '' : 'Pro is being prepared. Free launch configuration is available below.');
    } catch (error) { if (sequence !== generation.current) return; setAccess(NONE); onAccessChange(false); setMessage(error instanceof Error ? error.message : 'Account services are unavailable.'); }
  }, [onAccessChange, request]);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 60000); const focus = () => void refresh(); window.addEventListener('focus', focus); return () => { generation.current++; clearInterval(timer); window.removeEventListener('focus', focus); onAccessChange(false); }; }, [refresh, onAccessChange]);
  async function act(action: string) {
    if (busy) return; setBusy(true); setMessage('');
    if (action === 'logout') { generation.current++; onAccessChange(false); }
    try {
      const result = await request(action, { email, code }); setCode('');
      if (action === 'request-code') { setSent(true); setMessage('Check your email for a sign-in code.'); }
      else if (result.url) {
        const url = new URL(result.url);
        if (url.protocol !== 'https:' || !['checkout.stripe.com', 'billing.stripe.com'].includes(url.hostname)) throw new Error('Invalid billing destination.');
        window.location.assign(url.href);
      } else { if (action === 'logout') { setEmail(''); setSent(false); } await refresh(); }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Request failed.'); }
    finally { setBusy(false); }
  }
  return <section className={styles.panel} aria-labelledby="pro-title">
    <div><p className={styles.label}>HOODRICH PRO</p><h2 id="pro-title">One launch. Up to 50 wallets.</h2><p>Free token launching. Pro adds the guided wallet workspace and managed image uploads.</p></div>
    {access.pro ? <p className={styles.active}>Pro active · 50 upload attempts per day</p> : <p className={styles.note}>Your wallet keys stay in this browser. Account services never receive your seed phrase, backup password or exchange credentials. Network and protocol fees still apply.</p>}
    {access.configured && !access.signedIn && <form onSubmit={event => { event.preventDefault(); void act(sent ? 'verify-code' : 'request-code'); }} className={styles.controls}>
      <label>Email<input type="email" autoComplete="email" value={email} onChange={event => { setEmail(event.target.value); setSent(false); }} required maxLength={254} disabled={busy} /></label>
      {sent && <label>Email code<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value)} pattern="[0-9]{6,8}" required maxLength={8} disabled={busy} /></label>}
      <button disabled={busy}>{busy ? 'Working…' : sent ? 'Sign in' : 'Email me a code'}</button>
    </form>}
    {access.signedIn && <div className={styles.controls}>
      <button disabled={busy || !access.billing} onClick={() => void act(access.pro ? 'portal' : 'checkout')}>{access.pro ? 'Manage subscription' : access.billing ? 'See Pro price & subscribe' : 'Pro subscriptions coming soon'}</button>
      <button disabled={busy} onClick={() => void act('logout')}>Sign out & lock wallets</button>
    </div>}
    {message && <p role="status">{message}</p>}
    <p className={styles.note}>Images uploaded to IPFS are public and may remain available permanently. Keep recovery backups offline. <a href="/security">Security & recovery</a></p>
  </section>;
}
