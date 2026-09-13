import { ReactNode, ChangeEvent, DragEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { constants, utils } from "ethers";
import {
  getLaunchOperation,
  recoverLaunch,
  exportLaunchRecovery,
  launchOperationKey,
  validateImageUri,
  executePreparedLaunch,
  getProtocolState,
  onWalletChange,
  PonsSubmissionError,
  PONS_EXPLORER,
  prepareLaunch,
  refreshWallet,
  switchToPons,
} from "../lib/pons";
import type { LaunchOperation } from "../lib/pons";
import type { LaunchDraft, LaunchReceipt, PreparedLaunch, ProtocolState, WalletState, PairAsset } from "../lib/pons-types";
import { forgetNodeSession, type NodeSession } from "../lib/node-vault";
import NodeManager from "./NodeManager";
import NodeTrading from "./NodeTrading";
import TokenLinks from "./TokenLinks";
import HolderFeeSharing from "./HolderFeeSharing";
import { holderFeeLaunchBlocker, holderFeeLaunchDraft, rememberHolderFeeIntent, preparedHolderFeeIntent, bindHolderFeeLaunch } from "../lib/pons-holder-fees";
import type { HolderFeeLaunchBinding } from "../lib/pons-holder-fees";
import LabHero from "./LabHero";
import PairSelector from "./PairSelector";
import { PonsLaunchPlan } from "./TokenLab";
import { applyPonsPlan, getPonsPlanningSnapshot, type PonsPlanInput } from "../lib/pons-planning";
import MobileWalletConnect from "./MobileWalletConnect";
import WalletConnection from "./WalletConnection";
import { getWalletVersion, walletRegistry } from "../lib/wallet-provider";
import { boundedWalletRequest } from "../lib/wallet-connection";
import styles from "./PonsLaunchpad.module.css";

const PONS_CHAIN_ID = 4663;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const EMPTY_DRAFT: LaunchDraft = {
  name: "",
  symbol: "",
  description: "",
  logo: "",
  twitter: "",
  telegram: "",
  website: "",
  discord: "",
  farcaster: "",
  configId: "",
  developerBuyEth: "0",
  creatorFeeRecipient: "",
  creatorTaxBps: 0,
  buybackEnabled: false,
  slippageBps: 100,
  exemptions: [],
};

type ImageState = "idle" | "uploading" | "uploaded" | "error";
type SubmitState = "idle" | "preparing" | "review" | "submitting" | "pending" | "unknown" | "success" | "error";


function Icon({ name }: { name: "image" | "wallet" | "chevron" | "check" | "external" | "close" | "spinner" }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "image") return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="1.5" /><path d="m5 17 4-4 3 3 2-2 5 5" /></svg>;
  if (name === "wallet") return <svg {...common}><path d="M4 7.5h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2h12" /><path d="M16 12h5v4h-5a2 2 0 0 1 0-4Z" /></svg>;
  if (name === "chevron") return <svg {...common}><path d="m7 10 5 5 5-5" /></svg>;
  if (name === "check") return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
  if (name === "external") return <svg {...common}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" /></svg>;
  if (name === "close") return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
  return <svg {...common} className={styles.spin}><circle cx="12" cy="12" r="9" opacity=".25" /><path d="M21 12a9 9 0 0 0-9-9" /></svg>;
}

function formatEth(wei?: string) {
  if (!wei) return "—";
  try {
    return utils.formatEther(wei);
  } catch {
    return "—";
  }
}

function formatTokenSupply(wei?: string) {
  if (!wei) return "—";
  try {
    return utils.commify(utils.formatUnits(wei, 18));
  } catch {
    return "—";
  }
}

function formatPoolFee(poolFee?: number) {
  if (poolFee === undefined) return "—";
  return (poolFee & 8388608) === 8388608 ? "Dynamic" : `${poolFee / 10000}%`;
}

function shorten(value: string, head = 6, tail = 4) {
  return value.length > head + tail + 3 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
}

function errorMessage(error: unknown) {
  if (typeof error === "object" && error && "code" in error && (error as { code?: number }).code === 4001) return "Request rejected in your wallet.";
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

function normalizeSocialUrl(value: string, host?: string) {
  const clean = value.trim();
  if (!clean) return "";
  if (/^https:\/\//i.test(clean)) return clean;
  const withoutScheme = clean.replace(/^https?:\/\//i, "").replace(/^@/, "");
  return `https://${host && !withoutScheme.includes(".") ? `${host}/${withoutScheme}` : withoutScheme}`;
}

// This boundary is keyed by every account/capability input below. Keeping the
// session here prevents even the first render of a new owner from seeing it.
function WalletWorkspace({ sessionIdentity, proEnabled, generationEnabled, nodeTradingEnabled, financeEnabled, launchedTokenAddress, children }: {
  sessionIdentity: string | null; proEnabled: boolean; generationEnabled: boolean;
  nodeTradingEnabled: boolean; financeEnabled: boolean; launchedTokenAddress: string; children: ReactNode;
}) {
  const [nodeSession, setNodeSession] = useState<NodeSession | null>(null);
  const [nodeBalanceRefreshVersion, setNodeBalanceRefreshVersion] = useState(0);
  const owner = useRef<{ active: boolean; session: NodeSession | null }>({ active: true, session: null });
  useLayoutEffect(() => {
    owner.current.active = true;
    return () => {
      // Invalidate the signing capability during commit, before passive child
      // cleanup or an outstanding asynchronous trade can resume.
      owner.current.active = false;
      if (owner.current.session) forgetNodeSession(owner.current.session);
      owner.current.session = null;
    };
  }, []);
  const acceptSession = useCallback((session: NodeSession | null) => {
    if (!owner.current.active) return;
    owner.current.session = session;
    setNodeSession(session);
  }, []);
  const refreshNodeBalances = useCallback(() => setNodeBalanceRefreshVersion((version) => version + 1), []);
  const canTrade = generationEnabled && nodeTradingEnabled && Boolean(sessionIdentity) && proEnabled;
  return <>
    {children}
    <section id="wallet-workspace" className={styles.integrationSlot} aria-label="Wallet generator" tabIndex={-1}>
      <div className={styles.workspaceIntro}><p className={styles.eyebrow}>03 / WALLETS</p><h2>Wallet workspace</h2><p>Generate or restore controlled wallets, verify the backup, then <a href="#node-trading">load a token to trade</a>.</p></div>
      {!generationEnabled ? <p className={styles.pendingNotice} role="status">Wallet creation and recovery are currently unavailable.</p> : !sessionIdentity ? <p className={styles.pendingNotice}><a href="#pro-account">Sign in to create or restore wallets.</a></p> : <NodeManager sessionIdentity={sessionIdentity} proEnabled={proEnabled} financeEnabled={proEnabled && financeEnabled} balanceRefreshVersion={nodeBalanceRefreshVersion} onSessionChange={acceptSession} />}
    </section>
    {canTrade ? <NodeTrading session={nodeSession} launchedTokenAddress={launchedTokenAddress} onNodeBalancesRefresh={refreshNodeBalances} /> : <section id="node-trading" className={styles.pendingNotice} tabIndex={-1} aria-labelledby="trading-unavailable-title"><h2 id="trading-unavailable-title">Multi-wallet buying & selling</h2><span>Trade existing native ETH-paired PONS tokens using your verified wallets. Trading availability is separate from launching a new token.</span>{!generationEnabled || !nodeTradingEnabled ? <p role="status">Multi-wallet trading is currently unavailable.</p> : !sessionIdentity ? <a href="#pro-account">Sign in with Pro access to use multi-wallet trading.</a> : <p>Multi-wallet trading requires Pro. <a href="#pro-account">Check your account access.</a></p>}</section>}
  </>;
}

export interface PonsLaunchpadProps { financeEnabled?: boolean; nodeTradingEnabled?: boolean; generationEnabled?: boolean; sessionIdentity?: string | null; proEnabled?: boolean; proPanel?: ReactNode; launchEnabled?: boolean; }
export default function PonsLaunchpad({proEnabled=false, proPanel, launchEnabled=false, financeEnabled=false, generationEnabled=false, nodeTradingEnabled=false, sessionIdentity=null}: PonsLaunchpadProps) {
  const [protocol, setProtocol] = useState<ProtocolState | null>(null);
  const [protocolError, setProtocolError] = useState("");
  const [protocolLoading, setProtocolLoading] = useState(true);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [mobileWalletOpen, setMobileWalletOpen] = useState(false);
  const [walletSelectionOpen, setWalletSelectionOpen] = useState(false);
  const walletRequest = useRef(0);
  const [draft, setDraft] = useState<LaunchDraft>(EMPTY_DRAFT);
  const [holderFeesRequested, setHolderFeesRequested] = useState(false);
  const [holderFeeBinding, setHolderFeeBinding] = useState<HolderFeeLaunchBinding | null>(null);
  const [pairAsset, setPairAsset] = useState<PairAsset | null>(null);
  const isCustomPair = draft.pairToken !== undefined && draft.pairToken !== constants.AddressZero;
  const pairLabel = isCustomPair ? pairAsset?.symbol || "Custom asset" : "ETH";
  const [advanced, setAdvanced] = useState(false);
  const [exemptionText, setExemptionText] = useState("");
  const [imageState, setImageState] = useState<ImageState>("idle");
  const [imageError, setImageError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [prepared, setPrepared] = useState<PreparedLaunch | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [submitError, setSubmitError] = useState("");
  const [txHash, setTxHash] = useState("");
  const [receipt, setReceipt] = useState<LaunchReceipt | null>(null);
  const [storedOperation, setStoredOperation] = useState<LaunchOperation | null>(null);
  const uploadSequence = useRef(0);
  const uploadController = useRef<AbortController | null>(null);
  const activeUpload = useRef<{ file: File; sessionIdentity: string } | null>(null);
  const uploadSession = useRef(sessionIdentity);
  uploadSession.current = sessionIdentity;
  const fileInput = useRef<HTMLInputElement | null>(null);
  const modalRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasModalOpenRef = useRef(false);
  const reviewButtonRef = useRef<HTMLButtonElement | null>(null);
  const prepareGeneration = useRef(0);
  const walletRef=useRef(wallet);walletRef.current=wallet;
  const [recoveryBusy,setRecoveryBusy]=useState(false);
  const enabledRef=useRef(launchEnabled);enabledRef.current=launchEnabled;

  const invalidateReview = useCallback(() => {
    prepareGeneration.current += 1;
    setPrepared(null);
    setSubmitError("");
    setSubmitState((current) => current === "review" || current === "preparing" || current === "error" ? "idle" : current);
  }, []);

  const updateDraft = useCallback(<K extends keyof LaunchDraft>(key: K, value: LaunchDraft[K]) => {
    invalidateReview();
    setDraft((current) => ({ ...current, [key]: value }));
  }, [invalidateReview]);

  const changePair = useCallback((pairToken: string, asset: PairAsset | null) => {
    invalidateReview();
    setPairAsset(asset);
    setDraft(current => ({ ...current, pairToken, developerBuyEth: pairToken === constants.AddressZero ? current.developerBuyEth : "0" }));
  }, [invalidateReview]);

  const loadProtocol = useCallback(async () => {
    setProtocolLoading(true);
    setProtocolError("");
    try {
      const next = await getProtocolState();
      setProtocol(next);
      setDraft((current) => current.configId || !next.configs.length ? current : { ...current, configId: next.configs.find((config) => config.enabled)?.id || "" });
    } catch (error) {
      setProtocolError(errorMessage(error));
    } finally {
      setProtocolLoading(false);
    }
  }, []);

  const reloadWallet = useCallback(async (showError = false) => {
    const sequence = ++walletRequest.current;
    const version = getWalletVersion();
    try {
      const next = await boundedWalletRequest(refreshWallet());
      if (sequence !== walletRequest.current || version !== getWalletVersion()) return;
      setWallet(next);
      if (showError) setWalletError("");
    } catch (error) {
      if (sequence !== walletRequest.current || version !== getWalletVersion()) return;
      setWallet(null);
      if (showError) setWalletError(errorMessage(error));
    }
  }, []);

  useEffect(() => { void loadProtocol(); void reloadWallet(false); },[loadProtocol,reloadWallet]);
  useEffect(() => {
    invalidateReview();setHolderFeeBinding(null);setReceipt(null);setTxHash("");setStoredOperation(null);setSubmitState("idle");
    if(!wallet)return;
    const read=()=>{
      try {const current=getLaunchOperation(wallet.account);setStoredOperation(current);setTxHash(current?.hash||"");if(current)setSubmitState("unknown");}
      catch(error){setSubmitError(errorMessage(error));setSubmitState("unknown");}
    };
    read();
    const storage=(event:StorageEvent)=>{if(event.key===launchOperationKey(wallet.account)){invalidateReview();read();}};
    window.addEventListener("storage",storage);return ()=>window.removeEventListener("storage",storage);
  },[wallet?.account,invalidateReview]);
  useEffect(()=>{if(!launchEnabled)invalidateReview();},[launchEnabled,invalidateReview]);

  useEffect(() => {
    return onWalletChange(() => {
      invalidateReview();
      setWallet(null);
      void reloadWallet(false);
      void loadProtocol();
    });
  }, [invalidateReview, loadProtocol, reloadWallet]);

  useEffect(() => () => {
    uploadSequence.current += 1;
    uploadController.current?.abort();
    uploadController.current = null;
    activeUpload.current = null;
  }, []);
  useEffect(() => {
    uploadSequence.current += 1;
    uploadController.current?.abort();
    uploadController.current = null;
    activeUpload.current = null;
    setPreviewUrl("");
    setSelectedImage(null);
    setImageState("idle");
    setImageError("");
  }, [sessionIdentity]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  const modalOpen = ["review", "submitting", "pending", "success"].includes(submitState);
  useEffect(() => {
    if (modalOpen) {
      if (!previousFocusRef.current && document.activeElement instanceof HTMLElement) previousFocusRef.current = document.activeElement;
      const firstControl = modalRef.current?.querySelector<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])");
      (firstControl || modalRef.current)?.focus();
      wasModalOpenRef.current = true;
      return;
    }
    if (wasModalOpenRef.current) {
      const focusTarget = previousFocusRef.current?.isConnected ? previousFocusRef.current : reviewButtonRef.current;
      focusTarget?.focus();
      previousFocusRef.current = null;
      wasModalOpenRef.current = false;
    }
  }, [modalOpen, submitState]);

  const continueToNodeTrading = useCallback(() => {
    setPrepared(null);
    setSubmitError("");
    setSubmitState("idle");
    window.requestAnimationFrame(() => {
      const trading = document.getElementById(receipt?.pairToken ? "custom-pair-trading" : "node-trading");
      trading?.focus();
      trading?.scrollIntoView({ block: "start" });
    });
  }, [receipt?.pairToken]);

  const handleModalKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && (submitState === "review" || submitState === "success")) {
      if (submitState === "success") continueToNodeTrading();
      else invalidateReview();
      return;
    }
    if (event.key !== "Tab" || !modalRef.current) return;
    const controls = Array.from(modalRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"));
    if (!controls.length) {
      event.preventDefault();
      modalRef.current.focus();
      return;
    }
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!controls.includes(document.activeElement as HTMLElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, [continueToNodeTrading, invalidateReview, submitState]);

  const selectedConfig = useMemo(() => protocol?.configs.find((config) => config.id === draft.configId), [draft.configId, protocol]);
  const exemptions = useMemo(() => exemptionText.split(/[\n,]/).map((value) => value.trim()).filter(Boolean), [exemptionText]);

  const validationError = useMemo(() => {
    const holderBlocker = holderFeeLaunchBlocker(holderFeesRequested);
    if (holderBlocker) return holderBlocker;
    if (!draft.name.trim()) return "Enter a token name.";
    if (draft.name.trim().length > 64) return "Token name must be 64 characters or fewer.";
    if (!draft.symbol.trim()) return "Enter a ticker.";
    if (draft.symbol.trim().length > 16) return "Ticker must be 16 characters or fewer.";
    if (!/^[A-Za-z0-9]+$/.test(draft.symbol.trim())) return "Ticker may contain only letters and numbers.";
    if (draft.description.length > 280) return "Description must be 280 characters or fewer.";
    if (!draft.logo) return imageState === "uploading" ? "Wait for the image upload to finish." : "Provide a token image URI.";
    try {validateImageUri(draft.logo);}catch(error){return errorMessage(error);}
    if (!selectedConfig?.enabled) return "Choose an available launch configuration.";
    if (isCustomPair && (!utils.isAddress(draft.pairToken?.trim() || "") || !pairAsset || pairAsset.address.toLowerCase() !== draft.pairToken?.trim().toLowerCase())) return "Check an approved quote asset before reviewing the launch.";
    if (isCustomPair && Number(draft.developerBuyEth) !== 0) return "Custom pair launches require zero developer buy.";
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(draft.developerBuyEth)) return "Developer buy must be a non-negative ETH amount with up to 18 decimals.";
    if (!holderFeesRequested && draft.creatorFeeRecipient && !utils.isAddress(draft.creatorFeeRecipient)) return "Enter a valid fee recipient address.";
    if (draft.creatorTaxBps < 0 || draft.creatorTaxBps > (protocol?.maxCreatorTaxBps ?? 0)) return `Creator tax must be between 0 and ${(protocol?.maxCreatorTaxBps ?? 0) / 100}%.`;
    if (draft.slippageBps < 0 || draft.slippageBps > 200) return "Slippage must be between 0% and 2%.";
    if (exemptions.length > 32) return "Use no more than 32 exemptions.";
    if (exemptions.some((address) => !utils.isAddress(address))) return "Every exemption must be a valid address.";
    if (new Set(exemptions.map((address) => address.toLowerCase())).size !== exemptions.length) return "Remove duplicate exemption addresses.";
    for (const [label, value] of [["Website", draft.website], ["Discord", draft.discord], ["Farcaster", draft.farcaster]] as const) {
      if (value && !/^https:\/\//i.test(value)) return `${label} must start with https://.`;
    }
    return "";
  }, [draft, exemptions, imageState, protocol, selectedConfig, isCustomPair, pairAsset, holderFeesRequested]);

  const uploadImage = useCallback(async (file: File) => {
    if (!sessionIdentity) {
      setImageState("error");
      setImageError("Sign in to upload an image, or use an existing public image URI.");
      return;
    }
    // A browser can deliver the same File object twice before React commits the
    // uploading state. Keep this fence synchronous so the duplicate does not
    // consume another upload attempt or restart the active request.
    if (activeUpload.current?.file === file && activeUpload.current.sessionIdentity === sessionIdentity && !uploadController.current?.signal.aborted) return;
    const sequence = ++uploadSequence.current;
    const accountSession = sessionIdentity;
    uploadController.current?.abort();
    uploadController.current = null;
    activeUpload.current = null;
    if (!IMAGE_TYPES.has(file.type)) {
      setImageState("error");
      setImageError("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageState("error");
      setImageError("Image must be 4 MB or smaller.");
      return;
    }
    const controller = new AbortController();
    uploadController.current = controller;
    activeUpload.current = { file, sessionIdentity: accountSession };
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setSelectedImage(file);
    setImageState("uploading");
    setImageError("");
    updateDraft("logo", "");
    try {
      const response = await fetch("/api/token-image", { method: "POST", headers: { "Content-Type": file.type }, body: file, signal: controller.signal });
      const payload = await response.json() as { uri?: string; cid?: string; gatewayUrl?: string; error?: string };
      if (!response.ok || !payload.uri) throw new Error(payload.error || "Image upload failed.");
      if (sequence !== uploadSequence.current || uploadSession.current !== accountSession) return;
      updateDraft("logo", payload.uri);
      setImageState("uploaded");
    } catch (error) {
      if (controller.signal.aborted || sequence !== uploadSequence.current || uploadSession.current !== accountSession) return;
      setImageState("error");
      setImageError(errorMessage(error));
    } finally {
      if (sequence === uploadSequence.current && uploadController.current === controller) {
        uploadController.current = null;
        activeUpload.current = null;
      }
    }
  }, [previewUrl, sessionIdentity, updateDraft]);

  const removeImage = useCallback(() => {
    uploadSequence.current += 1;
    uploadController.current?.abort();
    uploadController.current = null;
    activeUpload.current = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    setSelectedImage(null);
    setImageState("idle");
    setImageError("");
    updateDraft("logo", "");
    if (fileInput.current) fileInput.current.value = "";
  }, [previewUrl, updateDraft]);

  function handleConnect() {
    if (walletBusy || walletSelectionOpen) return;
    setWalletError(""); setWalletSelectionOpen(true);
  }

  async function handleDisconnect() {
    if (walletBusy) return;
    walletRegistry.disconnect(); setWallet(null); invalidateReview(); setWalletBusy(true);
    const ticket = walletRegistry.getSelection();
    try {
      const sdk = await boundedWalletRequest(import('../lib/walletconnect-sdk'));
      if (walletRegistry.getSelection() === ticket) await boundedWalletRequest(sdk.disconnectWalletConnect());
    } catch { setWalletError('Disconnected from HOODLABS. If your wallet still lists this session, disconnect it there too.'); }
    finally { setWalletBusy(false); }
  }

  async function handleSwitch() {
    setWalletBusy(true);
    setWalletError("");
    try {
      await boundedWalletRequest(switchToPons());
      await reloadWallet(true);
      await loadProtocol();
    } catch (error) {
      setWalletError(errorMessage(error));
    } finally {
      setWalletBusy(false);
    }
  }

  async function handlePrepare() {
    if (!launchEnabled || holderFeeLaunchBlocker(holderFeesRequested)) return;
    if (!wallet || validationError || !draft.logo.trim() || imageState === "uploading") return;
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) previousFocusRef.current = document.activeElement;
    const generation = prepareGeneration.current + 1;
    prepareGeneration.current = generation;
    const launchDraft = {
      ...holderFeeLaunchDraft(draft, holderFeesRequested, wallet.account),
      name: draft.name.trim(),
      symbol: draft.symbol.trim().toUpperCase(),
      description: draft.description.trim(),
      twitter: normalizeSocialUrl(draft.twitter, "x.com"),
      telegram: normalizeSocialUrl(draft.telegram, "t.me"),
      exemptions,
    };
    setSubmitState("preparing");
    setSubmitError("");
    try {
      const next = await prepareLaunch(launchDraft, wallet);
      if (generation !== prepareGeneration.current) return;
      rememberHolderFeeIntent(next, holderFeesRequested);
      setPrepared(next);
      setSubmitState("review");
    } catch (error) {
      if (generation !== prepareGeneration.current) return;
      setSubmitError(errorMessage(error));
      setSubmitState("error");
    }
  }

  async function handleExecute() {
    if (!launchEnabled) return;
    if (!prepared || !wallet || submitState !== "review") return;
    if (holderFeeLaunchBlocker(preparedHolderFeeIntent(prepared))) { setSubmitError(holderFeeLaunchBlocker(true)); return; }
    setSubmitState("submitting");
    setSubmitError("");
    const account=wallet.account;
    try {
      const result=await executePreparedLaunch(prepared,wallet,hash=>{
        if(walletRef.current?.account!==account)return;
        setTxHash(hash);setStoredOperation(getLaunchOperation(account));setSubmitState("pending");
      },()=>{if(!enabledRef.current)throw new Error("Live launching is no longer enabled.");});
      if(walletRef.current?.account!==account)return;
      setReceipt(result);setTxHash(result.transactionHash);setStoredOperation(null);setSubmitState("success");
      try { setHolderFeeBinding(bindHolderFeeLaunch(prepared, result)); } catch { setHolderFeeBinding(null); }
    }catch(error){
      if(walletRef.current?.account!==account)return;
      setSubmitError(errorMessage(error));
      const state=(error as {submissionState?:string}).submissionState;
      setSubmitState(state==='not-submitted'||state==='reverted'?"error":"unknown");
      try {const op=getLaunchOperation(account);setStoredOperation(op && op.status!=='reverted' && op.status!=='confirmed'?op:null);setTxHash(op?.hash||"");}catch{setSubmitState("unknown");}
      setPrepared(null);
    }
  }
  async function recheckLaunch() {
    if(!wallet || recoveryBusy)return;
    const account=wallet.account;setRecoveryBusy(true);setSubmitError("");
    try {
      const checked=await recoverLaunch(account);
      if(walletRef.current?.account!==account)return;
      if(checked.receipt){setHolderFeeBinding(null);setReceipt(checked.receipt);setStoredOperation(null);setTxHash(checked.receipt.transactionHash);setSubmitState("success");}
      else if(checked.operation.status==='reverted'){setStoredOperation(null);setSubmitState("error");setSubmitError("Launch reverted onchain. Gas was spent; you may prepare a fresh launch.");}
      else{setStoredOperation(checked.operation);setSubmitError(checked.operation.hash?"Waiting for two canonical confirmations. Do not resubmit.":"No transaction hash was returned. Export the recovery record and reconcile wallet activity; do not resubmit.");}
    }catch(error){if(walletRef.current?.account===account)setSubmitError(errorMessage(error));}
    finally{setRecoveryBusy(false);}
  }
  function downloadRecovery() {
    if(!wallet)return;
    try {const blob=new Blob([exportLaunchRecovery(wallet.account)],{type:"application/json"});const uri=URL.createObjectURL(blob);const a=document.createElement("a");a.href=uri;a.download="hoodlaunch-recovery.json";a.click();URL.revokeObjectURL(uri);}catch(error){setSubmitError(errorMessage(error));}
  }

  const wrongChain = Boolean(wallet && wallet.chainId !== PONS_CHAIN_ID);
  const formBusy = ["preparing", "submitting", "pending", "unknown"].includes(submitState) || Boolean(storedOperation);
  const planningContext = { protocol, configId: draft.configId, pairToken: draft.pairToken, pairAsset };
  const planningSnapshot = getPonsPlanningSnapshot(planningContext);
  const planningUnavailable = protocolLoading || Boolean(protocolError) || formBusy || recoveryBusy;
  function applyLaunchPlan(input: PonsPlanInput) {
    const next = applyPonsPlan(draft, input, planningContext, planningUnavailable);
    invalidateReview();
    setDraft(next);
  }

  const mainAction = !launchEnabled ? {label:"Live launching is not enabled yet",action:()=>undefined,disabled:true} : !wallet
    ? { label: walletBusy ? "Connecting…" : "Connect wallet", action: handleConnect, disabled: walletBusy }
    : wrongChain
      ? { label: walletBusy ? "Switching…" : "Switch to PONS Mainnet", action: handleSwitch, disabled: walletBusy }
      : !wallet.canLaunch
        ? { label: "Wallet not eligible to launch", action: () => undefined, disabled: true }
        : { label: storedOperation || submitState === "unknown" ? "Launch status unresolved" : submitState === "preparing" ? "Simulating launch…" : "Review launch", action: handlePrepare, disabled: Boolean(validationError || formBusy || protocolLoading || !draft.logo.trim() || imageState === "uploading") };

  return (
    <main className={styles.page}>
      <a className={styles.skipLink} href="#pro-account">Skip to account</a>
      <nav className={styles.nav} aria-label="Primary navigation">
        <a className={styles.brand} href="https://labs.hoodrich.rip" target="_blank" rel="noreferrer" aria-label="Open HOODLABS website"><span className={styles.brandMark}>H</span><span aria-hidden="true">𝖍𝖔𝖔𝖉𝖑𝖆𝖇𝖘<small>BY HOODRICH</small></span></a>
        <div className={styles.navLinks}><a href="#pro-account"><span>01</span>Account</a><a href="#launch"><span>02</span>Create</a><a href="#wallet-workspace"><span>03</span>Wallets</a></div>
        <div className={styles.walletControls}>
        {wallet ? (
          <button className={styles.walletButton} type="button" onClick={wrongChain ? handleSwitch : undefined} disabled={walletBusy}>
            <span className={wrongChain ? styles.badDot : styles.goodDot} />{wrongChain ? "Wrong network" : shorten(wallet.account)}
          </button>
        ) : <button className={styles.walletButton} type="button" onClick={handleConnect} disabled={walletBusy}><Icon name="wallet" />{walletBusy ? "Connecting…" : "Connect"}</button>}
        {wallet && <><button className={styles.walletButton} type="button" disabled={walletBusy || walletSelectionOpen} onClick={handleConnect}>Change wallet</button><button className={styles.walletButton} type="button" disabled={walletBusy} onClick={() => void handleDisconnect()}>Disconnect</button></>}
        </div>
      </nav>

      <LabHero />
      {proPanel}
      {!launchEnabled && <p className={styles.pendingNotice} role="status">Token launch preview — live launching is not enabled yet. Wallet creation and trading have separate availability below.</p>}
      <WalletWorkspace key={JSON.stringify([sessionIdentity, proEnabled, generationEnabled, nodeTradingEnabled, financeEnabled])} sessionIdentity={sessionIdentity} proEnabled={proEnabled} generationEnabled={generationEnabled} nodeTradingEnabled={nodeTradingEnabled} financeEnabled={financeEnabled} launchedTokenAddress={receipt?.pairToken ? "" : receipt?.tokenAddress || ""}>

      <section id="launch" className={styles.shell} aria-labelledby="launch-title">
        <div className={styles.formPane}>
          <div className={styles.headingRow}>
            <div><p className={styles.eyebrow}>02 / CREATE</p><h2 id="launch-title">Create your token</h2><p>Add the essentials, choose a pair, then review live PONS terms.</p></div>
            <span className={styles.chainBadge}>Chain 4663</span>
          </div>

          {protocolError && <div className={styles.alert} role="alert"><span>{protocolError}</span><button type="button" onClick={loadProtocol}>Retry</button></div>}
          {walletError && <div className={styles.alert} role="alert"><span>{walletError}</span><button type="button" onClick={() => setWalletError("")} aria-label="Dismiss wallet error"><Icon name="close" /></button></div>}
          {wallet && !wrongChain && !wallet.canLaunch && <div className={styles.alert} role="status"><span>This account is not currently eligible to launch. Access was checked onchain.</span></div>}

          <div className={styles.twoFields}>
            <label className={styles.field}><span>Name</span><input value={draft.name} maxLength={64} onChange={(event) => updateDraft("name", event.target.value)} placeholder="Token name" autoComplete="off" /></label>
            <label className={styles.field}><span>Ticker</span><input value={draft.symbol} maxLength={16} onChange={(event) => updateDraft("symbol", event.target.value.toUpperCase())} placeholder="SYMBOL" autoCapitalize="characters" autoComplete="off" /></label>
          </div>
          <label className={styles.field}><span>Description <small>{draft.description.length}/280</small></span><textarea value={draft.description} maxLength={280} onChange={(event) => updateDraft("description", event.target.value)} placeholder="A short description of the token" rows={3} /></label>

          <div className={styles.field}>
            <span>Token image</span>
            {sessionIdentity ? <div
              className={`${styles.dropzone} ${dragging ? styles.dragging : ""}`}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) void uploadImage(file); }}
            >
              {previewUrl ? <img className={styles.imagePreview} src={previewUrl} alt="Selected token artwork preview" /> : <span className={styles.imagePlaceholder}><Icon name="image" /></span>}
              <div className={styles.uploadCopy}>
                <button type="button" className={styles.textButton} onClick={() => fileInput.current?.click()}>{previewUrl ? "Replace image" : "Choose image"}</button>
                <small>PNG, JPEG or WebP · 4 MB max · Uploads are public on IPFS.</small>
                {imageState === "uploading" && <span className={styles.uploadStatus}><Icon name="spinner" /> Uploading…</span>}
                {imageState === "uploaded" && <span className={styles.successText}><Icon name="check" /> Uploaded</span>}
              </div>
              {previewUrl && <button type="button" className={styles.removeImage} onClick={removeImage} aria-label="Remove token image"><Icon name="close" /></button>}
              <input ref={fileInput} className={styles.hiddenInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) void uploadImage(file); }} aria-label="Choose token image" />
            </div> : <div className={styles.guestUpload}><Icon name="image" /><span><strong>Upload from your device</strong><small>Free and Pro · 4 MB max · uploads are public on IPFS.</small></span><a href="#pro-account">Sign in to upload</a></div>}
            <details className={styles.inlineDisclosure}><summary>Use an existing image URI</summary><label className={styles.field}><span>Public image URI</span><input value={draft.logo} maxLength={2048} placeholder="ipfs://… or https://…" aria-label="Token image URI" onChange={event=>{uploadSequence.current++;uploadController.current?.abort();uploadController.current=null;activeUpload.current=null;if(previewUrl)URL.revokeObjectURL(previewUrl);setPreviewUrl("");setSelectedImage(null);setImageState("idle");setImageError("");updateDraft("logo",event.target.value);}} /><small>Available without an account. IPFS and HTTPS images must already be public.</small></label></details>
            {imageState === "error" && <div className={styles.inlineError} role="alert"><span>{imageError}</span>{selectedImage && <button type="button" onClick={() => void uploadImage(selectedImage)}>Retry upload</button>}</div>}
          </div>

          <label className={styles.field}><span>Website <small>optional</small></span><input type="url" value={draft.website} onChange={(event) => updateDraft("website", event.target.value)} placeholder="https://your-token.com" autoComplete="url" /><small>Your token’s official website, included in its PONS launch details.</small></label>

          <div id="pair-research"><PairSelector pairToken={draft.pairToken} onPairChange={changePair} disabled={formBusy} /></div>
          <label className={styles.field}><span>Launch configuration</span><span className={styles.selectWrap}><select value={draft.configId} onChange={(event) => updateDraft("configId", event.target.value)} disabled={protocolLoading || !protocol}><option value="">{protocolLoading ? "Loading live configurations…" : "Choose configuration"}</option>{protocol?.configs.filter((config) => config.enabled).map((config) => <option key={config.id} value={config.id}>{config.id} · {pairLabel} pair</option>)}</select><Icon name="chevron" /></span>{protocol && !protocolLoading && !protocol.configs.some((config) => config.enabled) && <small role="status">No launch configurations are currently enabled.</small>}</label>
          <dl className={styles.configDetails} aria-label="Selected launch configuration terms">
            <div><dt>Total supply</dt><dd>{formatTokenSupply(selectedConfig?.supplyWei)}</dd></div>
            <div><dt>Pool fee</dt><dd>{formatPoolFee(selectedConfig?.poolFee)}</dd></div>
            <div><dt>Liquidity</dt><dd>{selectedConfig ? "Permanent at graduation" : "—"}</dd></div>
          </dl>

          <label className={styles.field}><span>Developer buy <small>optional · ETH only</small></span><div className={styles.amountField}><input inputMode="decimal" disabled={isCustomPair} value={draft.developerBuyEth} onChange={(event) => updateDraft("developerBuyEth", event.target.value)} aria-label="Developer buy in ETH" /><strong>ETH</strong></div><small>{isCustomPair ? "Zero for custom quote assets. After launch, use PONS to buy with the selected asset; ETH still pays gas." : "Bought in the launch transaction. Network gas is additional."}</small></label>

          <div className={styles.advancedBlock}>
            <button className={styles.advancedToggle} type="button" onClick={() => setAdvanced((value) => !value)} aria-expanded={advanced} aria-controls="advanced-launch-settings"><span>Advanced launch settings</span><span className={advanced ? styles.chevronOpen : ""}><Icon name="chevron" /></span></button>
            {advanced && <div id="advanced-launch-settings" className={styles.advancedFields}>
              <PonsLaunchPlan snapshot={planningSnapshot} creatorTaxBps={draft.creatorTaxBps} developerBuyEth={draft.developerBuyEth} disabledReason={planningUnavailable ? "Finish the current operation or wait for PONS settings to load." : !planningSnapshot ? "Choose an available PONS configuration and a verified pair to plan your launch." : ""} onApply={applyLaunchPlan} />
              <div className={styles.twoFields}>
                <label className={styles.field}><span>X profile</span><input value={draft.twitter} onChange={(event) => updateDraft("twitter", event.target.value)} placeholder="x.com/handle" autoComplete="url" /></label>
                <label className={styles.field}><span>Telegram</span><input value={draft.telegram} onChange={(event) => updateDraft("telegram", event.target.value)} placeholder="t.me/community" autoComplete="url" /></label>
              </div>
              {!holderFeesRequested && <label className={styles.field}><span>Fee recipient <small>defaults to connected wallet</small></span><input value={draft.creatorFeeRecipient} onChange={(event) => updateDraft("creatorFeeRecipient", event.target.value)} placeholder="0x…" autoComplete="off" /></label>}
              <div className={styles.twoFields}>
                <label className={styles.field}><span>Creator tax (%)</span><input type="number" min="0" max={(protocol?.maxCreatorTaxBps ?? 0) / 100} step="0.01" value={draft.creatorTaxBps / 100} onChange={(event) => updateDraft("creatorTaxBps", Math.round(Number(event.target.value || 0) * 100))} /></label>
                <label className={styles.field}><span>Slippage (%)</span><input type="number" min="0" max="2" step="0.01" value={draft.slippageBps / 100} onChange={(event) => updateDraft("slippageBps", Math.round(Number(event.target.value || 0) * 100))} /></label>
              </div>
              <label className={styles.checkField}><input type="checkbox" checked={draft.buybackEnabled} onChange={(event) => updateDraft("buybackEnabled", event.target.checked)} /><span><strong>Enable buyback</strong><small>Use the protocol’s configured buyback behavior.</small></span></label>
              <div className={styles.twoFields}>
                <label className={styles.field}><span>Discord</span><input value={draft.discord} onChange={(event) => updateDraft("discord", event.target.value)} placeholder="discord.gg/" autoComplete="url" /></label>
              </div>
              <label className={styles.field}><span>Farcaster</span><input value={draft.farcaster} onChange={(event) => updateDraft("farcaster", event.target.value)} placeholder="warpcast.com/" autoComplete="url" /></label>
              <label className={styles.field}><span>Tax exemptions <small>{exemptions.length}/32 · one address per line</small></span><textarea value={exemptionText} onChange={(event) => { invalidateReview(); setExemptionText(event.target.value); }} placeholder="0x…" rows={3} /></label>
              <label className={styles.checkField}><input type="checkbox" checked={holderFeesRequested} disabled={formBusy} onChange={(event) => { invalidateReview(); setHolderFeesRequested(event.target.checked); }} /><span><strong>Holder fee sharing <small>Free</small></strong><small>Currently unavailable pending contract verification. Selecting this blocks launch preparation.</small></span></label>
            </div>}
          </div>

          <div className={styles.actionArea}>
            {validationError && wallet && !wrongChain && <p className={styles.validationHint}>{validationError}</p>}
            {submitState === "error" && <div className={styles.alert} role="alert"><span>{submitError}</span><button type="button" onClick={handlePrepare}>Retry</button></div>}
            {submitState === "unknown" && <div className={styles.pendingNotice} role="status"><strong>Launch status is unresolved.</strong><button type="button" onClick={recheckLaunch} disabled={recoveryBusy}>{recoveryBusy?"Checking chain…":"Recheck launch status"}</button><button type="button" onClick={downloadRecovery} disabled={!storedOperation}>Export recovery record</button>{submitError && <span role="alert">{submitError}</span>}<span>Do not resubmit. Check your wallet{txHash ? " or the explorer" : " activity"} before taking any action.</span>{txHash && <><code>{txHash}</code><a href={`${PONS_EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer">Check transaction <Icon name="external" /></a></>}</div>}
            <div className={styles.feeLine}><span>{pairLabel} pair · launch fee in ETH</span><strong>{protocolLoading ? "Loading…" : `${formatEth(protocol?.launchFeeWei)} ETH`}</strong></div>
            <button ref={reviewButtonRef} className={styles.primaryButton} type="button" onClick={mainAction.action} disabled={mainAction.disabled}>{mainAction.label}</button>
          </div>
        </div>

        <aside className={styles.previewPane} aria-label="Token preview and current launch terms">
          <div className={styles.previewCard}>
            <div className={styles.previewImage}>{previewUrl ? <img src={previewUrl} alt="" /> : <Icon name="image" />}</div>
            <h2>{draft.name.trim() || "Your token"}</h2>
            <p className={styles.ticker}>{draft.symbol.trim() ? `$${draft.symbol.trim().toUpperCase()}` : "TICKER"}</p>
            {draft.description && <p className={styles.previewDescription}>{draft.description}</p>}
            <dl className={styles.terms}>
              <div><dt>Launch fee</dt><dd>{protocolLoading ? "Loading…" : `${formatEth(protocol?.launchFeeWei)} ETH`}</dd></div>
              <div><dt>Paired with</dt><dd>{pairLabel}</dd></div>
              {isCustomPair && pairAsset && <div><dt>Quote contract</dt><dd title={pairAsset.address}>{shorten(pairAsset.address)}</dd></div>}
              <div><dt>Trade fee</dt><dd>{selectedConfig ? `${(selectedConfig.curveFeeBps / 100).toFixed(2)}%` : "—"}</dd></div>
              <div><dt>Total supply</dt><dd>{formatTokenSupply(selectedConfig?.supplyWei)}</dd></div>
              <div><dt>Pool fee</dt><dd>{formatPoolFee(selectedConfig?.poolFee)}</dd></div>
              {protocol?.snipeTaxBps !== undefined && <div><dt>Launch protection</dt><dd>{(protocol.snipeTaxBps / 100).toFixed(2)}% · {protocol.snipeWindowSeconds ?? 0}s</dd></div>}
              <div><dt>Graduation</dt><dd>{isCustomPair ? pairAsset ? `${utils.formatUnits(pairAsset.graduationThresholdWei, pairAsset.decimals)} ${pairAsset.symbol}` : "—" : selectedConfig ? `${formatEth(selectedConfig.graduationThresholdWei)} ETH` : "—"}</dd></div>
              <div><dt>Liquidity</dt><dd>{selectedConfig ? "Permanent at graduation" : "—"}</dd></div>
            </dl>
            <div className={styles.trustNote}><span className={wallet?.canLaunch ? styles.goodDot : styles.neutralDot} /><p><strong>{wallet?.canLaunch ? "Wallet eligible" : "Eligibility checked on connect"}</strong><small>Audit status is not asserted by this interface. Verify deployed protocol addresses before launch.</small></p></div>
          </div>
        </aside>
      </section>

      {receipt && <><TokenLinks address={receipt.tokenAddress} /><HolderFeeSharing receipt={receipt} wallet={wallet} requested={holderFeeBinding?.transactionHash === receipt.transactionHash && holderFeeBinding.token === receipt.tokenAddress ? holderFeeBinding.requested : null} /></>}
      {receipt?.pairToken && <section id="custom-pair-trading" className={styles.pendingNotice} tabIndex={-1} aria-label="Custom pair trading">
        <strong>Your custom pair is ready on PONS.</strong><span>Quote asset: {receipt.pairToken}. Generated-node trading here supports native ETH pairs. Use PONS for this token’s buys and sells; keep Robinhood ETH for gas.</span>
        <a href={`https://www.ponsfamily.com/launchpad/${receipt.tokenAddress}`} target="_blank" rel="noopener noreferrer">Open this token on PONS →</a>
      </section>}
      </WalletWorkspace>
      <footer className={styles.resourceFooter}><strong>HOODLABS resources</strong><nav aria-label="HOODLABS resources"><a href="/guide" target="_blank" rel="noopener noreferrer">How it works</a><a href="/pro" target="_blank" rel="noopener noreferrer">Free vs Pro</a><a href="/exchanges" target="_blank" rel="noopener noreferrer">Fund wallets</a><a href="/security" target="_blank" rel="noopener noreferrer">Security</a></nav></footer>

      {prepared && submitState === "review" && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) invalidateReview(); }}>
        <section ref={modalRef} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="review-title" tabIndex={-1} onKeyDown={handleModalKeyDown}>
          <button className={styles.modalClose} type="button" onClick={invalidateReview} aria-label="Close launch review"><Icon name="close" /></button>
          <p className={styles.eyebrow}>Final wallet confirmation follows</p><h2 id="review-title">Review launch</h2><p>Simulation succeeded. Check every value before submitting this transaction to PONS Mainnet.</p>
          <dl className={styles.reviewList}>
            <div><dt>Network</dt><dd>PONS Mainnet · 4663</dd></div>
            <div><dt>Account</dt><dd title={prepared.account}>{shorten(prepared.account, 10, 8)}</dd></div>
            <div><dt>Token</dt><dd>{prepared.name} · ${prepared.symbol}</dd></div>
            <div><dt>Quote asset</dt><dd>{prepared.pair ? `${prepared.pair.symbol} · ${prepared.pair.address}` : "Native ETH"}</dd></div>
            {prepared.pair && <div><dt>Quote decimals</dt><dd>{prepared.pair.decimals}</dd></div>}
            <div><dt>Holder fee sharing</dt><dd>{preparedHolderFeeIntent(prepared) ? "Requested · setup unavailable" : "Not selected"}</dd></div>
            <div><dt>Initial fee recipient</dt><dd title={prepared.creatorFeeRecipient}>{shorten(prepared.creatorFeeRecipient, 10, 8)}</dd></div>
            <div><dt>Launch fee</dt><dd>{formatEth(prepared.launchFeeWei)} ETH</dd></div>
            <div><dt>Developer buy</dt><dd>{prepared.pair ? "None · buy separately on PONS" : `${formatEth(prepared.developerBuyWei)} ETH`}</dd></div>
            <div><dt>Total value</dt><dd>{formatEth(prepared.totalValueWei)} ETH</dd></div>
            <div><dt>Estimated gas</dt><dd>{formatEth(prepared.estimatedGasWei)} ETH</dd></div>
            <div><dt>Minimum tokens out</dt><dd>{prepared.minTokensOut}</dd></div>
            <div><dt>Economics</dt><dd>{prepared.expectedEconomics}</dd></div>
          </dl>
          {preparedHolderFeeIntent(prepared) && <p>Launching does not enable sharing. PONS holder setup requires up to two more wallet approvals and gas after launch. HOODLABS setup remains blocked pending contract verification; the launch wallet initially receives creator fees.</p>}
          <div className={styles.modalActions}><button type="button" className={styles.secondaryButton} onClick={invalidateReview}>Back to edit</button><button type="button" className={styles.primaryButton} onClick={handleExecute}>Confirm launch</button></div>
        </section>
      </div>}

      {["submitting", "pending"].includes(submitState) && <div className={styles.modalBackdrop}><section ref={modalRef} className={`${styles.modal} ${styles.statusModal}`} role="status" aria-live="polite" tabIndex={-1} onKeyDown={handleModalKeyDown}><span className={styles.largeSpinner}><Icon name="spinner" /></span><h2>{submitState === "submitting" ? "Confirm in wallet" : "Launch pending"}</h2><p>{submitState === "submitting" ? "Review and approve the launch transaction in your wallet." : "Your transaction was submitted. Keep this page open while it confirms."}</p>{txHash && <code>{txHash}</code>}</section></div>}

      {receipt && submitState === "success" && <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) continueToNodeTrading(); }}><section ref={modalRef} className={`${styles.modal} ${styles.statusModal}`} role="dialog" aria-modal="true" aria-labelledby="success-title" tabIndex={-1} onKeyDown={handleModalKeyDown}><span className={styles.successIcon}><Icon name="check" /></span><p className={styles.eyebrow}>Verified onchain</p><h2 id="success-title">Token launched</h2><TokenLinks address={receipt.tokenAddress} /><p>Your token and bonding curve are live on PONS Mainnet.</p>{holderFeeBinding?.requested && <p>Holder sharing is still pending. No holder fee setup transaction has been requested.</p>}<dl className={styles.reviewList}><div><dt>Token</dt><dd><a href={`${PONS_EXPLORER}/address/${receipt.tokenAddress}`} target="_blank" rel="noreferrer">{shorten(receipt.tokenAddress, 10, 8)} <Icon name="external" /></a></dd></div><div><dt>Curve</dt><dd><a href={`${PONS_EXPLORER}/address/${receipt.curveAddress}`} target="_blank" rel="noreferrer">{shorten(receipt.curveAddress, 10, 8)} <Icon name="external" /></a></dd></div><div><dt>Transaction</dt><dd>{shorten(receipt.transactionHash, 10, 8)}</dd></div></dl><div className={styles.modalActions}><button className={styles.primaryButton} type="button" onClick={continueToNodeTrading}>{receipt.pairToken ? "Close launch receipt" : "Continue to node trading"}</button><a className={styles.secondaryButton} href={receipt.explorerUrl} target="_blank" rel="noreferrer">View verified transaction <Icon name="external" /></a></div></section></div>}
      {walletSelectionOpen && <WalletConnection onClose={() => setWalletSelectionOpen(false)} onConnected={() => { setWalletSelectionOpen(false); void reloadWallet(true); }} onMobileFallback={() => { setWalletSelectionOpen(false); setMobileWalletOpen(true); }} />}
      <MobileWalletConnect open={mobileWalletOpen} onClose={() => setMobileWalletOpen(false)} onProviderReady={handleConnect} />
    </main>
  );
}
