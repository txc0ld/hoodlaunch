import { useEffect, useRef, useState } from "react";
import styles from "./LabHero.module.css";

function Arrow() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>;
}

export default function LabHero() {
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    setMotionEnabled(!preference.matches && !connection?.saveData);
    const sync = (event: MediaQueryListEvent) => setMotionEnabled(!event.matches && !connection?.saveData);
    preference.addEventListener("change", sync);
    return () => preference.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const element = video.current;
    if (!element || !motionEnabled || videoFailed) { element?.pause(); return; }
    let visible = true;
    let disposed = false;
    const sync = () => {
      if (disposed) return;
      if (visible && document.visibilityState === "visible") void element.play().catch(error => {
        if (!disposed && visible && document.visibilityState === "visible" && error?.name !== "AbortError") setVideoFailed(true);
      });
      else element.pause();
    };
    const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; sync(); }, { threshold: 0.01 });
    observer.observe(element);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => { disposed = true; element.pause(); observer.disconnect(); document.removeEventListener("visibilitychange", sync); };
  }, [motionEnabled, videoFailed]);

  return <section className={styles.hero} aria-labelledby="lab-hero-title">
    <div className={styles.atmosphere} aria-hidden="true">
      <img className={styles.poster} src="/media/hoodlabs-atmosphere.webp" width="1920" height="1080" alt="" fetchPriority="high" />
      {!videoFailed && <video ref={video} className={styles.film} src={motionEnabled ? "/media/hoodlabs-atmosphere.mp4" : undefined} poster="/media/hoodlabs-atmosphere.webp" muted loop playsInline preload="none" tabIndex={-1} onError={() => setVideoFailed(true)} />}
    </div>
    <div className={styles.copy}>
      <p className={styles.kicker}>BUILT ON ROBINHOOD CHAIN</p>
      <h1 id="lab-hero-title" aria-label="hoodlabs"><span aria-hidden="true">𝖍𝖔𝖔𝖉𝖑𝖆𝖇𝖘</span></h1>
      <p>Connect your account, create a PONS token, then manage wallets and trades from one workspace.</p>
      <div className={styles.actions}>
        <a className={styles.primaryAction} href="#pro-account">Start with account <Arrow /></a>
        <a href="#launch">Create token</a>
      </div>
    </div>
    <button className={styles.motionControl} type="button" onClick={() => { setVideoFailed(false); setMotionEnabled(current => !current); }} aria-pressed={motionEnabled}>
      <svg viewBox="0 0 24 24" aria-hidden="true">{motionEnabled ? <path d="M8 6v12M16 6v12" /> : <path d="m8 5 11 7-11 7V5Z" />}</svg>
      {motionEnabled ? "Pause motion" : "Play motion"}
    </button>
  </section>;
}
