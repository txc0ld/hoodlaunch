import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BigNumber, utils } from "ethers";
import {
  executeNodeTrade,
  prepareNodeTrade,
} from "../lib/node-vault";
import type { NodeSession } from "../lib/node-vault";
import {
  getNodeTradeOperation,
  refreshNodeTradeOperation,
} from "../lib/node-trading";
import type { NodeTradeOperation, NodeTradeReview } from "../lib/node-trading";
import { prepareNodeTradeBatch, executeNodeTradeBatch } from "../lib/node-trade-batch";
import type { NodeTradeBatch, NodeTradeBatchResult } from "../lib/node-trade-batch";
import { getNodeTradingSnapshot, copyTradeAmount, parseTradeAmount } from "../lib/pons-trade";
import type { NodeTradePercent, NodeTradeAmount, NodeTradeSide, NodeTradingSnapshot } from "../lib/pons-trade";
import styles from "./NodeTrading.module.css";

const PERCENTS: readonly NodeTradePercent[] = [5, 10, 25, 50, 100];
const STATUS_REFRESH_DEADLINE_MS = 20_000;
const HOLDINGS_REFRESH_RETRIES = 3;
const STATUS_REFRESH_CONCURRENCY = 3;
const statusReads = new Map<string, Promise<NodeTradeOperation>>();
const snapshotReads = new Map<string, Promise<NodeTradingSnapshot>>();

type Action = "idle" | "loading" | "preparing" | "executing" | "refreshing";
type SubmissionOutcome = { label: string; error: string };
type RefreshProgress = { checked: number; total: number; failures: number };
type OperationIdentity = Pick<NodeTradeOperation, "nodeAddress" | "txHash" | "tokenAddress" | "status">;

function submissionOutcome(operation: NodeTradeOperation): SubmissionOutcome {
  if (operation.status === "pending") return { label: "Submitted · awaiting confirmation", error: "" };
  if (operation.status === "confirmed") return { label: "Confirmed on Robinhood Chain", error: "" };
  if (operation.status === "unknown") return { label: "Outcome unknown", error: operation.message };
  return { label: "Transaction failed", error: operation.message };
}

function safeMessage(value: unknown) {
  const text = value instanceof Error ? value.message : "The trading operation failed.";
  return text.replace(/[\r\n\t]+/g, " ").slice(0, 300);
}

function shortAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function formatEth(wei: string) {
  try { return utils.formatEther(wei); } catch { return "Unavailable"; }
}

function formatToken(raw: string, decimals: number) {
  try { return utils.commify(utils.formatUnits(raw, decimals)); } catch { return "Unavailable"; }
}

function visualNumber(value: string) {
  if (!value.includes(".")) return value;
  const [whole, fraction] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed.length > 6 ? `${whole}.${trimmed.slice(0, 6)}…` : trimmed ? `${whole}.${trimmed}` : whole;
}

function gwei(wei: string) {
  try { return utils.formatUnits(wei, "gwei"); } catch { return "Unavailable"; }
}

function proportionalRateMinimum(review: NodeTradeReview) {
  if (!review.minimumIsRateBound) return review.minimumOutputRaw;
  try {
    const submitted = BigNumber.from(review.amountInRaw);
    if (submitted.isZero()) return "0";
    return BigNumber.from(review.minimumOutputRaw).mul(review.expectedSpendWei).div(submitted).toString();
  } catch {
    return review.minimumOutputRaw;
  }
}

function actionLabel(action: NodeTradeReview["action"]) {
  if (action === "approve-token") return "Exact token approval";
  if (action === "approve-router") return "Expiring router approval";
  return action === "buy" ? "Token purchase" : "Token sale";
}

function operationLabel(operation: NodeTradeOperation) {
  if (operation.status === "pending") return "Robinhood transaction pending";
  if (operation.status === "confirmed") return operation.action.startsWith("approve") ? "Approval confirmed · prepare sell again" : "Trade confirmed on Robinhood Chain";
  if (operation.status === "failed") return "Transaction failed · gas was spent";
  return "Outcome unknown · do not resubmit";
}

function refreshedBatchOutcome(results: readonly NodeTradeBatchResult[], batch: NodeTradeBatch | null): SubmissionOutcome {
  const operations = results.flatMap((result) => result.operation ? [result.operation] : []);
  const unsent = results.filter((result) => result.status === "error" || result.status === "not-submitted");
  const unknownResult = results.find((result) => result.operation?.status === "unknown");
  const failedResult = results.find((result) => result.operation?.status === "failed");
  const unknown = unknownResult?.operation;
  const failed = failedResult?.operation;
  const pending = operations.some((operation) => operation.status === "pending");
  if (unsent.length) {
    const deferredNodeIndexes = new Set(batch?.entries.filter((entry) => entry.status === "deferred").map((entry) => entry.nodeIndex));
    const deferredSales = unsent.filter((result) => deferredNodeIndexes.has(result.nodeIndex));
    const actionable = results.find((result) => result.status === "error" || result.status === "unknown" || result.operation?.status === "unknown" || result.operation?.status === "failed");
    const evidence = actionable || unsent.find((result) => !deferredSales.includes(result)) || deferredSales[0];
    const reason = evidence
      ? `Node ${evidence.nodeIndex + 1}: ${evidence.operation?.status === "unknown" || evidence.operation?.status === "failed" ? evidence.operation.message : evidence.error || "Check this node's result below."}`
      : "Check each node's result below.";
    const failedApprovals = deferredSales.length ? unsent.filter((result) => result.status === "error").length : 0;
    const skippedApprovals = deferredSales.length ? unsent.length - deferredSales.length - failedApprovals : 0;
    const unsentSummary = deferredSales.length
      ? `${deferredSales.length} sale${deferredSales.length === 1 ? " was" : "s were"} deliberately deferred. ${failedApprovals} approval${failedApprovals === 1 ? "" : "s"} failed and ${skippedApprovals} action${skippedApprovals === 1 ? " was" : "s were"} skipped.`
      : `${unsent.length} node${unsent.length === 1 ? " was" : "s were"} not submitted.`;
    const receiptState = unknown ? evidence === unknownResult ? "" : ` Node ${unknownResult.nodeIndex + 1} has an unknown submitted outcome. ${unknown.message}`
      : failed ? evidence === failedResult ? "" : ` Node ${failedResult.nodeIndex + 1} has a failed submitted transaction. ${failed.message}`
      : pending ? " Submitted transactions are still awaiting confirmation."
      : operations.length ? operations.every((operation) => operation.action.startsWith("approve"))
        ? " Submitted approvals are confirmed; choose Sell Max All Nodes again for the remaining nodes."
        : " Submitted transactions are confirmed."
      : "";
    return {
      label: operations.length ? "Some nodes submitted · others not submitted" : "Could not submit",
      error: `${unsentSummary} ${reason}${receiptState}`,
    };
  }
  if (unknown) return { label: "Outcome unknown", error: unknown.message };
  if (failed) return { label: "Transaction failed", error: failed.message };
  if (pending) return { label: "Submitted · awaiting confirmation", error: "" };
  if (operations.length && operations.every((operation) => operation.status === "confirmed")) {
    return operations.every((operation) => operation.action.startsWith("approve"))
      ? { label: "Approvals confirmed · choose Sell Max All Nodes again", error: "" }
      : { label: "Confirmed on Robinhood Chain", error: "" };
  }
  return { label: "Status refreshed", error: "" };
}

async function beforeDeadline<T>(start: () => Promise<T>, deadline: number, message: string) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error(message);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      start(),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error(message)), remaining); }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function statusRead(address: string, txHash: string) {
  const key = `${address.toLowerCase()}:${txHash}`;
  const existing = statusReads.get(key);
  if (existing) return existing;
  if (statusReads.size >= STATUS_REFRESH_CONCURRENCY) throw new Error("Three transaction status checks are still in progress.");
  const pending = refreshNodeTradeOperation(address).finally(() => {
    if (statusReads.get(key) === pending) statusReads.delete(key);
  });
  statusReads.set(key, pending);
  return pending;
}

// UI deadlines do not cancel provider reads. Keep each underlying snapshot
// counted until it settles, including across token changes and remounts.
function snapshotRead(token: string, addresses: readonly string[]) {
  const key = JSON.stringify([token.toLowerCase(), addresses.map(address => address.toLowerCase())]);
  const existing = snapshotReads.get(key);
  if (existing) return existing;
  if (snapshotReads.size >= STATUS_REFRESH_CONCURRENCY) throw new Error("Three holdings reads are still in progress. Retry after they finish.");
  const pending = getNodeTradingSnapshot(token, addresses).finally(() => {
    if (snapshotReads.get(key) === pending) snapshotReads.delete(key);
  });
  snapshotReads.set(key, pending); return pending;
}

export interface NodeTradingProps {
  session: NodeSession | null;
  accountReadiness?: boolean;
  launchedTokenAddress?: string;
  onNodeBalancesRefresh?: () => void;
}

export default function NodeTrading({ accountReadiness = false, session, launchedTokenAddress = "", onNodeBalancesRefresh }: NodeTradingProps) {
  const accountReadinessRef = useRef(accountReadiness);
  const accountActionEpochRef = useRef(0);
  if (accountReadinessRef.current && !accountReadiness) accountActionEpochRef.current += 1;
  accountReadinessRef.current = accountReadiness;
  const [tokenInput, setTokenInput] = useState(launchedTokenAddress);
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  const customAmountsRef = useRef<Record<string, string>>({});
  const [snapshot, setSnapshot] = useState<NodeTradingSnapshot | null>(null);
  const [review, setReview] = useState<NodeTradeReview | null>(null);
  const [batch, setBatch] = useState<NodeTradeBatch | null>(null);
  const [batchResults, setBatchResults] = useState<readonly NodeTradeBatchResult[]>([]);
  const [tradeOutcome, setTradeOutcome] = useState<SubmissionOutcome | null>(null);
  const [batchOutcome, setBatchOutcome] = useState<SubmissionOutcome | null>(null);
  const [stopping, setStopping] = useState(false);
  const [operations, setOperations] = useState<Record<string, NodeTradeOperation>>({});
  const [blockedStorage, setBlockedStorage] = useState<Record<string, string>>({});
  const [batchActive, setBatchActive] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState("");
  const [refreshProgress, setRefreshProgress] = useState<RefreshProgress | null>(null);
  const [holdingsRefreshPending, setHoldingsRefreshPending] = useState(false);
  const [action, setAction] = useState<Action>("idle");
  const [error, setError] = useState("");
  const generationRef = useRef(0);
  const actionRef = useRef<Action>("idle");
  const stopBatchRef = useRef(false);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const refreshLifecycleRef = useRef(0);
  const refreshQueuedRef = useRef(false);
  const refreshQueuedManualRef = useRef(false);
  const refreshTargetsRef = useRef<Set<string>>(new Set());
  const refreshHoldingsStartedRef = useRef(false);
  const manualRefreshRequestedRef = useRef(false);
  const holdingsRefreshVersionRef = useRef(0);
  const holdingsAppliedVersionRef = useRef(0);
  const holdingsRefreshAttemptsRef = useRef(0);
  const tradeOutcomeOperationRef = useRef<{ review: NodeTradeReview; txHash: string } | null>(null);
  const operationsRef = useRef(operations);
  operationsRef.current = operations;
  const batchResultsRef = useRef(batchResults);
  batchResultsRef.current = batchResults;
  const batchRef = useRef(batch);
  batchRef.current = batch;
  const tradeReviewStateRef = useRef(review);
  tradeReviewStateRef.current = review;
  const selectionRef = useRef({ session, launchedTokenAddress });
  selectionRef.current = { session, launchedTokenAddress };

  const sessionKey = session ? `${session.id}:${session.addresses.join("|")}` : "none";

  const reconcileRefreshedOperation = useCallback((previous: OperationIdentity, returned: NodeTradeOperation) => {
    const key = previous.nodeAddress.toLowerCase();
    let stored: NodeTradeOperation | null;
    try { stored = getNodeTradeOperation(previous.nodeAddress); } catch { return null; }
    const displayed = operationsRef.current[key];
    if (!stored || stored.nodeAddress.toLowerCase() !== key || displayed?.txHash !== previous.txHash || displayed.status !== previous.status) return null;
    const replaced = stored.txHash !== previous.txHash;
    if (!replaced && (
      returned.txHash !== previous.txHash || returned.nodeAddress.toLowerCase() !== key || returned.tokenAddress.toLowerCase() !== previous.tokenAddress.toLowerCase()
      || stored.status !== returned.status || stored.tokenAddress.toLowerCase() !== previous.tokenAddress.toLowerCase()
      || stored.action !== returned.action || stored.side !== returned.side
    )) return null;
    const next = stored;
    operationsRef.current = { ...operationsRef.current, [key]: next };
    setOperations((existing) => existing[key]?.txHash === previous.txHash && existing[key]?.status === previous.status ? { ...existing, [key]: next } : existing);
    if (!replaced) {
      const existingResults = batchResultsRef.current;
      const updatedResults = existingResults.map((result) => result.nodeAddress.toLowerCase() === key && result.operation?.txHash === previous.txHash ? { ...result, operation: next } : result);
      if (updatedResults.some((result, index) => result.operation !== existingResults[index]?.operation)) {
        batchResultsRef.current = updatedResults;
        setBatchResults(updatedResults);
        setBatchOutcome(refreshedBatchOutcome(updatedResults, batchRef.current));
      }
      const tradeBinding = tradeOutcomeOperationRef.current;
      if (tradeBinding?.txHash === next.txHash && tradeReviewStateRef.current === tradeBinding.review) setTradeOutcome(submissionOutcome(next));
    }
    if ((previous.status === "pending" || previous.status === "unknown") && (next.status === "confirmed" || next.status === "failed")) {
      holdingsRefreshVersionRef.current += 1;
      holdingsRefreshAttemptsRef.current = 0;
      setHoldingsRefreshPending(true);
    } else if (replaced && (next.status === "pending" || next.status === "unknown") && refreshPromiseRef.current) {
      refreshQueuedRef.current = true;
    }
    return next;
  }, []);

  function readOperations(current: NodeSession) {
    const next: Record<string, NodeTradeOperation> = {};
    const blocked: Record<string, string> = {};
    current.addresses.forEach((address) => {
      try {
        const operation = getNodeTradeOperation(address);
        if (operation) next[address.toLowerCase()] = operation;
      } catch (caught) {
        blocked[address.toLowerCase()] = safeMessage(caught);
      }
    });
    setOperations(next);
    setBlockedStorage(blocked);
  }

  function clearTradeReview() {
    tradeOutcomeOperationRef.current = null;
    setReview(null);
  }

  const refreshAll = useCallback((manual: boolean) => {
    if (manual) {
      manualRefreshRequestedRef.current = true;
      holdingsRefreshAttemptsRef.current = 0;
      if (snapshot) {
        holdingsRefreshVersionRef.current += 1;
        setHoldingsRefreshPending(true);
      }
    }
    if (refreshPromiseRef.current) {
      const hasNewOperation = session?.addresses.some((address) => {
        const operation = operationsRef.current[address.toLowerCase()];
        return operation && (operation.status === "pending" || operation.status === "unknown") && !refreshTargetsRef.current.has(`${address.toLowerCase()}:${operation.txHash}`);
      });
      if (hasNewOperation || (manual && refreshHoldingsStartedRef.current)) refreshQueuedRef.current = true;
      if (manual && refreshHoldingsStartedRef.current) refreshQueuedManualRef.current = true;
      return refreshPromiseRef.current;
    }
    if (!session) return Promise.resolve();
    const currentSession = session;
    const selectedToken = snapshot?.tokenAddress || null;
    const generation = generationRef.current;
    const lifecycle = refreshLifecycleRef.current;
    const unresolved = currentSession.addresses.flatMap((address) => {
      const operation = operationsRef.current[address.toLowerCase()];
      return operation && (operation.status === "pending" || operation.status === "unknown")
        ? [{ address, txHash: operation.txHash, tokenAddress: operation.tokenAddress, previousStatus: operation.status }]
        : [];
    });
    const holdingsDue = holdingsAppliedVersionRef.current < holdingsRefreshVersionRef.current && holdingsRefreshAttemptsRef.current < HOLDINGS_REFRESH_RETRIES;
    if (!unresolved.length && !manualRefreshRequestedRef.current && !holdingsDue) return Promise.resolve();
    const sessionCurrent = () => refreshLifecycleRef.current === lifecycle && selectionRef.current.session === currentSession;
    const selectionCurrent = () => generation === generationRef.current && sessionCurrent();
    const failures: string[] = [];
    let checked = 0;
    let holdingsPromise: Promise<void> | null = null;
    let nodeBalancesRequested = false;
    let tokenHoldingsRefreshed = false;
    const publish = (target: typeof unresolved[number], operation: NodeTradeOperation) => {
      if (!sessionCurrent()) return;
      reconcileRefreshedOperation({ nodeAddress: target.address, txHash: target.txHash, tokenAddress: target.tokenAddress, status: target.previousStatus }, operation);
    };
    const promise = (async () => {
      setRefreshingAll(true);
      setRefreshProgress({ checked: 0, total: unresolved.length, failures: 0 });
      refreshTargetsRef.current = new Set(unresolved.map((target) => `${target.address.toLowerCase()}:${target.txHash}`));
      refreshHoldingsStartedRef.current = false;
      const deadline = Date.now() + STATUS_REFRESH_DEADLINE_MS;
      const maybeRefreshHoldings = () => {
        const forceManual = manualRefreshRequestedRef.current;
        const requestedVersion = holdingsRefreshVersionRef.current;
        if (holdingsPromise || !selectionCurrent() || !selectedToken || (!forceManual && (holdingsAppliedVersionRef.current >= requestedVersion || holdingsRefreshAttemptsRef.current >= HOLDINGS_REFRESH_RETRIES))) return;
        refreshHoldingsStartedRef.current = true;
        holdingsPromise = (async () => {
          try {
            const nextSnapshot = await beforeDeadline(() => snapshotRead(selectedToken, currentSession.addresses), deadline, "Holdings refresh timed out.");
            if (!selectionCurrent() || nextSnapshot.tokenAddress.toLowerCase() !== selectedToken.toLowerCase()) return;
            setSnapshot(nextSnapshot);
            tokenHoldingsRefreshed = true;
            holdingsAppliedVersionRef.current = Math.max(holdingsAppliedVersionRef.current, requestedVersion);
            holdingsRefreshAttemptsRef.current = 0;
            setHoldingsRefreshPending(holdingsAppliedVersionRef.current < holdingsRefreshVersionRef.current);
            onNodeBalancesRefresh?.();
            nodeBalancesRequested = true;
          } catch (caught) {
            if (!sessionCurrent()) return;
            failures.push(safeMessage(caught));
            if (!forceManual) {
              holdingsRefreshAttemptsRef.current += 1;
              const retry = holdingsRefreshAttemptsRef.current < HOLDINGS_REFRESH_RETRIES;
              setHoldingsRefreshPending(retry);
              if (!retry) setRefreshNotice("Transaction status updated, but holdings could not be refreshed. Use Refresh all to try again.");
            }
          }
        })();
      };
      let next = 0;
      async function worker() {
        while (next < unresolved.length && sessionCurrent() && Date.now() < deadline) {
          const target = unresolved[next++];
          try {
            publish(target, await beforeDeadline(() => statusRead(target.address, target.txHash), deadline, "Transaction status refresh timed out."));
          } catch (caught) {
            failures.push(safeMessage(caught));
          } finally {
            checked += 1;
            if (sessionCurrent()) setRefreshProgress({ checked, total: unresolved.length, failures: failures.length });
            maybeRefreshHoldings();
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(STATUS_REFRESH_CONCURRENCY, unresolved.length) }, () => worker()));
      if (!sessionCurrent()) return;
      if (next < unresolved.length) failures.push("Transaction status refresh timed out before every node was checked.");
      maybeRefreshHoldings();
      if (holdingsPromise) await holdingsPromise;
      const manualHandledHere = manualRefreshRequestedRef.current && !refreshQueuedManualRef.current;
      if (sessionCurrent() && manualHandledHere && !nodeBalancesRequested) {
        onNodeBalancesRefresh?.();
        nodeBalancesRequested = true;
      }
      if (sessionCurrent() && failures.length) setRefreshNotice(`Refresh incomplete · ${failures.length} check${failures.length === 1 ? "" : "s"} failed. ${failures[0]} Pending or unknown nodes remain blocked.`);
      else if (sessionCurrent() && manualHandledHere) setRefreshNotice(tokenHoldingsRefreshed ? "Transactions and node holdings refreshed." : "Transactions checked and node balance refresh requested.");
    })().finally(() => {
      if (refreshPromiseRef.current === promise) {
        const runAgain = refreshQueuedRef.current;
        const manualAgain = refreshQueuedManualRef.current;
        manualRefreshRequestedRef.current = manualAgain;
        refreshQueuedRef.current = false;
        refreshQueuedManualRef.current = false;
        refreshTargetsRef.current.clear();
        refreshHoldingsStartedRef.current = false;
        refreshPromiseRef.current = null;
        if (sessionCurrent()) {
          setRefreshingAll(false);
          if (runAgain) setTimeout(() => { if (sessionCurrent()) void refreshAll(false); }, 0);
        }
      }
    });
    refreshPromiseRef.current = promise;
    return promise;
  }, [session, snapshot, onNodeBalancesRefresh, reconcileRefreshedOperation]);

  async function loadSnapshot(token: string, current: NodeSession, generation: number) {
    actionRef.current = "loading";
    setAction("loading");
    setError("");
    clearTradeReview();
    setBatch(null);
    try {
      const next = await beforeDeadline(() => snapshotRead(token, current.addresses), Date.now() + STATUS_REFRESH_DEADLINE_MS, "Holdings refresh timed out.");
      if (generation !== generationRef.current || current !== session) return;
      setTokenInput(next.tokenAddress);
      setSnapshot(next);
      clearTradeReview();
      setBatch(null);
    } catch (caught) {
      if (generation === generationRef.current) {
        setSnapshot(null);
        setError(safeMessage(caught));
      }
    } finally {
      if (generation === generationRef.current) {
        actionRef.current = "idle";
        setAction("idle");
      }
    }
  }

  useEffect(() => {
    refreshLifecycleRef.current += 1;
    const generation = ++generationRef.current;
    actionRef.current = "idle";
    setAction("idle");
    setSnapshot(null);
    customAmountsRef.current = {};
    setCustomAmounts({});
    setCustomErrors({});
    clearTradeReview();
    setBatch(null);
    batchResultsRef.current = [];
    setBatchResults([]);
    setStopping(false);
    setBatchActive(false);
    setRefreshingAll(false);
    setRefreshNotice("");
    setRefreshProgress(null);
    setHoldingsRefreshPending(false);
    refreshPromiseRef.current = null;
    refreshQueuedRef.current = false;
    refreshQueuedManualRef.current = false;
    refreshTargetsRef.current.clear();
    refreshHoldingsStartedRef.current = false;
    manualRefreshRequestedRef.current = false;
    holdingsRefreshVersionRef.current = 0;
    holdingsAppliedVersionRef.current = 0;
    holdingsRefreshAttemptsRef.current = 0;
    stopBatchRef.current = true;
    setError("");
    setOperations({});
    setBlockedStorage({});
    if (!session) {
      setTokenInput(launchedTokenAddress);
      return;
    }
    readOperations(session);
    if (launchedTokenAddress) {
      setTokenInput(launchedTokenAddress);
      void loadSnapshot(launchedTokenAddress, session, generation);
    }
    return () => {
      refreshLifecycleRef.current += 1;
      generationRef.current += 1;
      actionRef.current = "idle";
    };
  }, [session, sessionKey, launchedTokenAddress]);

  const batchReadyCount = batch?.entries.filter((entry) => entry.status === "ready").length || 0;
  const rows = useMemo(() => {
    if (!session || !snapshot) return [];
    const byAddress = new Map(snapshot.balances.map((balance) => [balance.nodeAddress.toLowerCase(), balance]));
    return session.addresses.map((address, index) => ({ address, index, balance: byAddress.get(address.toLowerCase()) || null }));
  }, [sessionKey, snapshot]);
  const unresolvedKey = session ? session.addresses.flatMap((address) => {
    const operation = operations[address.toLowerCase()];
    return operation && (operation.status === "pending" || operation.status === "unknown") ? [`${address}:${operation.txHash}:${operation.status}`] : [];
  }).join("|") : "";

  useEffect(() => {
    if (!session) return;
    const run = () => { if (document.visibilityState === "visible") void refreshAll(false); };
    run();
    const focus = () => run();
    const visible = () => run();
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visible);
    const timer = unresolvedKey || holdingsRefreshPending ? window.setInterval(run, 2000) : null;
    return () => {
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visible);
      if (timer !== null) window.clearInterval(timer);
    };
  }, [session, unresolvedKey, holdingsRefreshPending, action, refreshAll]);

  function updateToken(value: string) {
    generationRef.current += 1;
    setTokenInput(value);
    setSnapshot(null);
    customAmountsRef.current = {};
    setCustomAmounts({});
    setCustomErrors({});
    clearTradeReview();
    setBatch(null);
    batchResultsRef.current = [];
    setBatchResults([]);
    setError("");
  }

  function updateCustomAmount(key: string, value: string) {
    customAmountsRef.current = { ...customAmountsRef.current, [key]: value };
    setCustomAmounts(customAmountsRef.current);
    setCustomErrors((current) => { const next = { ...current }; delete next[key]; return next; });
  }

  function handleLoad() {
    if (!session || actionRef.current !== "idle") return;
    const generation = ++generationRef.current;
    void loadSnapshot(tokenInput.trim(), session, generation);
  }

  function handleRefreshAll() {
    if (!session) return;
    setRefreshNotice("");
    void refreshAll(true);
  }

  async function handlePrepare(index: number, side: NodeTradeSide, amount: NodeTradeAmount) {
    if (!accountReadiness || !session || !snapshot?.tradingAvailable || actionRef.current !== "idle") return;
    const address = session.addresses[index];
    const existing = operations[address.toLowerCase()];
    if (blockedStorage[address.toLowerCase()] || (existing && (existing.status === "pending" || existing.status === "unknown"))) return;
    const customKey = `${address.toLowerCase()}:${side}`;
    let selection: NodeTradeAmount;
    try {
      selection = copyTradeAmount(amount);
      if (typeof selection !== "number") parseTradeAmount(selection.amount, side === "buy" ? 18 : snapshot.decimals);
    } catch (caught) {
      setCustomErrors((current) => ({ ...current, [customKey]: safeMessage(caught) }));
      return;
    }
    const generation = ++generationRef.current;
    const currentSession = session;
    const accountEpoch = accountActionEpochRef.current;
    const currentToken = snapshot.tokenAddress;
    const currentDecimals = snapshot.decimals;
    const currentLaunch = launchedTokenAddress;
    const assertCurrent = () => {
      if (!accountReadinessRef.current || accountActionEpochRef.current !== accountEpoch) throw new Error("Account verification changed. Start a new action after verification resumes.");
      if (generation !== generationRef.current || selectionRef.current.session !== currentSession || selectionRef.current.launchedTokenAddress !== currentLaunch || (typeof selection !== "number" && customAmountsRef.current[customKey] !== selection.amount)) {
        throw new Error("The selected node session, token or amount changed. The action was cancelled.");
      }
    };
    actionRef.current = "preparing";
    setAction("preparing");
    clearTradeReview();
    setBatch(null);
    batchResultsRef.current = [];
    setBatchResults([]);
    setError("");
    setTradeOutcome(null);
    setCustomErrors((current) => { const next = { ...current }; delete next[customKey]; return next; });
    try {
      const next = await prepareNodeTrade(currentSession, index, currentToken, side, selection);
      assertCurrent();
      if (next.nodeAddress.toLowerCase() !== address.toLowerCase() || next.nodeIndex !== index || next.tokenAddress.toLowerCase() !== currentToken.toLowerCase() || next.side !== side || (typeof selection === "number" ? next.percent !== selection : next.percent !== null || next.customAmount !== selection.amount || next.decimals !== currentDecimals || !parseTradeAmount(selection.amount, side === "buy" ? 18 : next.decimals).eq(next.amountInRaw))) {
        throw new Error("The prepared action does not match the selected node and token.");
      }
      if (Date.now() >= next.expiresAt) throw new Error("The quote expired before submission. Choose the action again for a fresh quote.");
      setReview(next);
      setTradeOutcome({ label: "Submitting", error: "" });
      // The clicked preset authorizes this exact validated action. Keep the lock
      // continuously held while moving from preparation into the vault operation.
      actionRef.current = "executing";
      setAction("executing");
      const operation = await executeNodeTrade(currentSession, next, assertCurrent);
      if (generation !== generationRef.current || selectionRef.current.session !== currentSession || selectionRef.current.launchedTokenAddress !== currentLaunch) return;
      tradeOutcomeOperationRef.current = { review: next, txHash: operation.txHash };
      operationsRef.current = { ...operationsRef.current, [operation.nodeAddress.toLowerCase()]: operation };
      setOperations((current) => ({ ...current, [operation.nodeAddress.toLowerCase()]: operation }));
      setTradeOutcome(submissionOutcome(operation));
    } catch (caught) {
      if (generation !== generationRef.current || selectionRef.current.session !== currentSession || selectionRef.current.launchedTokenAddress !== currentLaunch) return;
      setError(safeMessage(caught));
      if (typeof selection !== "number") setCustomErrors((current) => ({ ...current, [customKey]: safeMessage(caught) }));
      setTradeOutcome({ label: "Could not submit", error: safeMessage(caught) });
      try {
        const operation = getNodeTradeOperation(address);
        if (operation) {
          setOperations((current) => ({ ...current, [address.toLowerCase()]: operation }));
        }
      } catch (storageError) {
        setBlockedStorage((current) => ({ ...current, [address.toLowerCase()]: safeMessage(storageError) }));
      }
    } finally {
      if (generation === generationRef.current && selectionRef.current.session === currentSession && selectionRef.current.launchedTokenAddress === currentLaunch) {
        actionRef.current = "idle";
        setAction("idle");
      }
    }
  }

  async function handlePrepareBatch(side: NodeTradeSide) {
    if (!accountReadiness || !session || !snapshot?.tradingAvailable || actionRef.current !== "idle") return;
    const generation = ++generationRef.current;
    const currentSession = session;
    const accountEpoch = accountActionEpochRef.current;
    const currentToken = snapshot.tokenAddress;
    const currentLaunch = launchedTokenAddress;
    actionRef.current = "preparing";
    setAction("preparing");
    clearTradeReview();
    setBatch(null);
    batchResultsRef.current = [];
    setBatchResults([]);
    setError("");
    setStopping(false);
    setBatchActive(true);
    setBatchOutcome(null);
    setRefreshNotice("");
    stopBatchRef.current = false;
    const assertCurrent = () => {
      if (!accountReadinessRef.current || accountActionEpochRef.current !== accountEpoch) throw new Error("Account verification changed. Start a new action after verification resumes.");
      if (generation !== generationRef.current || stopBatchRef.current || selectionRef.current.session !== currentSession || selectionRef.current.launchedTokenAddress !== currentLaunch) {
        throw new Error("Stopped before submission. Already submitted transactions continue.");
      }
    };
    const onProgress = (result: NodeTradeBatchResult) => {
      if (generation !== generationRef.current || selectionRef.current.session !== currentSession || selectionRef.current.launchedTokenAddress !== currentLaunch) return;
      const nextResults = [...batchResultsRef.current.filter((row) => row.nodeIndex !== result.nodeIndex), result].sort((a, b) => a.nodeIndex - b.nodeIndex);
      batchResultsRef.current = nextResults;
      setBatchResults(nextResults);
      if (result.operation) {
        const operation = result.operation;
        operationsRef.current = { ...operationsRef.current, [operation.nodeAddress.toLowerCase()]: operation };
        setOperations((current) => ({ ...current, [operation.nodeAddress.toLowerCase()]: operation }));
      }
    };
    try {
      const next = await prepareNodeTradeBatch(currentSession, currentToken, side, assertCurrent);
      assertCurrent();
      if (next.tokenAddress.toLowerCase() !== currentToken.toLowerCase() || next.side !== side) throw new Error("The prepared all-node action does not match the selected token and side.");
      setBatch(next);
      if (!next.entries.some((entry) => entry.status === "ready")) {
        setBatchOutcome({ label: "No eligible nodes", error: "No transactions were submitted. Check the reasons below." });
        return;
      }
      if (Date.now() >= next.expiresAt) throw new Error("The all-node quote expired before submission. Choose the action again for fresh quotes.");
      actionRef.current = "executing";
      setAction("executing");
      setBatchOutcome({ label: "Submitting", error: "" });
      const results = await executeNodeTradeBatch(currentSession, next, assertCurrent, onProgress);
      if (generation === generationRef.current && selectionRef.current.session === currentSession && selectionRef.current.launchedTokenAddress === currentLaunch) {
        const currentResults = new Map(batchResultsRef.current.map((result) => [result.nodeAddress.toLowerCase(), result]));
        const mergedResults = results.map((result) => {
          const operation = result.operation;
          if (!operation) return result;
          const live = operationsRef.current[result.nodeAddress.toLowerCase()];
          const progressive = currentResults.get(result.nodeAddress.toLowerCase())?.operation;
          const latest = live?.txHash === operation.txHash ? live : progressive?.txHash === operation.txHash ? progressive : operation;
          return latest === operation ? result : { ...result, operation: latest };
        });
        batchResultsRef.current = mergedResults;
        setBatchResults(mergedResults);
        setBatchOutcome(refreshedBatchOutcome(mergedResults, next));
      }
    } catch (caught) {
      if (generation === generationRef.current && selectionRef.current.session === currentSession && selectionRef.current.launchedTokenAddress === currentLaunch) {
        setError(safeMessage(caught));
        setBatchOutcome({ label: "Could not submit", error: safeMessage(caught) });
      }
    } finally {
      if (generation === generationRef.current && selectionRef.current.session === currentSession && selectionRef.current.launchedTokenAddress === currentLaunch) {
        actionRef.current = "idle";
        setAction("idle");
        setStopping(false);
        setBatchActive(false);
        readOperations(currentSession);
      }
    }
  }

  async function handleRefreshOperation(address: string) {
    if (actionRef.current !== "idle") return;
    const generation = ++generationRef.current;
    const previous = operationsRef.current[address.toLowerCase()];
    actionRef.current = "refreshing";
    setAction("refreshing");
    setError("");
    try {
      if (!previous) throw new Error("No recorded trade exists for this node.");
      const operation = await beforeDeadline(() => statusRead(address, previous.txHash), Date.now() + STATUS_REFRESH_DEADLINE_MS, "Transaction status refresh timed out.");
      if (generation !== generationRef.current) return;
      reconcileRefreshedOperation(previous, operation);
    } catch (caught) {
      if (generation === generationRef.current) setError(safeMessage(caught));
    } finally {
      if (generation === generationRef.current) {
        actionRef.current = "idle";
        setAction("idle");
      }
    }
  }

  function retryStorage(address: string) {
    try {
      const operation = getNodeTradeOperation(address);
      setBlockedStorage((current) => { const next = { ...current }; delete next[address.toLowerCase()]; return next; });
      if (operation) setOperations((current) => ({ ...current, [address.toLowerCase()]: operation }));
    } catch (caught) {
      setBlockedStorage((current) => ({ ...current, [address.toLowerCase()]: safeMessage(caught) }));
    }
  }

  return (
    <section id="node-trading" className={styles.trading} aria-labelledby="node-trading-title" tabIndex={-1}>
      <header className={styles.header}><div><span className={styles.eyebrow}>Node trading</span><h2 id="node-trading-title">Trade the launched token</h2><p>Buy and Sell buttons submit immediately using that node’s key after checking the quote and gas. Percentages use its balances and retain ETH for gas.</p></div><span className={styles.chainBadge}>Robinhood · 4663</span></header>
      {!accountReadiness && <p role="status">Account verification is unavailable. New trades are paused. Your wallets, transaction records, and balance refresh remain available.</p>}
      <div className={styles.body}>
        {!session ? <p className={styles.locked}>Generate wallets and verify their encrypted backup to enable node trading.</p> : <>
          <div className={styles.tokenPicker}><label><span>PONS token address</span><input value={tokenInput} onChange={(event) => updateToken(event.target.value)} placeholder="0x…" autoComplete="off" aria-label="PONS token address" disabled={action !== "idle"} /></label><button className={styles.primaryButton} type="button" onClick={handleLoad} disabled={!tokenInput.trim() || action !== "idle"}>{action === "loading" ? "Verifying token…" : snapshot ? "Refresh holdings" : "Verify token and load holdings"}</button></div>
          {launchedTokenAddress && tokenInput.toLowerCase() === launchedTokenAddress.toLowerCase() && <p className={styles.phase}>Selected automatically from this page’s verified launch receipt.</p>}
          <p className={styles.phase}>Transaction protection applies in this browser profile and site address. Other devices or profiles, or clearing browser storage, can bypass it. Preserve transaction hashes.</p>
          <div className={styles.bulkToolbar} aria-label="Refresh transaction and node status"><div><strong>Transactions & nodes</strong><p>Pending transactions refresh automatically while this page is visible. Refresh checks only; it never funds a node or resubmits a transaction.</p></div><button className={styles.secondaryButton} type="button" onClick={handleRefreshAll}>{refreshingAll ? "Refresh all requested…" : "Refresh all transactions & nodes"}</button></div>
          <p className={styles.refreshStatus} role="status" aria-live="polite">{refreshingAll ? `Checking transactions ${refreshProgress?.checked || 0} of ${refreshProgress?.total || 0}${refreshProgress?.failures ? ` · ${refreshProgress.failures} failed` : ""}…` : refreshNotice}</p>
          {error && <div className={styles.alert} role="alert"><span>{error}</span><button type="button" onClick={() => setError("")}>Dismiss</button></div>}
          {!snapshot && action !== "loading" && <p className={styles.empty}>Enter an existing PONS token or launch one above. The factory, native ETH pair, route, phase, balances and supply are checked onchain before controls appear.</p>}

          {snapshot && <>
            <dl className={styles.tokenSummary}>
              <div className={styles.tokenAddress}><dt>Factory-verified token</dt><dd>{snapshot.tokenAddress}</dd></div>
              <div><dt>Symbol</dt><dd>${snapshot.symbol}</dd></div><div><dt>Total supply</dt><dd>{formatToken(snapshot.totalSupplyRaw, snapshot.decimals)}</dd></div><div><dt>Route phase</dt><dd>{snapshot.phase === 0 ? "PONS curve" : snapshot.phase === 2 ? "Uniswap v4" : `Phase ${snapshot.phase}`}</dd></div><div><dt>Snapshot</dt><dd>Block {snapshot.blockNumber.toLocaleString()}</dd></div>
            </dl>
            <p className={styles.phase}>{snapshot.phaseMessage}</p>
            <div className={styles.bulkToolbar} aria-label="Trade with all nodes">
              <div><strong>All nodes</strong><p>Submit each eligible node’s maximum amount immediately, with ETH retained for gas.</p></div>
              <button className={styles.primaryButton} type="button" onClick={() => handlePrepareBatch("buy")} disabled={!accountReadiness || !snapshot.tradingAvailable || !rows.length || action !== "idle"}>Buy Max All Nodes</button>
              <button className={styles.secondaryButton} type="button" onClick={() => handlePrepareBatch("sell")} disabled={!accountReadiness || !snapshot.tradingAvailable || !rows.length || action !== "idle"}>Sell Max All Nodes</button>
            </div>
            {action === "preparing" && <p className={styles.phase} role="status">Checking fresh amounts and gas before immediate submission…</p>}
            {action === "executing" && <p className={styles.phase} role="status">Signing and submitting the selected actions…</p>}
            {batchActive && action === "preparing" && <button className={styles.secondaryButton} type="button" disabled={stopping} onClick={() => { stopBatchRef.current = true; setStopping(true); }}>{stopping ? "Stopping remaining nodes…" : "Stop remaining nodes"}</button>}
            <div className={styles.nodes} aria-label="Node token holdings and trading controls">
              {rows.map(({ address, index, balance }) => {
                const operation = operations[address.toLowerCase()];
                const storageError = blockedStorage[address.toLowerCase()];
                const blocked = Boolean(storageError || (operation && (operation.status === "pending" || operation.status === "unknown")));
                return <article className={styles.node} key={address}>
                  <div className={styles.nodeHeader}><div><span>Node {index + 1}</span><code title={address}>{shortAddress(address)}</code></div>{operation && <em>{operation.status}</em>}</div>
                  <dl className={styles.metrics}><div><dt>ETH balance</dt><dd title={balance ? `${formatEth(balance.ethBalanceWei)} ETH` : undefined}>{balance ? `${visualNumber(formatEth(balance.ethBalanceWei))} ETH` : "Unavailable"}</dd></div><div><dt>{snapshot.symbol} balance</dt><dd title={balance ? formatToken(balance.tokenBalanceRaw, snapshot.decimals) : undefined}>{balance ? visualNumber(formatToken(balance.tokenBalanceRaw, snapshot.decimals)) : "Unavailable"}</dd></div><div><dt>Share of supply</dt><dd title={balance ? `${balance.supplySharePercent}%` : undefined}>{balance ? `${visualNumber(balance.supplySharePercent)}%` : "Unavailable"}</dd></div></dl>
                  {storageError && <div className={styles.alert} role="alert"><span>{storageError}</span><button type="button" onClick={() => retryStorage(address)}>Retry status check</button></div>}
                  {operation && <div className={styles.operation}><strong>{operationLabel(operation)}</strong>{operation.status !== "confirmed" && <p>{operation.message}</p>}{(operation.status === "pending" || operation.status === "unknown") && <button className={styles.secondaryButton} type="button" onClick={() => handleRefreshOperation(address)} disabled={action !== "idle"}>{action === "refreshing" ? "Checking status…" : "Refresh transaction status"}</button>}<details className={styles.operationDetails}><summary>Transaction details</summary><p>{operation.message}</p><dl><div><dt>Recorded token</dt><dd>{operation.tokenAddress}</dd></div><div><dt>Action</dt><dd>{operation.action}</dd></div><div><dt>Transaction</dt><dd>{operation.txHash}</dd></div></dl></details></div>}
                  <div className={styles.tradeGroups}>
                    {(["buy", "sell"] as const).map((side) => <div className={styles.tradeGroup} key={side}><span>{side === "buy" ? `Buy ${snapshot.symbol} · % of spendable ETH after gas` : `Sell ${snapshot.symbol} · % of holdings`}</span><div className={styles.tradeButtons}>{PERCENTS.map((percent) => <button type="button" key={percent} onClick={() => handlePrepare(index, side, percent)} disabled={!accountReadiness || !snapshot.tradingAvailable || !balance || blocked || action !== "idle"} aria-label={`${side === "buy" ? "Buy" : "Sell"} ${percent === 100 ? "Max" : `${percent}%`} with node ${index + 1}`}>{percent === 100 ? `${side === "buy" ? "Buy" : "Sell"} Max` : `${percent}%`}</button>)}</div><div className={styles.customTrade}>
                      <label><span>{side === "buy" ? "Custom buy · ETH" : `Custom sell · ${snapshot.symbol}`}</span><input type="text" inputMode="decimal" autoComplete="off" maxLength={116} value={customAmounts[`${address.toLowerCase()}:${side}`] || ""} onChange={(event) => updateCustomAmount(`${address.toLowerCase()}:${side}`, event.target.value)} aria-label={side === "buy" ? `Custom buy ETH for node ${index + 1}` : `Custom sell tokens for node ${index + 1}`} disabled={!accountReadiness || !snapshot.tradingAvailable || !balance || blocked || action !== "idle"} placeholder={side === "buy" ? "0.001" : "Token amount"} /></label>
                      <button className={styles.secondaryButton} type="button" onClick={() => handlePrepare(index, side, { amount: customAmountsRef.current[`${address.toLowerCase()}:${side}`] || "" })} disabled={!accountReadiness || !customAmounts[`${address.toLowerCase()}:${side}`] || !snapshot.tradingAvailable || !balance || blocked || action !== "idle"} aria-label={`${side === "buy" ? "Buy" : "Sell"} custom amount with node ${index + 1}`}>{side === "buy" ? "Buy amount" : "Sell amount"}</button>
                    </div>{customErrors[`${address.toLowerCase()}:${side}`] && <p className={styles.warning} role="alert">{customErrors[`${address.toLowerCase()}:${side}`]}</p>}</div>)}
                  </div>
                </article>;
              })}
            </div>
          </>}

          {batch && <div className={styles.review} aria-live="polite" aria-labelledby="node-batch-review-title">
            <div className={styles.reviewHeading}><h3 id="node-batch-review-title">{batch.mode === "approvals" ? "Approval-only action details" : `${batch.side === "buy" ? "Buy" : "Sell"} Max All Nodes · action details`}</h3><em>{batchOutcome?.label || (batchActive ? "Processing" : "Action details")}</em></div>
            {batchActive && action === "executing" && <button className={styles.secondaryButton} type="button" disabled={stopping} onClick={() => { stopBatchRef.current = true; setStopping(true); }}>{stopping ? "Stopping remaining nodes…" : "Stop remaining nodes"}</button>}
            {batchOutcome?.error && <p className={styles.alert} role="alert">{batchOutcome.error}</p>}
            <code className={styles.fullAddress}>{batch.tokenAddress}</code>
            <p className={styles.phase}>{batchReadyCount} of {batch.entries.length} nodes ready · Robinhood Chain · 4663</p>
            <dl className={styles.reviewDetails}><div><dt>Maximum total gas</dt><dd>{formatEth(batch.maxGasCostWei)} ETH</dd></div><div><dt>Maximum total ETH debit</dt><dd>{formatEth(batch.maxTotalEthWei)} ETH</dd></div></dl>
            <p className={styles.warning}>Each node submits separately. Prices can change between nodes. If an action fails, expires, or has an unknown outcome, remaining nodes stop. Submitted transactions cannot be cancelled here.</p>
            {batch.mode === "approvals" && <p className={styles.warning}>This batch submits approvals only. Nodes already approved will wait. After each approval confirms, choose Sell Max All Nodes again for fresh sale quotes. No sales follow automatically. If an existing node lacks ETH for approval and the following sale, fund it before trying again.</p>}
            {batch.entries.map((entry) => {
              const item = entry.review;
              return <article className={styles.node} key={entry.nodeAddress}>
                <strong>Node {entry.nodeIndex + 1} · {entry.status}</strong><code className={styles.fullAddress}>{entry.nodeAddress}</code>
                {entry.error && <p className={styles.warning}>{entry.error}</p>}
                {item && entry.status === "ready" && <>
                  <dl className={styles.reviewDetails}>
                    <div><dt>Action / route</dt><dd>{actionLabel(item.action)} · {item.route}</dd></div>
                    <div><dt>Input</dt><dd>{item.side === "buy" ? `${formatEth(item.amountInRaw)} ETH` : `${formatToken(item.amountInRaw, item.decimals)} ${item.symbol}`}</dd></div>
                    <div><dt>Expected output</dt><dd>{item.action.startsWith("approve") ? "Approval only" : item.side === "buy" ? `${formatToken(item.expectedOutputRaw, item.decimals)} ${item.symbol}` : `${formatEth(item.expectedOutputRaw)} ETH`}</dd></div>
                    <div><dt>{item.minimumIsRateBound ? "Minimum at expected ETH spend" : "Minimum output"}</dt><dd>{item.action.startsWith("approve") ? "Not applicable" : item.side === "buy" ? `${formatToken(proportionalRateMinimum(item), item.decimals)} ${item.symbol}` : `${formatEth(item.minimumOutputRaw)} ETH`}</dd></div>
                    <div><dt>Slippage</dt><dd>{item.slippageBps / 100}%</dd></div><div><dt>Maximum gas</dt><dd>{formatEth(item.maxGasCostWei)} ETH</dd></div>
                    <div><dt>Maximum ETH debit</dt><dd>{formatEth(item.maxTotalEthWei)} ETH</dd></div><div><dt>ETH retained after maximum cost</dt><dd>{formatEth(item.balanceAfterMaxCostWei)} ETH</dd></div>
                    <div><dt>Expected ETH spend / refund</dt><dd>{formatEth(item.expectedSpendWei)} / {formatEth(item.expectedRefundWei)} ETH</dd></div>
                    <div><dt>Gas limit / max fee</dt><dd>{item.gasLimit} / {gwei(item.maxFeePerGasWei)} gwei</dd></div>
                    {item.approvalSpender && <div><dt>Exact approval spender</dt><dd>{item.approvalSpender}</dd></div>}
                    {item.approvalExpiresAt && <div><dt>Approval expires</dt><dd>{new Date(item.approvalExpiresAt).toLocaleString()}</dd></div>}
                  </dl>
                  {item.minimumIsRateBound && <p className={styles.warning}>Curve graduation can partially fill this buy and refund unused ETH. The minimum scales with the ETH spent; it is a price floor, not a guaranteed token quantity.</p>}
                </>}
              </article>;
            })}
            <p className={styles.warning}>Retained ETH is a buffer, not a guarantee of gas for later actions. Each following step requires a fresh quote.</p>
            {batchReadyCount === 0 && <p className={styles.warning}>No nodes are ready. Resolve the reasons above, then choose the all-node action again.</p>}
          </div>}

          {batchResults.length > 0 && <div className={styles.operation} role="status" aria-label="All-node submission results"><strong>All-node submission results</strong><p>Pending transactions refresh automatically while this page is visible. Unknown outcomes remain blocked and are never resent automatically.</p>{batchResults.map((result) => <div key={result.nodeAddress}><strong>Node {result.nodeIndex + 1} · {result.operation?.status || result.status}</strong>{result.operation && <code className={styles.fullAddress}>{result.operation.txHash}</code>}{result.error && <p>{result.error}</p>}</div>)}</div>}

          {review && <div className={styles.review} aria-live="polite" aria-labelledby="node-trade-review-title">
            <div className={styles.reviewHeading}><div><span className={styles.eyebrow}>Selected action details</span><h3 id="node-trade-review-title">{actionLabel(review.action)} · node {review.nodeIndex + 1}</h3></div><em>{tradeOutcome?.label || "Action details"}</em></div>
            {tradeOutcome?.error && <p className={styles.alert} role="alert">{tradeOutcome.error}</p>}
            <code className={styles.fullAddress}>{review.nodeAddress}</code><code className={styles.fullAddress}>{review.tokenAddress}</code>
            <dl className={styles.reviewDetails}>
              <div><dt>Network</dt><dd>Robinhood Chain · 4663</dd></div><div><dt>Route</dt><dd>{review.route}</dd></div><div><dt>Selection</dt><dd>{review.side === "buy" ? "Buy" : "Sell"} {review.percent === null ? `${review.customAmount} ${review.side === "buy" ? "ETH" : review.symbol}` : review.percent === 100 ? "Max" : `${review.percent}%`}</dd></div><div><dt>Action</dt><dd>{review.action}</dd></div>
              <div><dt>Input</dt><dd>{review.side === "buy" ? `${formatEth(review.amountInRaw)} ETH` : `${formatToken(review.amountInRaw, review.decimals)} ${review.symbol}`}</dd></div>
              <div><dt>Expected output</dt><dd>{review.action.startsWith("approve") ? "Approval only" : review.side === "buy" ? `${formatToken(review.expectedOutputRaw, review.decimals)} ${review.symbol}` : `${formatEth(review.expectedOutputRaw)} ETH`}</dd></div>
              <div><dt>{review.minimumIsRateBound ? "Minimum at expected ETH spend" : "Minimum output"}</dt><dd>{review.action.startsWith("approve") ? "Not applicable" : review.side === "buy" ? `${formatToken(proportionalRateMinimum(review), review.decimals)} ${review.symbol}` : `${formatEth(review.minimumOutputRaw)} ETH`}</dd></div>
              <div><dt>Slippage</dt><dd>{review.slippageBps / 100}%</dd></div><div><dt>Expected ETH spend</dt><dd>{formatEth(review.expectedSpendWei)} ETH</dd></div><div><dt>Expected ETH refund</dt><dd>{formatEth(review.expectedRefundWei)} ETH</dd></div><div><dt>Maximum gas</dt><dd>{formatEth(review.maxGasCostWei)} ETH</dd></div><div><dt>Maximum ETH total</dt><dd>{formatEth(review.maxTotalEthWei)} ETH</dd></div><div><dt>ETH retained after maximum cost</dt><dd>{formatEth(review.balanceAfterMaxCostWei)} ETH</dd></div><div><dt>ETH buffer for following steps</dt><dd>{formatEth(review.requiredRemainingEthWei)} ETH</dd></div><div><dt>Gas reserve basis</dt><dd>{formatEth(review.gasReserveWei)} ETH</dd></div><div><dt>Gas limit</dt><dd>{review.gasLimit}</dd></div><div><dt>Max / priority fee</dt><dd>{gwei(review.maxFeePerGasWei)} / {gwei(review.maxPriorityFeePerGasWei)} gwei</dd></div>
              {review.approvalSpender && <div><dt>Exact approval spender</dt><dd>{review.approvalSpender}</dd></div>}{review.approvalExpiresAt && <div><dt>Approval expires</dt><dd>{new Date(review.approvalExpiresAt).toLocaleString()}</dd></div>}
            </dl>
            {review.minimumIsRateBound && <p className={styles.warning}>Curve graduation may partially fill this buy and refund unused ETH. The displayed minimum scales the submitted-ETH price floor to the expected ETH spend. It is price protection, not a guaranteed token quantity.</p>}
            {review.action.startsWith("approve") && <p className={styles.warning}>This submits only an exact, limited approval. After it confirms, press the Sell button again for a fresh sale quote. No sale follows automatically.</p>}
            <p className={styles.warning}>Retained ETH is a buffer, not a guarantee of gas for later actions. Each following step requires a fresh quote.</p>

          </div>}
        </>}
      </div>
    </section>
  );
}
