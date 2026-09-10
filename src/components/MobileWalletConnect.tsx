import { useCallback, useEffect, useRef, useState } from "react";
import { hasInjectedWallet, HOODLABS_URL, METAMASK_DAPP_URL } from "../lib/mobile-wallet";
import styles from "./MobileWalletConnect.module.css";

interface MobileWalletConnectProps {
  open: boolean;
  onClose: () => void;
  onProviderReady: () => void | Promise<void>;
}

export default function MobileWalletConnect({ open, onClose, onProviderReady }: MobileWalletConnectProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const metaMaskLinkRef = useRef<HTMLAnchorElement | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const close = useCallback(() => {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    else onClose();
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setStatus("");
      setError("");
      dialog.showModal();
      metaMaskLinkRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  async function copySiteAddress() {
    setStatus("");
    setError("");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
      await navigator.clipboard.writeText(HOODLABS_URL);
      setStatus("Site address copied.");
    } catch {
      setError("Could not copy automatically. Press and hold the address below to copy it manually.");
    }
  }

  async function tryAgain() {
    setStatus("");
    setError("");
    if (!hasInjectedWallet()) {
      setError("No wallet was found in this browser. Open this site inside MetaMask, then connect there.");
      return;
    }
    close();
    await onProviderReady();
  }

  return <dialog
    ref={dialogRef}
    className={styles.dialog}
    aria-labelledby="mobile-wallet-title"
    aria-describedby="mobile-wallet-description"
    onCancel={(event) => { event.preventDefault(); close(); }}
    onClose={onClose}
  >
    <button className={styles.close} type="button" onClick={close} aria-label="Close mobile wallet instructions">×</button>
    <p className={styles.eyebrow}>MOBILE WALLET</p>
    <h2 id="mobile-wallet-title">Open HOODLABS in MetaMask</h2>
    <p id="mobile-wallet-description">Safari and MetaMask use separate browser workspaces. Open this site in MetaMask’s browser, then connect from there.</p>
    <a ref={metaMaskLinkRef} className={styles.primary} href={METAMASK_DAPP_URL}>Open in MetaMask</a>
    <div className={styles.manual}>
      <p>If the app link does not open, copy this address and paste it into MetaMask’s browser:</p>
      <code>{HOODLABS_URL}</code>
      <button type="button" onClick={() => void copySiteAddress()}>Copy site address</button>
    </div>
    <p className={styles.note}>Unsaved drafts and generated wallets in Safari do not transfer to MetaMask. A protected preview may also ask you to sign in to Vercel again there.</p>
    {(error || status) && <p className={error ? styles.error : styles.status} role={error ? "alert" : "status"}>{error || status}</p>}
    <div className={styles.actions}>
      <button type="button" onClick={() => void tryAgain()}>Try this browser again</button>
      <button type="button" onClick={close}>Close</button>
    </div>
  </dialog>;
}
