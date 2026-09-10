import { useEffect, useState } from "react";
import styles from "./LabHero.module.css";

const MARQUEE = ["PLAN THE TOKEN", "CHECK THE TERMS", "LAUNCH ON PONS", "KEEP YOUR KEYS"];

function MotionIcon({ paused }: { paused: boolean }) {
  return paused
    ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z" /></svg>
    : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12" /></svg>;
}

export default function LabHero() {
  const [motionEnabled, setMotionEnabled] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    setMotionEnabled(!preference.matches);
    const syncPreference = (event: MediaQueryListEvent) => setMotionEnabled(!event.matches);
    preference.addEventListener("change", syncPreference);
    return () => preference.removeEventListener("change", syncPreference);
  }, []);

  return <>
    <section className={`${styles.hero} ${motionEnabled ? styles.inMotion : styles.paused}`} aria-labelledby="lab-hero-title">
      <div className={styles.copy}>
        <p className={styles.kicker}><span>HOODRICH RESEARCH UNIT</span><span>ROBINHOOD CHAIN · 4663</span></p>
        <h1 id="lab-hero-title"><span>Under the hood</span><strong>HOODLABS</strong><span>Make your move.</span></h1>
        <p className={styles.lede}>Plan your token, check live PONS terms, and prepare a launch from one clear workspace. Your wallet stays in control.</p>
        <div className={styles.actions}>
          <a className={styles.primaryAction} href="#launch">Start a launch <span aria-hidden="true">↘</span></a>
          <a className={styles.secondaryAction} href="#token-lab">Plan tokenomics</a>
        </div>
        <dl className={styles.protocolStrip}>
          <div><dt>Launch</dt><dd>Free</dd></div><div><dt>Gas</dt><dd>Native ETH</dd></div><div><dt>Keys</dt><dd>Stay with you</dd></div>
        </dl>
      </div>
      <div className={styles.specimen}>
        <div className={styles.artFrame}>
          <img src="/images/hoodlabs-underground-lab.webp" width="1254" height="1254" alt="Underground concrete workshop with a workbench, CRT equipment and an acid-green glass reactor" />
          <span className={styles.scanLine} />
          <p className={styles.figureLabel}><span>WORKBENCH 01</span><span>LAUNCH SYSTEM</span></p>
          <div className={styles.equipmentReadout} aria-hidden="true"><span>LOCAL PLANNING</span><strong>INPUT / REVIEW / SIGN</strong><small>WORKFLOW PLATE · REV A</small></div>
          <div className={styles.stamp} aria-hidden="true"><span>HOOD</span><strong>LABS</strong><small>UNDERGROUND UNIT</small></div>
        </div>
      </div>
      <button className={styles.motionControl} type="button" onClick={() => setMotionEnabled(current => !current)} aria-pressed={motionEnabled}>
        <MotionIcon paused={!motionEnabled} /><span>{motionEnabled ? "Pause motion" : "Play motion"}</span>
      </button>
    </section>
    <div className={`${styles.marquee} ${motionEnabled ? styles.marqueeMoving : styles.marqueePaused}`} aria-label="Plan the token, check the terms, launch on PONS, keep your keys">
      <div aria-hidden="true">{[...MARQUEE, ...MARQUEE].map((item, index) => <span key={`${item}-${index}`}>{item}<i>✦</i></span>)}</div>
    </div>
    <section className={styles.routes} aria-labelledby="routes-title">
      <div className={styles.routesIntro}><p>ONE WORKSPACE / THREE MOVES</p><h2 id="routes-title">What can I do here?</h2></div>
      <a href="#token-lab"><span>01</span><strong>Plan</strong><p>Test supply, allocation and fee assumptions locally. Pro adds vesting comparisons.</p><i>Open Token Lab →</i></a>
      <a href="#launch"><span>02</span><strong>Launch</strong><p>Build a token and review current PONS terms before your wallet signs.</p><i>Prepare a launch →</i></a>
      <a href="/pro" target="_blank" rel="noopener noreferrer"><span>03</span><strong>Scale</strong><p>Unlock managed uploads and the generated-wallet workspace with Pro.</p><i>Compare access →</i></a>
    </section>
  </>;
}
