import { useEffect, useRef, useState } from 'react';
import { HOLDER_PROFILE_URL, HOLDER_SETUP_BLOCKER, inspectHolderFees } from '../lib/pons-holder-fees';
import type { HolderFeeObservation } from '../lib/pons-holder-fees';
import type { LaunchReceipt, WalletState } from '../lib/pons-types';
import styles from './HolderFeeSharing.module.css';

export default function HolderFeeSharing({ receipt, wallet, requested }: { receipt: LaunchReceipt; wallet: WalletState | null; requested: boolean | null }) {
  const [observation, setObservation] = useState<HolderFeeObservation | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const latch = useRef(false);
  const epoch = useRef(0);
  useEffect(() => {
    epoch.current++; setObservation(null); setError('');
    return () => { epoch.current++; };
  }, [receipt.transactionHash, wallet?.account, wallet?.chainId]);
  async function check() {
    if (!wallet || latch.current) return;
    latch.current = true; setBusy(true); setError(''); setObservation(null);
    const ticket = epoch.current;
    try {
      const result = await inspectHolderFees(receipt, wallet, () => { if (ticket !== epoch.current) throw new Error('Status check cancelled.'); });
      if (ticket === epoch.current) setObservation(result);
    } catch (reason) { if (ticket === epoch.current) setError(reason instanceof Error ? reason.message : 'Holder fee status could not be checked.'); }
    finally { latch.current = false; setBusy(false); }
  }
  return <section className={styles.panel} aria-label="Holder fee sharing">
    <h3>Holder fee sharing</h3>
    <p>{requested ? 'Requested for this launched token. Distribution has not been enabled by HOODLABS.' : requested === false ? 'Holder sharing was not selected for this launch.' : 'This recovered receipt has no holder sharing preference recorded here.'} Your launch remains successful.</p>
    <p>{HOLDER_SETUP_BLOCKER}</p>
    <p>PONS setup uses up to two additional wallet approvals: create the token’s distributor, then route future creator fees to it. Gas is additional. Routing gives up your ability to redirect those fees through the creator transfer method; protocol administration can still change the recipient.</p>
    <button type="button" onClick={() => void check()} disabled={busy || !wallet || wallet.chainId !== 4663}>{busy ? 'Checking holder fees…' : 'Check holder fee status'}</button>
    <div role="status" aria-live="polite">{observation && <>
      <p>{observation.status === 'not-created' ? 'No distributor is registered for this token.' : observation.status === 'distributor-unverified' ? 'A distributor is registered, but the current recipient is not that distributor.' : 'The recipient matches the registered distributor. Holder payouts remain unverified; this is not confirmation that sharing works.'}</p>
      <p>Observed at block {observation.blockNumber}. {observation.callerIsRecipient ? 'This wallet is the current creator fee recipient.' : 'This wallet is not the current creator fee recipient.'}</p>
      <code>Recipient: {observation.recipient}</code>{observation.distributor && <code>Distributor: {observation.distributor}</code>}
    </>}</div>
    {error && <p role="alert">{error}</p>}
    <a href={HOLDER_PROFILE_URL} target="_blank" rel="noopener noreferrer">View claimable fees on PONS</a>
  </section>;
}
