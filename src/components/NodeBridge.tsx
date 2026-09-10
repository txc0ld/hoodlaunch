import { useEffect, useRef, useState } from "react";
import { utils } from "ethers";
import {
  executeNodeBridge,
  prepareNodeBridge,
} from "../lib/node-vault";
import type { NodeSession } from "../lib/node-vault";
import {
  getNodeBridgeOperation,
  refreshNodeBridgeOperation,
} from "../lib/relay-bridge";
import type { NodeBridgeOperation, NodeBridgeReview } from "../lib/relay-bridge";
import styles from "./NodeBridge.module.css";

type Action = "idle" | "preparing" | "executing" | "refreshing";

function safeMessage(value: unknown) {
  const text = value instanceof Error ? value.message : "The bridge operation failed.";
  return text.replace(/[\r\n\t]+/g, " ").slice(0, 300);
}

function eth(wei: string) {
  try {
    return utils.formatEther(wei);
  } catch {
    return "Unavailable";
  }
}

function gwei(wei: string) {
  try {
    return utils.formatUnits(wei, "gwei");
  } catch {
    return "Unavailable";
  }
}

function statusLabel(status: NodeBridgeOperation["status"]) {
  if (status === "pending") return "Ethereum broadcast pending";
  if (status === "source-confirmed") return "Ethereum confirmed · Robinhood pending";
  if (status === "complete") return "Destination confirmed on Robinhood Chain";
  if (status === "refunded") return "Refund reported · reconcile manually";
  return "Outcome unknown · reconcile manually";
}

export interface NodeBridgeProps {
  session: NodeSession;
  nodeIndex: number;
}

export default function NodeBridge({ session, nodeIndex }: NodeBridgeProps) {
  const address = session.addresses[nodeIndex] || "";
  const [amountEth, setAmountEth] = useState("0.005");
  const [review, setReview] = useState<NodeBridgeReview | null>(null);
  const [operation, setOperation] = useState<NodeBridgeOperation | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [action, setAction] = useState<Action>("idle");
  const [error, setError] = useState("");
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const generationRef = useRef(0);
  const actionRef = useRef<Action>("idle");
  const consumedReviewRef = useRef<string | null>(null);

  function readRecoveryRecord() {
    try {
      const current = getNodeBridgeOperation(address);
      setOperation(current);
      setStorageBlocked(false);
      return current;
    } catch (caught) {
      setStorageBlocked(true);
      setError(safeMessage(caught));
      return null;
    }
  }

  useEffect(() => {
    generationRef.current += 1;
    actionRef.current = "idle";
    consumedReviewRef.current = null;
    setAmountEth("0.005");
    setReview(null);
    setConfirmed(false);
    setAction("idle");
    setError("");
    setStorageBlocked(false);
    readRecoveryRecord();
    return () => {
      generationRef.current += 1;
      actionRef.current = "idle";
    };
  }, [session, nodeIndex, address]);

  useEffect(() => {
    if (!review) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [review]);

  const expired = Boolean(review && now >= review.expiresAt);
  const operationBlocksNewBridge = Boolean(operation && operation.status !== "complete");
  const amountValid = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(amountEth) && (() => {
    try { return utils.parseEther(amountEth).gt(0); } catch { return false; }
  })();

  function updateAmount(value: string) {
    generationRef.current += 1;
    consumedReviewRef.current = null;
    setAmountEth(value);
    setReview(null);
    setConfirmed(false);
    setError("");
  }

  async function handlePrepare() {
    if (!address || !amountValid || operationBlocksNewBridge || storageBlocked || actionRef.current !== "idle") return;
    const generation = ++generationRef.current;
    const expectedSession = session;
    actionRef.current = "preparing";
    setAction("preparing");
    setError("");
    setReview(null);
    setConfirmed(false);
    consumedReviewRef.current = null;
    try {
      const prepared = await prepareNodeBridge(session, nodeIndex, amountEth);
      if (generation !== generationRef.current || expectedSession !== session) return;
      if (prepared.nodeAddress.toLowerCase() !== address.toLowerCase() || prepared.nodeIndex !== nodeIndex) {
        throw new Error("The bridge quote belongs to another node.");
      }
      setReview(prepared);
      setNow(Date.now());
    } catch (caught) {
      if (generation === generationRef.current) setError(safeMessage(caught));
    } finally {
      if (generation === generationRef.current) {
        actionRef.current = "idle";
        setAction("idle");
      }
    }
  }

  async function handleExecute() {
    if (!review || expired || !confirmed || operationBlocksNewBridge || storageBlocked || actionRef.current !== "idle" || consumedReviewRef.current === review.requestId) return;
    const generation = ++generationRef.current;
    const submittedReview = review;
    consumedReviewRef.current = submittedReview.requestId;
    actionRef.current = "executing";
    setAction("executing");
    setConfirmed(false);
    setError("");
    try {
      const next = await executeNodeBridge(session, submittedReview);
      if (generation !== generationRef.current) return;
      setOperation(next);
      setReview(null);
    } catch (caught) {
      if (generation !== generationRef.current) return;
      setReview(null);
      setError(safeMessage(caught));
      readRecoveryRecord();
    } finally {
      if (generation === generationRef.current) {
        actionRef.current = "idle";
        setAction("idle");
      }
    }
  }

  async function handleRefresh() {
    if (!operation || actionRef.current !== "idle") return;
    const generation = ++generationRef.current;
    actionRef.current = "refreshing";
    setAction("refreshing");
    setError("");
    try {
      const next = await refreshNodeBridgeOperation(address);
      if (generation !== generationRef.current) return;
      setOperation(next);
    } catch (caught) {
      if (generation === generationRef.current) setError(safeMessage(caught));
    } finally {
      if (generation === generationRef.current) {
        actionRef.current = "idle";
        setAction("idle");
      }
    }
  }

  return (
    <div className={styles.bridge} aria-label={`Node ${nodeIndex + 1} Relay bridge`}>
      <div className={styles.controls}>
        <label><span>ETH to bridge</span><input aria-label={`Node ${nodeIndex + 1} bridge amount`} value={amountEth} onChange={(event) => updateAmount(event.target.value)} inputMode="decimal" maxLength={80} aria-invalid={!amountValid} disabled={action !== "idle" || operationBlocksNewBridge || storageBlocked} /></label>
        <button className={styles.bridgeButton} type="button" onClick={handlePrepare} disabled={!amountValid || action !== "idle" || operationBlocksNewBridge || storageBlocked}>{action === "preparing" ? "Getting Relay quote…" : "Bridge to Robinhood Chain"}</button>
      </div>
      {!amountValid && <p className={styles.fieldError} role="alert">Enter a positive ETH amount with no more than 18 decimal places.</p>}
      {error && <div className={styles.alert} role="alert"><span>{error}</span><button type="button" onClick={() => setError("")}>Dismiss</button></div>}
      {storageBlocked && <button className={styles.secondaryButton} type="button" onClick={readRecoveryRecord} disabled={action !== "idle"}>Retry bridge history check</button>}

      {review && <div className={styles.review} aria-live="polite">
        <div className={styles.reviewHeading}><div><span>Relay quote</span><strong>Ethereum → Robinhood Chain</strong></div><em className={expired ? styles.expired : styles.ready}>{expired ? "Expired" : `${Math.max(0, Math.ceil((review.expiresAt - now) / 1000))}s left`}</em></div>
        <code className={styles.fullAddress}>{review.nodeAddress}</code>
        <dl className={styles.details}>
          <div><dt>Source</dt><dd>Ethereum · chain 1</dd></div>
          <div><dt>Destination</dt><dd>Robinhood Chain · 4663</dd></div>
          <div><dt>Bridge input</dt><dd>{eth(review.amountWei)} ETH</dd></div>
          <div><dt>Expected output</dt><dd>{eth(review.expectedOutputWei)} ETH</dd></div>
          <div><dt>Minimum output</dt><dd>{eth(review.minimumOutputWei)} ETH</dd></div>
          <div><dt>Relay fee</dt><dd>{eth(review.relayFeeWei)} ETH</dd></div>
          <div><dt>Maximum gas</dt><dd>{eth(review.maxGasCostWei)} ETH</dd></div>
          <div><dt>Maximum total</dt><dd>{eth(review.maxTotalWei)} ETH</dd></div>
          <div><dt>Ethereum balance</dt><dd>{eth(review.sourceBalanceWei)} ETH</dd></div>
          <div><dt>Balance after maximum cost</dt><dd>{eth(review.balanceAfterMaxCostWei)} ETH</dd></div>
          <div><dt>Gas limit</dt><dd>{review.gasLimit}</dd></div>
          <div><dt>Max fee / priority</dt><dd>{gwei(review.maxFeePerGasWei)} / {gwei(review.maxPriorityFeePerGasWei)} gwei</dd></div>
          <div><dt>Maximum slippage</dt><dd>{review.slippageBps / 100}%</dd></div>
          <div><dt>Recipient and refund</dt><dd>Same node address</dd></div>
        </dl>
        <p className={styles.disclaimer}>This signs one native ETH deposit from this node on Ethereum. Relay’s minimum output applies only to a successful bridge; the protocol refund minimum is zero, so a refund amount is not guaranteed. Relay status alone does not prove the ETH is ready for PONS.</p>
        <label className={styles.confirm}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={action !== "idle" || expired} /><span>I checked the full address, both chain IDs, bridge amount, minimum output, Relay fee, maximum Ethereum gas, and accept Relay fill and refund risk.</span></label>
        <button className={styles.confirmButton} type="button" onClick={handleExecute} disabled={!confirmed || expired || action !== "idle" || consumedReviewRef.current === review.requestId}>{action === "executing" ? "Signing and broadcasting…" : "Confirm Relay bridge"}</button>
        {expired && <button className={styles.secondaryButton} type="button" onClick={handlePrepare} disabled={action !== "idle"}>Get a fresh quote</button>}
      </div>}

      {operation && <div className={`${styles.operation} ${operation.status === "complete" ? styles.complete : operation.status === "unknown" || operation.status === "refunded" ? styles.problem : ""}`} role="status">
        <div><span>Relay bridge status</span><strong>{statusLabel(operation.status)}</strong></div>
        <p>{operation.message}</p>
        <dl><div><dt>Relay request</dt><dd>{operation.requestId}</dd></div><div><dt>Ethereum transaction</dt><dd>{operation.sourceTxHash}</dd></div>{operation.destinationTxHash && <div><dt>Robinhood transaction</dt><dd>{operation.destinationTxHash}</dd></div>}</dl>
        <button className={styles.secondaryButton} type="button" onClick={handleRefresh} disabled={action !== "idle"}>{action === "refreshing" ? "Checking Relay and both chains…" : "Refresh bridge status"}</button>
        {operation.status === "complete" && <small>Destination receipt and same-block balance increase were confirmed. You may prepare another bridge for this node.</small>}
        {operation.status !== "complete" && <small>This node cannot start another bridge while this record is unresolved.</small>}
      </div>}
    </div>
  );
}
