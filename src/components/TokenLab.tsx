'use client';

import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import styles from './TokenLab.module.css';
import {
  TOKEN_LAB_DISCLAIMER,
  calculateAllocations,
  calculateFdv,
  calculateFeeImpact,
  calculateVesting,
  clampVestingElapsed,
  exportScenarios,
  summarizeScenario,
  type AllocationInput,
  type TokenLabScenario,
} from '../lib/token-lab';

type Result<T> = { value: T; error: '' } | { value: null; error: string };
const ALLOCATION_KEYS: (keyof AllocationInput)[] = ['team', 'community', 'liquidity', 'treasury'];
const COLORS = ['#c6ff5f', '#55ddee', '#f4f1e8', '#77808a'];

function attempt<T>(work: () => T): Result<T> {
  try { return { value: work(), error: '' }; }
  catch (error) { return { value: null, error: error instanceof Error ? error.message : 'Check these inputs and try again.' }; }
}

function Icon({ name }: { name: 'flask' | 'atoms' | 'download' | 'lock' }) {
  if (name === 'flask') return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 15h9" /></svg>;
  if (name === 'atoms') return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1.5" /><ellipse cx="12" cy="12" rx="10" ry="4.5" /><ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(60 12 12)" /></svg>;
  if (name === 'download') return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v12m-4-4 4 4 4-4M5 20h14" /></svg>;
  return <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>;
}

function Field({ label, value, onChange, suffix, min = '0', max, step = 'any' }: { label: string; value: string; onChange: (value: string) => void; suffix?: string; min?: string; max?: string; step?: string }) {
  return <label className={styles.field}><span>{label}</span><span className={styles.inputShell}><input type="number" inputMode="decimal" min={min} max={max} step={step} value={value} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)} />{suffix && <small>{suffix}</small>}</span></label>;
}

function Readout({ label, children, accent = false }: { label: string; children: ReactNode; accent?: boolean }) {
  return <div className={`${styles.readout} ${accent ? styles.accent : ''}`}><span>{label}</span><strong>{children}</strong></div>;
}

export default function TokenLab({ proEnabled = false }: { proEnabled?: boolean }) {
  const [supply, setSupply] = useState('1000000000');
  const [price, setPrice] = useState('0.01');
  const [allocations, setAllocations] = useState<AllocationInput>({ team: '15', community: '45', liquidity: '25', treasury: '15' });
  const [buyAmount, setBuyAmount] = useState('10000'); const [buyFee, setBuyFee] = useState('2');
  const [sellAmount, setSellAmount] = useState('10000'); const [sellFee, setSellFee] = useState('2');
  const [vestingAmount, setVestingAmount] = useState('150000000');
  const [cliff, setCliff] = useState('3'); const [duration, setDuration] = useState('18'); const [elapsed, setElapsed] = useState('9');
  const [scenarioName, setScenarioName] = useState('Base case');
  const [scenarios, setScenarios] = useState<TokenLabScenario[]>([]);
  const [proMessage, setProMessage] = useState('');

  useEffect(() => {
    if (!proEnabled) { setScenarios([]); setProMessage(''); }
  }, [proEnabled]);

  const fdv = useMemo(() => attempt(() => calculateFdv(supply, price)), [supply, price]);
  const allocationPlan = useMemo(() => attempt(() => calculateAllocations(supply, allocations)), [supply, allocations]);
  const buy = useMemo(() => attempt(() => calculateFeeImpact(buyAmount, buyFee)), [buyAmount, buyFee]);
  const sell = useMemo(() => attempt(() => calculateFeeImpact(sellAmount, sellFee)), [sellAmount, sellFee]);
  const inspectedElapsed = clampVestingElapsed(elapsed, duration);
  const vesting = useMemo(() => attempt(() => calculateVesting(vestingAmount, cliff, duration, inspectedElapsed)), [vestingAmount, cliff, duration, inspectedElapsed]);
  const timeline = useMemo(() => {
    const start = attempt(() => calculateVesting(vestingAmount, cliff, duration, '0'));
    const atCliff = attempt(() => calculateVesting(vestingAmount, cliff, duration, cliff));
    const end = attempt(() => calculateVesting(vestingAmount, cliff, duration, duration));
    return start.value && atCliff.value && vesting.value && end.value ? [start.value, atCliff.value, vesting.value, end.value] : [];
  }, [vestingAmount, cliff, duration, vesting.value]);

  function setAllocation(key: keyof AllocationInput, value: string) { setAllocations(current => ({ ...current, [key]: value })); }
  function resetExample() {
    setSupply('1000000000'); setPrice('0.01'); setAllocations({ team: '15', community: '45', liquidity: '25', treasury: '15' });
    setBuyAmount('10000'); setBuyFee('2'); setSellAmount('10000'); setSellFee('2'); setVestingAmount('150000000'); setCliff('3'); setDuration('18'); setElapsed('9');
  }
  function currentScenario(): TokenLabScenario {
    return { name: scenarioName, totalSupply: supply, targetPriceUsd: price, allocations: { ...allocations }, buyAmount, buyFeePercent: buyFee, sellAmount, sellFeePercent: sellFee, vestingAmount, cliffMonths: cliff, durationMonths: duration };
  }
  function saveScenario() {
    if (!proEnabled) return;
    if (scenarios.length >= 3) { setProMessage('Three scenarios is the comparison limit. Remove one before adding another.'); return; }
    if (!allocationPlan.value?.exactTotal) { setProMessage('Allocations must total exactly 100% before saving a scenario.'); return; }
    const checked = attempt(() => summarizeScenario(currentScenario()));
    if (!checked.value) { setProMessage(checked.error); return; }
    setScenarios(current => [...current, currentScenario()]); setProMessage('Scenario saved locally in this tab.');
  }
  function download(type: 'csv' | 'json') {
    if (!proEnabled) return;
    const result = attempt(() => exportScenarios(scenarios, type));
    if (!result.value) { setProMessage(result.error); return; }
    const url = URL.createObjectURL(new Blob([result.value.content], { type: result.value.mimeType }));
    const link = document.createElement('a'); link.href = url; link.download = result.value.filename; link.click(); URL.revokeObjectURL(url);
    setProMessage(`${type.toUpperCase()} exported with the planning assumptions.`);
  }
  const anyError = fdv.error || allocationPlan.error || buy.error || sell.error || vesting.error;
  const cliffPosition = Math.min(100, Math.max(0, Number(duration) > 0 ? Number(cliff) / Number(duration) * 100 : 0));
  const elapsedPosition = Math.min(100, Math.max(0, Number(duration) > 0 ? Number(inspectedElapsed) / Number(duration) * 100 : 0));
  const durationNumber = Number(duration);
  const sliderMax = Number.isFinite(durationNumber) && durationNumber > 0 && durationNumber <= 120 ? duration : '120';

  return <section className={styles.lab} aria-labelledby="token-lab-title">
    <div className={styles.glow} aria-hidden="true" />
    <header className={styles.header}>
      <div className={styles.labMark}><Icon name="flask" /></div>
      <div><p className={styles.eyebrow}>TOKEN LAB · LOCAL PLANNING INSTRUMENTS</p><h2 id="token-lab-title">Model the token before touching a contract.</h2><p>Explore supply, allocation and user-supplied fee assumptions. Values stay in this tab and are never sent to a server or into the launch engine.</p></div>
      <span className={styles.tier}>{proEnabled ? 'PRO ACCESS' : 'FREE LAB'}</span>
    </header>
    <div className={styles.boundary}><Icon name="atoms" /><p><strong>Generic planning model.</strong> PONS launches use protocol supply rules; this model does not allocate tokens. It cannot change actual PONS supply, fees, tax, vesting or buyback rules.</p></div>
    <div className={styles.grid}>
      <article className={styles.instrument}>
        <div className={styles.instrumentTitle}><span>01</span><div><h3>Supply × target price</h3><p>Enter human token units and a hypothetical USD price.</p></div></div>
        <div className={styles.twoFields}><Field label="Total supply" value={supply} onChange={setSupply} suffix="tokens" /><Field label="Target price" value={price} onChange={setPrice} suffix="USD" /></div>
        {fdv.value ? <Readout label="Fully diluted value" accent>${fdv.value}</Readout> : <p className={styles.error} role="alert">{fdv.error}</p>}
        <p className={styles.micro}>FDV is simple supply × price arithmetic. The target is not a quote, forecast or promise.</p>
      </article>
      <article className={styles.instrument}>
        <div className={styles.instrumentTitle}><span>02</span><div><h3>Allocation balance</h3><p>Distribute the planning supply across four generic buckets.</p></div></div>
        <div className={styles.allocationFields}>{ALLOCATION_KEYS.map(key => <Field key={key} label={key[0].toUpperCase() + key.slice(1)} value={allocations[key]} onChange={value => setAllocation(key, value)} suffix="%" max="100" />)}</div>
        {allocationPlan.value ? <>
          <div className={styles.distribution} role="img" aria-label={`Allocation total ${allocationPlan.value.totalPercent} percent`}>{ALLOCATION_KEYS.map((key, index) => <span key={key} style={{ width: `${Math.min(100, Number(allocations[key]) || 0)}%`, background: COLORS[index] }} />)}</div>
          <div className={styles.allocationList}>{ALLOCATION_KEYS.map((key, index) => <div key={key}><i style={{ background: COLORS[index] }} /><span>{key}</span><strong>{allocationPlan.value.tokenAmounts[key]} tokens</strong></div>)}</div>
          <Readout label={allocationPlan.value.exactTotal ? 'Balanced' : allocationPlan.value.withinTotal ? 'Still unallocated' : 'Over-allocated'} accent={allocationPlan.value.exactTotal}>{allocationPlan.value.totalPercent}% total · {allocationPlan.value.remainingPercent}% remaining</Readout>
        </> : <p className={styles.error} role="alert">{allocationPlan.error}</p>}
      </article>
      <article className={`${styles.instrument} ${styles.wide}`}>
        <div className={styles.instrumentTitle}><span>03</span><div><h3>User-supplied fee impact</h3><p>Compare gross token amounts with a fee or tax percentage you provide.</p></div></div>
        <div className={styles.feeGrid}>
          <div><h4>Buy assumption</h4><div className={styles.twoFields}><Field label="Gross amount" value={buyAmount} onChange={setBuyAmount} suffix="tokens" /><Field label="Fee / tax" value={buyFee} onChange={setBuyFee} suffix="%" max="100" /></div>{buy.value ? <div className={styles.inlineResults}><Readout label="Fee amount">{buy.value.feeAmount}</Readout><Readout label="Net tokens">{buy.value.netAmount}</Readout></div> : <p className={styles.error} role="alert">{buy.error}</p>}</div>
          <div><h4>Sell assumption</h4><div className={styles.twoFields}><Field label="Gross amount" value={sellAmount} onChange={setSellAmount} suffix="tokens" /><Field label="Fee / tax" value={sellFee} onChange={setSellFee} suffix="%" max="100" /></div>{sell.value ? <div className={styles.inlineResults}><Readout label="Fee amount">{sell.value.feeAmount}</Readout><Readout label="Net tokens">{sell.value.netAmount}</Readout></div> : <p className={styles.error} role="alert">{sell.error}</p>}</div>
        </div>
        <p className={styles.micro}>This is arithmetic from your inputs, not a PONS market quote. It excludes price impact, slippage, gas and other protocol costs.</p>
      </article>
    </div>
    {anyError && <div className={styles.retry} role="status"><span>One or more instruments need valid plain decimals.</span><button type="button" onClick={resetExample}>Restore valid example</button></div>}

    {proEnabled ? <div className={styles.proZone}>
      <div className={styles.proHeading}><div><p className={styles.eyebrow}>PRO INSTRUMENTS</p><h3>Vesting timeline and scenario bench</h3></div><span>ACTIVE</span></div>
      <article className={styles.vesting}>
        <div className={styles.instrumentTitle}><span>04</span><div><h3>Linear vesting simulator</h3><p>Models zero vested through the cliff, then linear release until duration.</p></div></div>
        <div className={styles.vestingInputs}><Field label="Vesting allocation" value={vestingAmount} onChange={setVestingAmount} suffix="tokens" /><Field label="Cliff" value={cliff} onChange={setCliff} suffix="months" max="119" /><Field label="Duration" value={duration} onChange={value => { setDuration(value); setElapsed(current => clampVestingElapsed(current, value)); }} suffix="months" min="0.000000000000000001" max="120" /></div>
        <label className={styles.slider}><span>Inspect month <strong>{inspectedElapsed}</strong></span><input type="range" min="0" max={sliderMax} step="any" value={inspectedElapsed} disabled={!vesting.value} onChange={event => setElapsed(event.target.value)} /></label>
        {vesting.value ? <>
          <div className={styles.timeline} aria-hidden="true"><div className={styles.track} /><span className={styles.cliffMarker} style={{ left: `${cliffPosition}%` }} /><span className={styles.elapsedMarker} style={{ left: `${elapsedPosition}%` }} /><b className={styles.startLabel}>START</b><b className={styles.cliffLabel} style={{ left: `${cliffPosition}%` }}>CLIFF</b><b className={styles.endLabel}>END</b></div>
          <div className={styles.inlineResults}><Readout label="Vested at inspected month" accent>{vesting.value.vestedAmount} tokens</Readout><Readout label="Still unvested">{vesting.value.unvestedAmount} tokens</Readout></div>
          <div className={styles.timelineTable}><table><caption>Accessible vesting timeline</caption><thead><tr><th>Point</th><th>Month</th><th>Vested</th><th>Percent</th></tr></thead><tbody>{timeline.map((point, index) => <tr key={`${index}-${point.elapsedMonths}`}><th scope="row">{['Start', 'Cliff', 'Inspected', 'End'][index]}</th><td>{point.elapsedMonths}</td><td>{point.vestedAmount}</td><td>{point.vestedPercent}%</td></tr>)}</tbody></table></div>
        </> : <p className={styles.error} role="alert">{vesting.error}</p>}
      </article>
      <article className={styles.scenarioBench}>
        <div className={styles.instrumentTitle}><span>05</span><div><h3>Scenario comparison</h3><p>Snapshot up to three valid sets of the assumptions above.</p></div></div>
        <div className={styles.scenarioControls}><label className={styles.field}><span>Scenario name</span><span className={styles.inputShell}><input type="text" maxLength={40} value={scenarioName} onChange={event => setScenarioName(event.target.value)} /></span></label><button type="button" onClick={saveScenario} disabled={scenarios.length >= 3}>Save snapshot · {scenarios.length}/3</button></div>
        {scenarios.length ? <div className={styles.scenarios}>{scenarios.map((scenario, index) => { const summary = summarizeScenario(scenario); return <section key={`${scenario.name}-${index}`}><button type="button" aria-label={`Remove ${scenario.name}`} onClick={() => setScenarios(current => current.filter((_, itemIndex) => itemIndex !== index))}>×</button><small>SCENARIO {index + 1}</small><h4>{scenario.name}</h4><dl><div><dt>FDV</dt><dd>${summary.fdvUsd}</dd></div><div><dt>Allocation</dt><dd>{summary.allocationTotalPercent}%</dd></div><div><dt>Buy net</dt><dd>{summary.buyNetAmount}</dd></div><div><dt>Sell net</dt><dd>{summary.sellNetAmount}</dd></div><div><dt>Vesting</dt><dd>{scenario.cliffMonths} → {scenario.durationMonths} mo</dd></div></dl></section>; })}</div> : <div className={styles.empty}><Icon name="atoms" /><p>No scenarios saved. Balance allocations to 100%, name the current assumptions, then save a snapshot.</p></div>}
        <div className={styles.exports}><button type="button" disabled={!scenarios.length} onClick={() => download('csv')}><Icon name="download" />Export CSV</button><button type="button" disabled={!scenarios.length} onClick={() => download('json')}><Icon name="download" />Export JSON</button></div>
        {proMessage && <p className={styles.message} role="status">{proMessage}</p>}
      </article>
    </div> : <aside className={styles.locked} aria-label="Pro Token Lab instruments"><Icon name="lock" /><div><p className={styles.eyebrow}>PRO INSTRUMENTS</p><h3>Compare vesting and export scenarios</h3><p>Pro adds a linear vesting timeline, up to three local scenario snapshots, and CSV or JSON export. Pro controls remain unavailable until current account access is active.</p></div><a href="/pro" target="_blank" rel="noopener noreferrer">Compare Free and Pro</a></aside>}
    <footer><p>{TOKEN_LAB_DISCLAIMER}</p><p>Inputs use human token units with up to 18 decimal places. Plans are held only in component memory and reset when this page closes; Pro scenarios are also cleared if access ends.</p></footer>
  </section>;
}
