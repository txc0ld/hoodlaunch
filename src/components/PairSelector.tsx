'use client';

import { useEffect, useRef, useState } from 'react';
import { constants, utils } from 'ethers';
import { inspectPairToken } from '../lib/pons';
import type { PairAsset } from '../lib/pons-types';
import styles from './PairSelector.module.css';

export interface PairSelectorProps {
  pairToken?: string;
  onPairChange: (address: string, asset: PairAsset | null) => void;
  disabled?: boolean;
}
export default function PairSelector({ pairToken = constants.AddressZero, onPairChange, disabled = false }: PairSelectorProps) {
  const native = pairToken === constants.AddressZero;
  const callback = useRef(onPairChange);
  const sequence = useRef(0);
  const [result, setResult] = useState<{ input: string; asset?: PairAsset; error?: string } | null>(null);
  useEffect(() => { callback.current = onPairChange; }, [onPairChange]);
  useEffect(() => {
    const request = ++sequence.current;
    if (native || !pairToken.trim()) return;
    // Parent receives null on every new input; an old lookup can never restore old metadata.
    callback.current(pairToken, null);
    const timer = setTimeout(() => {
      inspectPairToken(pairToken).then(asset => {
        if (request !== sequence.current) return;
        setResult({ input: pairToken, asset });
        callback.current(pairToken, asset);
      }).catch(error => {
        if (request !== sequence.current) return;
        setResult({ input: pairToken, error: error instanceof Error ? error.message : 'Pair asset lookup failed.' });
        callback.current(pairToken, null);
      });
    }, 400);
    return () => { clearTimeout(timer); sequence.current++; };
  }, [pairToken, native]);
  const current = result?.input === pairToken ? result : null;
  const change = (value: string) => {
    sequence.current++;
    setResult(null);
    onPairChange(value, null);
  };
  return <fieldset className={styles.panel} disabled={disabled}>
    <legend>Launch pair <span className={styles.free}>Free</span></legend>
    <div className={styles.options}>
      <label><input type="radio" name="launch-pair" checked={native} onChange={() => change(constants.AddressZero)} /> Native ETH</label>
      <label><input type="radio" name="launch-pair" checked={!native} onChange={() => change('')} /> Custom quote asset</label>
    </div>
    {!native && <>
      <label className={styles.inputLabel}>Quote asset contract on Robinhood Chain
        <input value={pairToken} onChange={event => change(event.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} maxLength={64} aria-describedby="pair-guidance pair-status" />
      </label>
      <p id="pair-guidance">Enter a PONS-approved ERC-20 address. Custom pairs launch with zero developer buy. Buy separately on PONS; generated-node trading supports ETH pairs only. Launch fees and gas are paid in ETH.</p>
      <div id="pair-status" aria-live="polite" role="status">
        {current?.error ? <p className={styles.error}>{current.error}</p> : current?.asset ? <dl className={styles.metadata}>
          <dt>Approved quote asset</dt><dd>{current.asset.symbol}</dd>
          <dt>Canonical contract</dt><dd className={styles.address}>{current.asset.address}</dd>
          <dt>Decimals</dt><dd>{current.asset.decimals}</dd>
          <dt>Phantom reserve</dt><dd>{utils.formatUnits(current.asset.phantomQuoteWei, current.asset.decimals)} {current.asset.symbol}</dd>
          <dt>Graduation threshold</dt><dd>{utils.formatUnits(current.asset.graduationThresholdWei, current.asset.decimals)} {current.asset.symbol}</dd>
        </dl> : pairToken.trim() ? <p>Checking factory approval and asset economics…</p> : <p>Enter an address to check approval.</p>}
      </div>
    </>}
    {native && <p>Native ETH is the default quote asset. An optional developer buy can be included at launch.</p>}
  </fieldset>;
}
