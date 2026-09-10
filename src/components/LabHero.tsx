import { useEffect, useState } from "react";
import styles from "./LabHero.module.css";

function MotionIcon({ paused }: { paused: boolean }) {
  return paused ? (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z" /></svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12" /></svg>
  );
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

  return (
    <section className={`${styles.hero} ${motionEnabled ? styles.inMotion : styles.paused}`} aria-labelledby="lab-hero-title">
      <div className={styles.copy}>
        <p className={styles.kicker}><span>HOODLABS / PONS V2</span><span>CHAIN 4663</span></p>
        <h1 id="lab-hero-title">Where tokens<br />come to life.</h1>
        <p className={styles.lede}>A precision launch environment for preparing, inspecting, and bringing onchain specimens to PONS Mainnet.</p>
        <div className={styles.actions}>
          <a className={styles.primaryAction} href="#launch">Enter the launch chamber <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5h10v10M15 5 5 15" /></svg></a>
          <a className={styles.secondaryAction} href="#token-lab">Open Token Lab</a>
        </div>
        <dl className={styles.protocolStrip}>
          <div><dt>Protocol</dt><dd>Live terms</dd></div>
          <div><dt>Gas</dt><dd>ETH</dd></div>
          <div><dt>Network</dt><dd>Robinhood Chain</dd></div>
        </dl>
      </div>

      <div className={styles.specimen} role="img" aria-label="A chrome and glass containment vessel holding a luminous green energy specimen">
        <div className={styles.artFrame}>
          <img src="/images/hoodlabs-specimen.webp" alt="Chrome laboratory containment vessel with a luminous green energy core" />
          <span className={styles.scanLine} />
          <span className={styles.orbit}><i /><i /><i /></span>
          <span className={styles.reticle} />
          <p className={styles.figureLabel}><span>FIG. 001</span><span>GENESIS SPECIMEN</span></p>
        </div>
        <div className={styles.readout} aria-hidden="true"><span>CONTAINMENT</span><strong>STABLE</strong><i /></div>
      </div>

      <button className={styles.motionControl} type="button" onClick={() => setMotionEnabled((current) => !current)} aria-pressed={motionEnabled}>
        <MotionIcon paused={!motionEnabled} />
        <span>{motionEnabled ? "Pause motion" : "Play motion"}</span>
      </button>
    </section>
  );
}
