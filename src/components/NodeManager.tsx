import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { BigNumber, utils } from "ethers";
import {
  createNodeSession,
  encryptNodeBackup,
  exportNodeKeystore,
  forgetNodeSession,
  isVerifiedNodeSession,
  MAX_NODES,
  restoreNodeBackup,
  recordNodeActivity,
} from "../lib/node-vault";
import type { NodeSession } from "../lib/node-vault";
import { getNodeBalances } from "../lib/node-balances";
import type { NodeBalanceSnapshot } from "../lib/node-balances";
import NodeBridge from "./NodeBridge";
import ExchangeFunding from "./ExchangeFunding";
import { GenerationError, nodeGenerationRequest, type NodeAllowance } from "../lib/node-generation";
import styles from "./NodeManager.module.css";

const MAX_BACKUP_BYTES = 16 * 1024;

type VaultAction = "idle" | "creating" | "restoring" | "exporting";

export interface NodeManagerProps {
  sessionIdentity: string;
  proEnabled?: boolean;
  financeEnabled?: boolean;
  onSessionChange?: (session: NodeSession | null) => void;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "The operation failed. Please try again.";
}

function download(contents: string, filename: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function shortAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export default function NodeManager({ onSessionChange, sessionIdentity, proEnabled = false, financeEnabled = false }: NodeManagerProps) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(proEnabled ? 5 : 1);
  const [allowance, setAllowance] = useState<NodeAllowance | null>(null);
  const [allowanceError, setAllowanceError] = useState("");
  const [pending, setPending] = useState(false);
  const attemptRef = useRef<{ requestId: string; count: number; session?: NodeSession } | null>(null);
  const busyRef = useRef(false);
  const identityValid = useRef(true);
  const [session, setSession] = useState<NodeSession | null>(null);
  const [vaultAction, setVaultAction] = useState<VaultAction>("idle");
  const [vaultProgress, setVaultProgress] = useState(0);
  const [vaultError, setVaultError] = useState("");
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [targetEth, setTargetEth] = useState("0.01");
  const [balances, setBalances] = useState<NodeBalanceSnapshot | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [balanceError, setBalanceError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const createPasswordRef = useRef<HTMLInputElement | null>(null);
  const restorePasswordRef = useRef<HTMLInputElement | null>(null);
  const exportPasswordRef = useRef<HTMLInputElement | null>(null);
  const restoreFileRef = useRef<HTMLInputElement | null>(null);
  const selectedNodeRef = useRef<HTMLSelectElement | null>(null);
  const sessionRef = useRef<NodeSession | null>(null);
  const targetRef = useRef(targetEth);
  const lastActivity = useRef(Date.now());
  const vaultGeneration = useRef(0);
  const balanceGeneration = useRef(0);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    identityValid.current = true;
    return () => {
    vaultGeneration.current += 1;
    balanceGeneration.current += 1;
    if (sessionRef.current) forgetNodeSession(sessionRef.current);
    attemptRef.current = null; identityValid.current = false;
    };
  }, []);

  function lockWallets() {
    vaultGeneration.current += 1;
    balanceGeneration.current += 1;
    attemptRef.current=null; setPending(false); busyRef.current=false;
    const current=sessionRef.current;
    sessionRef.current=null;
    if(current)forgetNodeSession(current);
    setSession(null);onSessionChange?.(null);setBalances(null);setVaultAction("idle");
    setVaultError("Wallets locked. Restore your encrypted backup to unlock them. Submitted transaction records remain available.");
  }
  useEffect(() => {
    const pagehide = () => lockWallets();
    window.addEventListener("pagehide", pagehide);
    return () => window.removeEventListener("pagehide", pagehide);
  }, []);
  function allowanceFailure(error: unknown) {
    if (error instanceof GenerationError && ["SESSION_CHANGED", "SIGN_IN"].includes(error.code)) {
      identityValid.current = false; lockWallets();
    }
    setAllowance(null); setAllowanceError(message(error));
  }
  useEffect(() => {
    let active = true;
    async function refresh() {
      try { const result = await nodeGenerationRequest(sessionIdentity); if (active && identityValid.current) { setAllowance(result); setAllowanceError(""); } }
      catch (error) { if (active) allowanceFailure(error); }
    }
    void refresh(); const timer = window.setInterval(refresh, 60000);
    return () => { active = false; window.clearInterval(timer); };
  }, [sessionIdentity]);
  useEffect(() => {
    if(!session)return;
    lastActivity.current=Date.now();
    const idleMs=15*60*1000;
    const check=()=>{if(Date.now()-lastActivity.current>=idleMs)lockWallets();};
    const activity=(event:Event)=>{if(!event.isTrusted)return;check();if(sessionRef.current){try{recordNodeActivity(sessionRef.current);lastActivity.current=Date.now();}catch{lockWallets();}}};
    const pagehide=()=>lockWallets();
    document.addEventListener("pointerdown",activity);document.addEventListener("keydown",activity);
    document.addEventListener("visibilitychange",check);window.addEventListener("pagehide",pagehide);
    const timer=window.setInterval(check,1000);
    return ()=>{window.clearInterval(timer);document.removeEventListener("pointerdown",activity);document.removeEventListener("keydown",activity);document.removeEventListener("visibilitychange",check);window.removeEventListener("pagehide",pagehide);};
  },[session]);

  const verified = Boolean(session && isVerifiedNodeSession(session));

  useEffect(() => {
    const sharedSession = verified ? session : null;
    onSessionChange?.(sharedSession);
    return () => {
      if (sharedSession) onSessionChange?.(null);
    };
  }, [onSessionChange, session, verified]);
  const targetWei = useMemo(() => {
    try {
      if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(targetEth)) return null;
      const value = utils.parseEther(targetEth);
      return value.gt(0) ? value : null;
    } catch {
      return null;
    }
  }, [targetEth]);

  const rows = useMemo(() => {
    if (!verified || !session || !targetWei) return [];
    const byAddress = new Map((balances?.balances || []).map((item) => [item.address.toLowerCase(), BigNumber.from(item.balanceWei)]));
    return session.addresses.map((address, index) => {
      const balance = byAddress.get(address.toLowerCase());
      const deficit = balance ? (balance.gte(targetWei) ? BigNumber.from(0) : targetWei.sub(balance)) : targetWei;
      return { index, address, balance, deficit, funded: Boolean(balance?.gte(targetWei)) };
    });
  }, [balances, session, targetWei, verified]);

  function replaceSession(next: NodeSession) {
    balanceGeneration.current += 1;
    setBalances(null);
    setBalancesLoading(false);
    setBalanceError("");
    setCopyStatus("");
    setReplaceConfirmed(false);
    const previous = sessionRef.current;
    sessionRef.current = next;
    setSession(next);
    if (previous && previous !== next) forgetNodeSession(previous);
  }

  async function handleCreate() {
    if (busyRef.current || !identityValid.current) return;
    const passwordInput = createPasswordRef.current;
    const password = passwordInput?.value || "";
    if (!attemptRef.current && sessionRef.current && !replaceConfirmed) {
      if (passwordInput) passwordInput.value = "";
      setVaultError("Confirm replacement only after saving a recoverable backup."); return;
    }
    if (password.length < 12 || password.length > 128) {
      if (passwordInput) passwordInput.value = "";
      setVaultError("Backup password must be 12–128 characters."); return;
    }
    const maximum = Math.min(proEnabled ? MAX_NODES : 1, allowance?.maxCount || 1);
    if (!attemptRef.current && (!Number.isInteger(count) || count < 1 || count > maximum)) {
      if (passwordInput) passwordInput.value = "";
      setVaultError(`Choose a whole number from 1 to ${maximum}.`); return;
    }
    if (!attemptRef.current && (!allowance?.available || count > allowance.maxCount)) {
      if (passwordInput) passwordInput.value = "";
      setVaultError("Your wallet allowance is not available. Check the reset time below."); return;
    }
    busyRef.current = true;
    const generation = ++vaultGeneration.current;
    const current = () => generation === vaultGeneration.current && identityValid.current;
    setVaultAction("creating"); setVaultProgress(0); setVaultError("");
    try {
      if (!attemptRef.current) { attemptRef.current = { requestId: crypto.randomUUID(), count: proEnabled ? count : 1 }; setPending(true); }
      const attempt = attemptRef.current;
      if (!attempt.session) {
        const reserved = await nodeGenerationRequest(sessionIdentity, attempt);
        if (!current()) return;
        // Store the root immediately: a failed encryption/download must retry these same keys.
        attempt.session = createNodeSession(attempt.count);
        replaceSession(attempt.session);
        setAllowance(previous => previous ? { ...previous, available: reserved.nextEligibleAt === null, nextEligibleAt: reserved.nextEligibleAt } : null);
      }
      if (!current()) return;
      const next = attempt.session;
      const serialized = await encryptNodeBackup(next, password, progress => { if (current()) setVaultProgress(progress * 100); });
      if (!current() || sessionRef.current !== next) return;
      download(serialized, `hoodlabs-node-backup-${next.id}.json`);
    } catch (error) {
      if (current()) {
        if (error instanceof GenerationError && ["SESSION_CHANGED", "SIGN_IN"].includes(error.code)) allowanceFailure(error);
        else setVaultError(message(error) + " Retry uses the same request and wallets. Do not close this tab before saving your backup.");
      }
    } finally {
      if (passwordInput) passwordInput.value = "";
      if (current()) { busyRef.current = false; setVaultAction("idle"); setVaultProgress(0); }
    }
  }

  async function handleRestore() {
    if (busyRef.current || !identityValid.current) return;
    const fileInput = restoreFileRef.current;
    const passwordInput = restorePasswordRef.current;
    const file = fileInput?.files?.[0];
    const password = passwordInput?.value || "";
    if (!file) {
      if (passwordInput) passwordInput.value = "";
      setVaultError("Choose an encrypted node backup file.");
      return;
    }
    if (file.size > MAX_BACKUP_BYTES) {
      if (passwordInput) passwordInput.value = "";
      if (fileInput) fileInput.value = "";
      setVaultError("Backup file must be 16 KB or smaller.");
      return;
    }
    if (password.length < 12 || password.length > 128) {
      if (passwordInput) passwordInput.value = "";
      setVaultError("Backup password must be 12–128 characters.");
      return;
    }
    const generation = ++vaultGeneration.current;
    busyRef.current = true;
    setVaultAction("restoring");
    setVaultProgress(0);
    setVaultError("");
    let restored: NodeSession | null = null;
    try {
      const serialized = await file.text();
      if (generation !== vaultGeneration.current) return;
      restored = await restoreNodeBackup(serialized, password, (progress) => {
        if (generation === vaultGeneration.current) setVaultProgress(progress * 100);
      });
      if (generation !== vaultGeneration.current) {
        forgetNodeSession(restored);
        return;
      }
      const current = sessionRef.current;
      const sameWallets = current?.addresses.length === restored.addresses.length && current.addresses.every((address, index) => address === restored?.addresses[index]);
      if (current && !sameWallets && !replaceConfirmed) {
        throw new Error("This backup contains different wallets. Confirm replacement before restoring it.");
      }
      attemptRef.current = null; setPending(false);
      replaceSession(restored);
      restored = null;
    } catch (error) {
      if (restored) forgetNodeSession(restored);
      if (generation === vaultGeneration.current) setVaultError(message(error));
    } finally {
      if (passwordInput) passwordInput.value = "";
      if (fileInput) fileInput.value = "";
      if (generation === vaultGeneration.current) {
        busyRef.current = false; setVaultAction("idle");
        setVaultProgress(0);
      }
    }
  }

  async function handleKeystoreExport() {
    if (busyRef.current || !identityValid.current) return;
    if (!session || !verified) return;
    const passwordInput = exportPasswordRef.current;
    const password = passwordInput?.value || "";
    if (password.length < 12 || password.length > 128) {
      if (passwordInput) passwordInput.value = "";
      setVaultError("Keystore password must be 12–128 characters.");
      return;
    }
    const index = Number(selectedNodeRef.current?.value || 0);
    const generation = ++vaultGeneration.current;
    busyRef.current = true;
    setVaultAction("exporting");
    setVaultProgress(0);
    setVaultError("");
    try {
      const serialized = await exportNodeKeystore(session, index, password, (progress) => {
        if (generation === vaultGeneration.current) setVaultProgress(progress * 100);
      });
      if (generation !== vaultGeneration.current || sessionRef.current !== session) return;
      download(serialized, `pons-node-${index + 1}-keystore.json`);
    } catch (error) {
      if (generation === vaultGeneration.current) setVaultError(message(error));
    } finally {
      if (passwordInput) passwordInput.value = "";
      if (generation === vaultGeneration.current) {
        busyRef.current = false; setVaultAction("idle");
        setVaultProgress(0);
      }
    }
  }

  function updateTarget(value: string) {
    balanceGeneration.current += 1;
    targetRef.current = value;
    setTargetEth(value);
    setBalances(null);
    setBalancesLoading(false);
    setBalanceError("");
  }

  async function handleBalanceCheck() {
    if (!financeEnabled || !session || !verified || !targetWei) return;
    const generation = ++balanceGeneration.current;
    const expectedSession = session;
    const expectedTarget = targetEth;
    setBalancesLoading(true);
    setBalanceError("");
    try {
      const snapshot = await getNodeBalances(session.addresses);
      if (generation !== balanceGeneration.current || sessionRef.current !== expectedSession || targetRef.current !== expectedTarget) return;
      setBalances(snapshot);
    } catch (error) {
      if (generation === balanceGeneration.current && sessionRef.current === expectedSession) setBalanceError(message(error));
    } finally {
      if (generation === balanceGeneration.current) setBalancesLoading(false);
    }
  }

  async function copyAddresses() {
    if (!verified || !session) return;
    try {
      await navigator.clipboard.writeText(session.addresses.join("\n"));
      setCopyStatus("Addresses copied.");
    } catch {
      setCopyStatus("Copy failed. Download the CSV instead.");
    }
  }

  async function copyAddress(address: string, index: number) {
    if (!verified) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopyStatus(`Node ${index + 1} address copied.`);
    } catch {
      setCopyStatus("Copy failed. Download the CSV instead.");
    }
  }

  function downloadFundingCsv() {
    if (!verified || !session || !targetWei) return;
    const header = ["node", "address", "network", "target_eth", "balance_eth", "deficit_eth", "status"];
    const lines = rows.map((row) => [
      String(row.index + 1),
      row.address,
      "Robinhood Chain (4663)",
      targetEth,
      row.balance ? utils.formatEther(row.balance) : "not checked",
      balances ? utils.formatEther(row.deficit) : "not checked",
      row.funded ? "Balance meets target" : balances ? "Below target" : "Not checked",
    ].map(csvCell).join(","));
    download([header.map(csvCell).join(","), ...lines].join("\r\n"), `pons-node-funding-${session.id}.csv`, "text/csv;charset=utf-8");
  }

  const busy = vaultAction !== "idle";

  return (
    <section className={styles.manager} aria-labelledby="node-manager-title">
      <button className={styles.managerToggle} type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="node-manager-panel">
        <span><span className={styles.eyebrow}>Node wallets</span><strong id="node-manager-title">Prepare controlled funding wallets</strong><small>Encrypted local backup · backup verification · recovery controls</small></span>
        <span className={open ? styles.chevronOpen : styles.chevron} aria-hidden="true">⌄</span>
      </button>

      {session && <button className={styles.secondaryButton} type="button" onClick={lockWallets}>Lock wallets</button>}
      {open && <div id="node-manager-panel" className={styles.panel}>
        {financeEnabled && verified && session && <ExchangeFunding addresses={session.addresses} />}
        <div className={styles.step}>
          <div className={styles.stepHeading}><span>1</span><div><h2>Create and verify wallets</h2><p>Keys stay in this tab, which remains a sensitive signing environment. Wallets lock after 15 minutes without activity. Download the encrypted backup, then restore it to prove you can recover the wallets.</p></div></div>
          {vaultError && <div className={styles.alert} role="alert"><span>{vaultError}</span><button type="button" onClick={() => setVaultError("")}>Dismiss</button></div>}
          <p role="status">{proEnabled ? "Pro: create up to 50 wallets per attempt." : "Free: one wallet generation attempt per verified account every 24 hours."} {allowance?.nextEligibleAt && <>Next free wallet: {new Date(allowance.nextEligibleAt).toLocaleString()}.</>}</p>
          <p>Save and verify the backup before closing this tab. An accepted attempt uses your allowance even if the backup is lost; the server cannot recover your keys.</p>
          {allowanceError && <p role="status">{allowanceError}</p>}
          <div className={styles.controls}>
            <label><span>Wallet count</span><input type="number" min="1" max={proEnabled ? MAX_NODES : 1} value={pending ? attemptRef.current?.count || count : count} onChange={(event) => setCount(Math.max(1, Math.min(MAX_NODES, Number(event.target.value) || 1)))} disabled={busy || !proEnabled || pending} /></label>
            <label><span>Backup password</span><input ref={createPasswordRef} type="password" minLength={12} maxLength={128} autoComplete="new-password" placeholder="12–128 characters" disabled={busy} /></label>
            <button className={styles.primaryButton} type="button" onClick={handleCreate} disabled={busy || !identityValid.current || (!pending && !allowance?.available)}>{vaultAction === "creating" ? "Encrypting backup…" : pending ? "Retry backup / request" : session ? "Replace wallets" : "Generate wallet"}</button>
          </div>
          {session && <label className={styles.confirm}><input type="checkbox" checked={replaceConfirmed} onChange={(event) => setReplaceConfirmed(event.target.checked)} disabled={busy} /><span>I understand replacing these wallets forgets the current in-memory session. I have a recoverable encrypted backup.</span></label>}
          {busy && <div className={styles.progress} role="status" aria-live="polite"><span style={{ width: `${Math.max(2, Math.min(100, vaultProgress))}%` }} /> <small>{vaultAction === "restoring" ? "Restoring" : vaultAction === "exporting" ? "Exporting keystore" : "Encrypting backup"}{vaultProgress ? ` · ${Math.round(vaultProgress)}%` : "…"}</small></div>}

          <div className={styles.restoreBox}>
            <div><strong>Verify or restore an encrypted backup</strong><small>JSON only · 16 KB maximum</small></div>
            <input ref={restoreFileRef} type="file" accept="application/json,.json" aria-label="Encrypted node backup file" disabled={busy} />
            <input ref={restorePasswordRef} type="password" minLength={12} maxLength={128} autoComplete="current-password" placeholder="Backup password" aria-label="Backup password for restore" disabled={busy} />
            <button className={styles.secondaryButton} type="button" onClick={handleRestore} disabled={busy}>{vaultAction === "restoring" ? "Verifying…" : "Verify and restore"}</button>
          </div>

          {session && <div className={`${styles.sessionStatus} ${verified ? styles.verified : ""}`} role="status">
            <span aria-hidden="true">{verified ? "✓" : "!"}</span><div><strong>{verified ? `${session.addresses.length} wallets verified` : `${session.addresses.length} wallets created; backup not yet verified`}</strong><small>{verified ? "Wallet addresses and encrypted export are now available below." : "Addresses remain hidden until the encrypted backup is restored successfully."}</small></div>
          </div>}
        </div>

        <div className={`${styles.step} ${!verified ? styles.locked : ""}`} aria-disabled={!verified}>
          <div className={styles.stepHeading}><span>2</span><div><h2>{financeEnabled ? "Fund and monitor wallets" : "Wallet addresses & recovery"}</h2><p>{financeEnabled ? "Send ETH using your wallet or exchange, then bridge to Robinhood Chain." : "Keep your encrypted backup offline. Funding and bridge tools are currently unavailable; multi-wallet trading has a separate section below."}</p></div></div>
          {!verified ? <p className={styles.lockMessage}>Verify the encrypted backup in step 1 to reveal funding destinations.</p> : session && <>
            {session.addresses.map((address,index)=><div key={`${session.id}-${index}`}><strong>Node {index+1}</strong><code className={styles.fullAddress}>{address}</code>{financeEnabled && <NodeBridge session={session} nodeIndex={index} />}</div>)}
            {!financeEnabled && <><button className={styles.secondaryButton} onClick={copyAddresses} type="button">Copy addresses</button>{copyStatus && <p role="status">{copyStatus}</p>}</>}
            {financeEnabled && <>
            <div className={styles.chainHeading}><strong>Robinhood Chain funding target</strong><small>This is separate from the Ethereum withdrawal amount above. Check here only after each wallet has bridged to chain ID 4663.</small></div>
            <div className={styles.fundingControls}>
              <label><span>Target per wallet (ETH)</span><input value={targetEth} maxLength={80} onChange={(event) => updateTarget(event.target.value)} inputMode="decimal" aria-invalid={!targetWei} /></label>
              <button className={styles.secondaryButton} type="button" onClick={copyAddresses}>Copy addresses</button>
              <button className={styles.secondaryButton} type="button" onClick={downloadFundingCsv} disabled={!targetWei}>Download funding CSV</button>
              <button className={styles.primaryButton} type="button" onClick={handleBalanceCheck} disabled={!targetWei || balancesLoading}>{balancesLoading ? "Checking balances…" : "Check balances"}</button>
            </div>
            {!targetWei && <p className={styles.fieldError} role="alert">Enter an ETH amount greater than zero with no more than 18 decimal places.</p>}
            {copyStatus && <p className={styles.copyStatus} role="status">{copyStatus}</p>}
            {balanceError && <div className={styles.alert} role="alert"><span>{balanceError}</span><button type="button" onClick={handleBalanceCheck}>Retry</button></div>}
            <div className={styles.walletList} aria-label="Node funding destinations">
              {rows.map((row) => <article key={row.address} className={styles.walletRow}>
                <div><span>Node {row.index + 1}</span><code title={row.address} aria-label={`Node ${row.index + 1} address ${row.address}`}>{shortAddress(row.address)}</code></div>
                <div><span>Balance</span><strong>{row.balance ? `${utils.formatEther(row.balance)} ETH` : "Not checked"}</strong></div>
                <div><span>Deficit</span><strong>{balances ? `${utils.formatEther(row.deficit)} ETH` : "Not checked"}</strong></div>
                <em className={row.funded ? styles.met : styles.pending}>{row.funded ? "Balance meets target" : balances ? "Below target" : "Not checked"}</em>
                <button className={styles.rowCopy} type="button" onClick={() => void copyAddress(row.address, row.index)} aria-label={`Copy node ${row.index + 1} address`}>Copy address</button>
              </article>)}
            </div>
            {balances && <p className={styles.snapshot}>Canonical Robinhood Chain (4663) balance snapshot · block {balances.blockNumber.toLocaleString()} · {new Date(balances.checkedAt).toLocaleString()}. A matching balance does not prove which withdrawal or bridge funded it.</p>}

            </>}
            <div className={styles.keystoreBox}>
              <div><strong>Export one wallet for external control</strong><small>Produces a standard encrypted keystore. Keep its password separate from the file.</small></div>
              <select ref={selectedNodeRef} aria-label="Node to export">{session.addresses.map((address, index) => <option value={index} key={address}>Node {index + 1} · {shortAddress(address)}</option>)}</select>
              <input ref={exportPasswordRef} type="password" minLength={12} maxLength={128} autoComplete="new-password" placeholder="New keystore password" aria-label="Keystore password" disabled={busy} />
              <button className={styles.secondaryButton} type="button" onClick={handleKeystoreExport} disabled={busy}>{vaultAction === "exporting" ? "Exporting…" : "Download keystore"}</button>
            </div>
          </>}
        </div>
      </div>}
    </section>
  );
}
